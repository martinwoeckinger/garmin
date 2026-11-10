#!/usr/bin/env python3
"""Schreibt JSON-Dumps der MCP-Tools (Missing MCP / Hevy) als Upserts nach Supabase.

Ablauf: Eine Claude-Session ruft die MCP-Tools auf und speichert die Antworten
unverändert als Dateien in sync/data/. Dieses Skript erkennt am Dateinamen, welches
Tool die Datei erzeugt hat, baut daraus SQL-Upserts und schickt sie über die
Supabase-Management-API (api.supabase.com, Zugang über den Supabase-Konnektor
bzw. SUPABASE_ACCESS_TOKEN) an die Datenbank.

Dateinamen (Präfix entscheidet, Rest beliebig):
    stats_range_*.json             get_stats_range
    sleep_range_*.json             get_sleep_summary_range
    hrv_trend_*.json               get_hrv_trend
    activities_*.json              get_activities_by_date
    weigh_ins_*.json               get_weigh_ins
    training_load_*.json           get_training_load_trend
    vo2max_*.json                  get_vo2max_trend
    intensity_*.json               get_weekly_intensity_minutes
    body_battery_*.json            get_body_battery
    stats_body_<YYYY-MM-DD>.json   get_stats_and_body (ein Tag)
    readiness_<YYYY-MM-DD>.json    get_training_readiness (ein Tag)
    stress_<YYYY-MM-DD>.json       get_stress_summary (ein Tag)
    hevy_workouts_*.json           get_user_workouts (eine Seite)

Aufruf:
    python3 sync/push_to_supabase.py                # alle Dateien in sync/data
    python3 sync/push_to_supabase.py --dry-run      # SQL nur anzeigen
    python3 sync/push_to_supabase.py --keep         # Dateien nach Erfolg nicht löschen
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Europe/Vienna")
from pathlib import Path
from typing import Any

PROJECT_REF = os.getenv("SUPABASE_PROJECT_REF", "jfseqzzsobwdjpdwwsye")
DATA_DIR = Path(__file__).parent / "data"
QUERY_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


# ---------------------------------------------------------------------------
# SQL-Helfer
# ---------------------------------------------------------------------------
def lit(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (v != v):  # NaN
            return "NULL"
        return repr(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def upsert(table: str, rows: list[dict[str, Any]], key: list[str], raw_merge: bool = False) -> str:
    """Partieller Upsert: nur die gelieferten Spalten werden überschrieben."""
    if not rows:
        return ""
    cols: list[str] = []
    for r in rows:
        for c in r:
            if c not in cols:
                cols.append(c)
    values = ",\n".join("(" + ", ".join(lit(r.get(c)) for c in cols) + ")" for r in rows)
    updates = []
    for c in cols:
        if c in key:
            continue
        if c == "raw" and raw_merge:
            updates.append(f"raw = {table}.raw || excluded.raw")
        else:
            updates.append(f"{c} = coalesce(excluded.{c}, {table}.{c})")
    if table != "hevy_sets":
        updates.append("updated_at = now()")
    return (
        f"insert into public.{table} ({', '.join(cols)}) values\n{values}\n"
        f"on conflict ({', '.join(key)}) do update set {', '.join(updates)};"
    )


def ms_to_ts(ms: Any) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def g_to_kg(g: Any) -> float | None:
    return None if g is None else round(g / 1000, 3)


# ---------------------------------------------------------------------------
# Konverter je Tool → (table, rows, key)
# ---------------------------------------------------------------------------
def conv_stats_range(d: dict) -> list[tuple]:
    rows = []
    for day in d.get("days", []):
        if not day.get("has_data") or day.get("is_partial"):
            continue
        rows.append({
            "date": day["date"], "steps": day.get("steps"),
            "total_calories": day.get("total_calories"), "active_calories": day.get("active_calories"),
            "resting_calories": day.get("resting_calories"),
        })
    return [("garmin_daily", rows, ["date"])]


def conv_sleep_range(d: dict) -> list[tuple]:
    rows = []
    for n in d.get("nights", []):
        rows.append({
            "date": n["date"], "sleep_seconds": n.get("sleep_seconds"), "nap_seconds": n.get("nap_seconds"),
            "deep_seconds": n.get("deep_sleep_seconds"), "light_seconds": n.get("light_sleep_seconds"),
            "rem_seconds": n.get("rem_sleep_seconds"), "awake_seconds": n.get("awake_seconds"),
            "awake_count": n.get("awake_count"), "sleep_score": n.get("sleep_score"),
            "sleep_qualifier": n.get("sleep_score_qualifier"),
            "sleep_start": ms_to_ts(n.get("sleep_start")), "sleep_end": ms_to_ts(n.get("sleep_end")),
            "sleep_stress_avg": n.get("avg_sleep_stress"), "sleep_rhr": n.get("resting_heart_rate_bpm"),
            "sleep_spo2_avg": n.get("avg_spo2_percent"), "sleep_spo2_low": n.get("lowest_spo2_percent"),
            "sleep_hrv": n.get("avg_overnight_hrv"), "restless_moments": n.get("restless_moments_count"),
        })
    return [("garmin_daily", rows, ["date"])]


def conv_hrv_trend(d: dict) -> list[tuple]:
    rows = [{
        "date": t["date"], "hrv_last_night": t.get("last_night_avg_hrv_ms"),
        "hrv_weekly_avg": t.get("weekly_avg_hrv_ms"), "hrv_5min_high": t.get("last_night_5min_high_hrv_ms"),
        "hrv_status": t.get("status"), "hrv_feedback": t.get("feedback"),
    } for t in d.get("trend", [])]
    return [("garmin_daily", rows, ["date"])]


def conv_activities(d: dict) -> list[tuple]:
    rows = []
    for a in d.get("activities", []):
        st = a.get("start_time")  # lokale Zeit "YYYY-MM-DD HH:MM:SS"
        rows.append({
            "id": a["id"], "date": st[:10] if st else None,
            "start_time": datetime.fromisoformat(st).replace(tzinfo=LOCAL_TZ).isoformat() if st else None,
            "name": a.get("name"), "type": a.get("type"), "event_type": a.get("event_type"),
            "duration_s": a.get("duration_seconds"), "distance_m": a.get("distance_meters"),
            "calories": a.get("calories"), "avg_hr": a.get("avg_hr_bpm"), "max_hr": a.get("max_hr_bpm"),
            "steps": a.get("steps"), "elevation_gain_m": a.get("elevation_gain_meters"),
            "elevation_loss_m": a.get("elevation_loss_meters"), "raw": a,
        })
    for r in rows:
        for k in ("avg_hr", "max_hr"):
            if r[k] is not None:
                r[k] = int(round(r[k]))
    return [("garmin_activities", rows, ["id"])]


def conv_weigh_ins(d: dict) -> list[tuple]:
    rows: dict[str, dict] = {}
    for m in sorted(d.get("measurements", []), key=lambda m: m.get("timestamp_gmt") or 0):
        rows[m["date"]] = {  # letzte Messung des Tages gewinnt
            "date": m["date"], "weight_kg": m.get("weight_kg"), "bmi": m.get("bmi"),
            "body_fat_pct": m.get("body_fat_percent"), "body_water_pct": m.get("body_water_percent"),
            "muscle_mass_kg": g_to_kg(m.get("muscle_mass_grams")), "bone_mass_kg": g_to_kg(m.get("bone_mass_grams")),
        }
    return [("garmin_daily", list(rows.values()), ["date"])]


def conv_training_load(d: dict) -> list[tuple]:
    rows = [{
        "date": t["date"], "atl": t.get("atl"), "ctl": t.get("ctl"), "tsb": t.get("tsb"),
        "acwr": t.get("acwr"), "acwr_status": t.get("acwr_status"), "training_status": t.get("training_status"),
        "fitness_trend": t.get("fitness_trend"), "vo2max": t.get("vo2_max"),
        "optimal_ctl_min": t.get("optimal_chronic_load_min"), "optimal_ctl_max": t.get("optimal_chronic_load_max"),
    } for t in d.get("trend", [])]
    return [("garmin_daily", rows, ["date"])]


def conv_vo2max(d: dict) -> list[tuple]:
    rows = [{"date": t["date"], "vo2max": t.get("vo2_max"), "vo2max_carried_forward": t.get("carried_forward")}
            for t in d.get("trend", []) if t.get("vo2_max") is not None]
    return [("garmin_daily", rows, ["date"])]


def conv_intensity(d: dict) -> list[tuple]:
    rows = [{
        "week_start": w["week_start"], "goal": w.get("weekly_goal"), "moderate_minutes": w.get("moderate_minutes"),
        "vigorous_minutes": w.get("vigorous_minutes"), "total_minutes": w.get("total_minutes"),
    } for w in d.get("weekly_data", [])]
    return [("garmin_weekly_intensity", rows, ["week_start"])]


def conv_body_battery(d: Any) -> list[tuple]:
    rows = [{"date": x["date"], "bb_charged": x.get("charged"), "bb_drained": x.get("drained"),
             "raw": {"body_battery": {"events": x.get("events"), "level": x.get("body_battery_level"),
                                      "feedback": x.get("current_feedback")}}}
            for x in (d if isinstance(d, list) else [])]
    return [("garmin_daily", rows, ["date"])]


def conv_stats_body(d: dict) -> list[tuple]:
    date = d.get("calendarDate")
    if not date:
        return []
    row = {
        "date": date, "steps": d.get("totalSteps"), "step_goal": d.get("dailyStepGoal"),
        "distance_m": d.get("totalDistanceMeters"),
        "total_calories": d.get("totalKilocalories"), "active_calories": d.get("activeKilocalories"),
        "resting_calories": d.get("bmrKilocalories"),
        "floors_up": d.get("floorsAscended"), "floors_down": d.get("floorsDescended"),
        "intensity_moderate": d.get("moderateIntensityMinutes"), "intensity_vigorous": d.get("vigorousIntensityMinutes"),
        "sedentary_seconds": d.get("sedentarySeconds"), "active_seconds": d.get("activeSeconds"),
        "highly_active_seconds": d.get("highlyActiveSeconds"),
        "resting_hr": d.get("restingHeartRate"), "min_hr": d.get("minHeartRate"), "max_hr": d.get("maxHeartRate"),
        "rhr_7day_avg": d.get("lastSevenDaysAvgRestingHeartRate"),
        "stress_avg": d.get("averageStressLevel"), "stress_max": d.get("maxStressLevel"),
        "stress_qualifier": d.get("stressQualifier"),
        "stress_rest_pct": d.get("restStressPercentage"), "stress_low_pct": d.get("lowStressPercentage"),
        "stress_medium_pct": d.get("mediumStressPercentage"), "stress_high_pct": d.get("highStressPercentage"),
        "bb_high": d.get("bodyBatteryHighestValue"), "bb_low": d.get("bodyBatteryLowestValue"),
        "bb_charged": d.get("bodyBatteryChargedValue"), "bb_drained": d.get("bodyBatteryDrainedValue"),
        "bb_at_wake": d.get("bodyBatteryAtWakeTime"), "bb_during_sleep": d.get("bodyBatteryDuringSleep"),
        "bb_latest": d.get("bodyBatteryMostRecentValue"),
        "spo2_avg": d.get("averageSpo2"), "spo2_low": d.get("lowestSpo2"),
        "respiration_avg": d.get("avgWakingRespirationValue"), "respiration_low": d.get("lowestRespirationValue"),
        "respiration_high": d.get("highestRespirationValue"),
    }
    for k in ("total_calories", "active_calories", "resting_calories"):
        if row[k] is not None:
            row[k] = int(round(row[k]))
    if d.get("weight"):
        row.update({"weight_kg": g_to_kg(d["weight"]), "bmi": d.get("bmi"), "body_fat_pct": d.get("bodyFat"),
                    "body_water_pct": d.get("bodyWater"), "muscle_mass_kg": g_to_kg(d.get("muscleMass")),
                    "bone_mass_kg": g_to_kg(d.get("boneMass"))})
    return [("garmin_daily", [row], ["date"])]


def conv_readiness(d: Any) -> list[tuple]:
    items = d if isinstance(d, list) else [d]
    rows = []
    for r in items:
        if not r.get("date"):
            continue
        rows.append({
            "date": r["date"], "readiness_score": r.get("score"), "readiness_level": r.get("level"),
            "readiness_feedback": r.get("feedback"), "recovery_time_hours": r.get("recovery_time_hours"),
            "readiness_sleep_pct": r.get("sleep_factor_percent"), "readiness_recovery_pct": r.get("recovery_factor_percent"),
            "readiness_load_pct": r.get("training_load_factor_percent"), "readiness_hrv_pct": r.get("hrv_factor_percent"),
            "readiness_stress_pct": r.get("stress_history_factor_percent"),
            "readiness_sleep_hist_pct": r.get("sleep_history_factor_percent"),
        })
    # Bei mehreren Einträgen pro Tag: ersten (= aktuellsten) behalten
    seen: dict[str, dict] = {}
    for r in rows:
        seen.setdefault(r["date"], r)
    return [("garmin_daily", list(seen.values()), ["date"])]


def conv_stress(d: dict) -> list[tuple]:
    if not d.get("date"):
        return []
    return [("garmin_daily", [{
        "date": d["date"], "stress_avg": d.get("avg_stress_level"), "stress_max": d.get("max_stress_level"),
        "stress_rest_pct": d.get("rest_percent"), "stress_low_pct": d.get("low_stress_percent"),
        "stress_medium_pct": d.get("medium_stress_percent"), "stress_high_pct": d.get("high_stress_percent"),
    }], ["date"])]


def conv_hevy(d: dict) -> list[tuple]:
    workouts, sets = [], []
    for w in d.get("workouts", []):
        start, end = w.get("start_time"), w.get("end_time")
        dur = None
        if start and end:
            dur = int((datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds())
        n_sets = n_work = total_reps = 0
        volume = 0.0
        for ex in w.get("exercises", []):
            for s in ex.get("sets", []):
                n_sets += 1
                if s.get("type") != "warmup":
                    n_work += 1
                    if s.get("reps"):
                        total_reps += s["reps"]
                        volume += (s.get("weight_kg") or 0) * s["reps"]
                sets.append({
                    "workout_id": w["id"], "exercise_index": ex["index"], "set_index": s["index"],
                    "exercise_title": ex.get("title"), "exercise_template_id": ex.get("exercise_template_id"),
                    "superset_id": ex.get("superset_id"), "set_type": s.get("type"),
                    "weight_kg": s.get("weight_kg"), "reps": s.get("reps"), "distance_m": s.get("distance_meters"),
                    "duration_s": s.get("duration_seconds"), "rpe": s.get("rpe"), "custom_metric": s.get("custom_metric"),
                    "start_time": start,
                })
        workouts.append({
            "id": w["id"], "title": w.get("title"), "routine_id": w.get("routine_id"),
            "description": w.get("description"), "start_time": start, "end_time": end, "duration_s": dur,
            "exercise_count": len(w.get("exercises", [])), "set_count": n_sets, "working_set_count": n_work,
            "volume_kg": round(volume, 2), "total_reps": total_reps, "exercises": w.get("exercises", []),
            "hevy_updated_at": w.get("updated_at"),
        })
    out: list[tuple] = [("hevy_workouts", workouts, ["id"])]
    if workouts:
        ids = ", ".join(lit(w["id"]) for w in workouts)
        out.append(("__sql__", f"delete from public.hevy_sets where workout_id in ({ids});", None))
        out.append(("hevy_sets", sets, ["workout_id", "exercise_index", "set_index"]))
    return out


CONVERTERS = [
    ("stats_range", conv_stats_range), ("sleep_range", conv_sleep_range), ("hrv_trend", conv_hrv_trend),
    ("activities", conv_activities), ("weigh_ins", conv_weigh_ins), ("training_load", conv_training_load),
    ("vo2max", conv_vo2max), ("intensity", conv_intensity), ("body_battery", conv_body_battery),
    ("stats_body", conv_stats_body), ("readiness", conv_readiness), ("stress", conv_stress),
    ("hevy_workouts", conv_hevy),
]


# ---------------------------------------------------------------------------
# Ausführung
# ---------------------------------------------------------------------------
def run_sql(sql: str) -> Any:
    headers = {"Content-Type": "application/json"}
    token = os.getenv("SUPABASE_ACCESS_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(QUERY_URL, data=json.dumps({"query": sql}).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Supabase-Fehler {exc.code}: {exc.read().decode()[:800]}") from exc


def build_sql(path: Path) -> tuple[str, int]:
    name = path.name
    conv = next((fn for prefix, fn in CONVERTERS if name.startswith(prefix)), None)
    if conv is None:
        raise ValueError(f"Unbekannter Dateiname: {name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "error" in data and len(data) <= 2:
        raise ValueError(f"{name}: Tool-Fehler im Dump: {data['error']}")
    parts, n = [], 0
    for table, rows, key in conv(data):
        if table == "__sql__":
            parts.append(rows)
            continue
        if rows:
            parts.append(upsert(table, rows, key, raw_merge=(table == "garmin_daily")))
            n += len(rows)
    return "\n".join(parts), n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="einzelne Dateien (Standard: alle in sync/data)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep", action="store_true", help="Dateien nach Erfolg behalten")
    args = ap.parse_args()
    files = [Path(f) for f in args.files] or sorted(DATA_DIR.glob("*.json"))
    if not files:
        print("Keine Dateien in", DATA_DIR)
        return 0
    total = 0
    for f in files:
        try:
            sql, n = build_sql(f)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {f.name}: {exc}", file=sys.stderr)
            continue
        if not sql:
            print(f"- {f.name}: keine Zeilen")
            continue
        if args.dry_run:
            print(f"--- {f.name} ({n} Zeilen)\n{sql[:1500]}\n")
            continue
        run_sql(sql)
        log = f"insert into public.sync_runs (source, rows, note) values ({lit(f.name.split('_')[0])}, {n}, {lit(f.name)});"
        run_sql(log)
        total += n
        print(f"✓ {f.name}: {n} Zeilen")
        if not args.keep:
            f.unlink()
    print(f"Fertig: {total} Zeilen geschrieben.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
