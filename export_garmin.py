#!/usr/bin/env python3
"""Exportiert HRV, Schlaf und Gewicht aus Garmin Connect als Markdown + JSON.

Aufruf:
    python export_garmin.py                 # letzte 7 Tage HRV/Schlaf, 30 Tage Gewicht
    python export_garmin.py --days 14       # längerer Verlauf
    python export_garmin.py --clip          # Markdown zusätzlich in die Zwischenablage

Beim ersten Lauf wird nach E-Mail/Passwort (und ggf. MFA-Code) gefragt.
Die Tokens werden unter ~/.garminconnect gespeichert, danach ist kein Login mehr nötig.

Cloud/CI: `python export_garmin.py --cloud-token` legt den Token als Base64 in die
Zwischenablage; diesen Wert als Umgebungsvariable GARMINTOKENS setzen.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

TOKEN_FILE = Path("~/.garminconnect/garmin_tokens.json").expanduser()


def resolve_tokenstore() -> str:
    """Token-Quelle bestimmen: Umgebungsvariable (JSON oder Base64) oder lokaler Ordner.

    GARMINTOKEN (ohne S) wird als Tippfehler-Variante akzeptiert. Base64 ist für
    Cloud-Umgebungen gedacht, deren .env-Eingabe Leerzeichen/Anführungszeichen
    im JSON nicht sauber übernimmt.
    """
    raw = (os.getenv("GARMINTOKENS") or os.getenv("GARMINTOKEN") or "").strip()
    if not raw:
        return "~/.garminconnect"
    if raw.startswith("{"):
        try:
            json.loads(raw)
            return raw
        except json.JSONDecodeError as exc:
            raise GarminConnectAuthenticationError(
                f"GARMINTOKENS ist kein gültiges JSON (Länge {len(raw)}): {exc}. "
                "Tipp: Wert mit --cloud-token als Base64 erzeugen."
            ) from exc
    try:
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
        json.loads(decoded)
        return decoded
    except Exception as exc:  # noqa: BLE001
        raise GarminConnectAuthenticationError(
            f"GARMINTOKENS ist weder JSON noch Base64-JSON (Länge {len(raw)}, "
            f"beginnt mit {raw[:1]!r}). Wert mit --cloud-token neu erzeugen."
        ) from exc


def copy_to_clipboard(text: str) -> None:
    if sys.platform == "win32":
        subprocess.run("clip", input=text.encode("utf-16-le"), check=True)
    elif sys.platform == "darwin":
        subprocess.run("pbcopy", input=text.encode(), check=True)
    else:
        subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(), check=True)


def cloud_token() -> int:
    """Token-Datei als Base64 in die Zwischenablage legen (für GARMINTOKENS in der Cloud)."""
    if not TOKEN_FILE.exists():
        print(f"Keine Token-Datei unter {TOKEN_FILE}. Erst einmal normal exportieren.", file=sys.stderr)
        return 1
    b64 = base64.b64encode(TOKEN_FILE.read_bytes()).decode("ascii")
    try:
        copy_to_clipboard(b64)
        print(f"Base64-Token ({len(b64)} Zeichen) liegt in der Zwischenablage.")
    except Exception as exc:  # noqa: BLE001
        print(f"Zwischenablage nicht verfügbar ({exc}). Wert:")
        print(b64)
    print("In der Cloud-Umgebung als Umgebungsvariable eintragen:  GARMINTOKENS=<eingefügter Wert>")
    return 0
EXPORT_DIR = Path(__file__).parent / "export"

STATUS_DE = {
    "BALANCED": "ausgeglichen",
    "UNBALANCED": "unausgeglichen",
    "LOW": "niedrig",
    "POOR": "schlecht",
    "NONE": "keine Angabe",
}


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
def login() -> Garmin:
    """Erst gespeicherte Tokens versuchen, sonst interaktiv anmelden."""
    tokenstore = resolve_tokenstore()
    try:
        api = Garmin()
        api.login(tokenstore)
        return api
    except Exception as exc:  # noqa: BLE001
        print(f"Gespeicherter Token nicht nutzbar: {type(exc).__name__}: {exc}", file=sys.stderr)

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not (email and password) and not sys.stdin.isatty():
        raise GarminConnectAuthenticationError(
            "Kein gültiger Token und kein Terminal für die Anmeldung. "
            "GARMINTOKENS (Token-JSON) oder GARMIN_EMAIL/GARMIN_PASSWORD setzen."
        )
    print("Kein gültiger Token gefunden. Bitte Garmin-Connect-Zugangsdaten eingeben.")
    email = email or input("E-Mail: ").strip()
    password = password or getpass.getpass("Passwort: ")
    api = Garmin(email, password, prompt_mfa=lambda: input("MFA-Code: ").strip())
    api.login("~/.garminconnect")
    return api


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def safe(fn, *args, default=None):
    """Einzelne API-Fehler sollen den Export nicht abbrechen."""
    try:
        return fn(*args)
    except GarminConnectTooManyRequestsError:
        print("  ! Rate-Limit von Garmin, bitte später erneut versuchen.", file=sys.stderr)
        return default
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {fn.__name__}{args}: {exc}", file=sys.stderr)
        return default


def hhmm(seconds: Any) -> str:
    if seconds is None:
        return "–"
    seconds = int(seconds)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}"


def ts_local(ms: Any) -> str:
    if not ms:
        return "–"
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%H:%M")


def fmt(v: Any, digits: int = 1, unit: str = "") -> str:
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:.{digits}f}{unit}"
    return f"{v}{unit}"


def daterange(days: int) -> list[date]:
    today = date.today()
    return [today - timedelta(days=i) for i in range(days - 1, -1, -1)]


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------
def fetch_hrv(api: Garmin, days: list[date]) -> dict[str, Any]:
    """HRV-Status von heute (inkl. Baseline) plus Tagesverlauf."""
    out: dict[str, Any] = {"today": None, "history": []}

    today_data = safe(api.get_hrv_data, days[-1].isoformat())
    if today_data and today_data.get("hrvSummary"):
        out["today"] = today_data["hrvSummary"]

    # Bereichs-Endpunkt liefert alle Tage in einem Request
    rng = safe(api.get_hrv_data_range, days[0].isoformat(), days[-1].isoformat())
    summaries = (rng or {}).get("hrvSummaries") or []
    if not summaries:
        # Fallback: Tag für Tag
        for d in days:
            data = safe(api.get_hrv_data, d.isoformat())
            if data and data.get("hrvSummary"):
                summaries.append(data["hrvSummary"])

    for s in summaries:
        out["history"].append(
            {
                "date": s.get("calendarDate"),
                "lastNightAvg": s.get("lastNightAvg"),
                "lastNight5MinHigh": s.get("lastNight5MinHigh"),
                "weeklyAvg": s.get("weeklyAvg"),
                "status": s.get("status"),
                "baseline": s.get("baseline"),
            }
        )
    out["history"].sort(key=lambda r: r["date"] or "")
    if out["today"] is None and out["history"]:
        out["today"] = summaries[-1]
    return out


def fetch_sleep(api: Garmin, days: list[date]) -> list[dict[str, Any]]:
    rows = []
    for d in days:
        data = safe(api.get_sleep_data, d.isoformat()) or {}
        dto = data.get("dailySleepDTO") or {}
        if not dto.get("sleepTimeSeconds"):
            continue
        scores = dto.get("sleepScores") or {}
        rows.append(
            {
                "date": dto.get("calendarDate") or d.isoformat(),
                "start": ts_local(dto.get("sleepStartTimestampLocal")),
                "end": ts_local(dto.get("sleepEndTimestampLocal")),
                "total_s": dto.get("sleepTimeSeconds"),
                "deep_s": dto.get("deepSleepSeconds"),
                "light_s": dto.get("lightSleepSeconds"),
                "rem_s": dto.get("remSleepSeconds"),
                "awake_s": dto.get("awakeSleepSeconds"),
                "score": (scores.get("overall") or {}).get("value"),
                "score_label": (scores.get("overall") or {}).get("qualifierKey"),
                "resting_hr": data.get("restingHeartRate") or dto.get("restingHeartRate"),
                "overnight_hrv": data.get("avgOvernightHrv") or dto.get("avgOnightHrv"),
                "respiration": dto.get("averageRespirationValue"),
                "spo2": dto.get("averageSpO2Value"),
                "body_battery_change": dto.get("bodyBatteryChange")
                or data.get("bodyBatteryChange"),
                "sleep_need_min": (dto.get("sleepNeed") or {}).get("actual"),
                "restless_moments": data.get("restlessMomentsCount"),
            }
        )
    return rows


def fetch_weight(api: Garmin, start: date, end: date) -> list[dict[str, Any]]:
    data = safe(api.get_body_composition, start.isoformat(), end.isoformat()) or {}
    rows = []
    for w in data.get("dateWeightList") or []:
        if w.get("weight") is None:
            continue
        rows.append(
            {
                "date": w.get("calendarDate"),
                "weight_kg": round(w["weight"] / 1000, 2),
                "bmi": w.get("bmi"),
                "body_fat_pct": w.get("bodyFat"),
                "muscle_mass_kg": (w.get("muscleMass") or 0) / 1000 or None,
                "body_water_pct": w.get("bodyWater"),
                "bone_mass_kg": (w.get("boneMass") or 0) / 1000 or None,
                "source": w.get("sourceType"),
            }
        )
    rows.sort(key=lambda r: r["date"] or "")
    return rows


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------
def render_markdown(hrv: dict, sleep: list, weight: list, days: int, wdays: int) -> str:
    today = date.today().isoformat()
    md = [f"# Garmin-Gesundheitsdaten – Stand {today}", ""]

    # --- HRV ---------------------------------------------------------------
    md += ["## HFV-Status", ""]
    t = hrv.get("today")
    if t:
        b = t.get("baseline") or {}
        status = t.get("status") or "NONE"
        md += [
            f"- **Status:** {STATUS_DE.get(status, status)} ({status})",
            f"- **Letzte Nacht (Ø):** {fmt(t.get('lastNightAvg'), 0, ' ms')}",
            f"- **Letzte Nacht (5-Min-Hoch):** {fmt(t.get('lastNight5MinHigh'), 0, ' ms')}",
            f"- **7-Tage-Durchschnitt:** {fmt(t.get('weeklyAvg'), 0, ' ms')}",
            f"- **Baseline (ausgeglichen):** {fmt(b.get('balancedLow'), 0)}–{fmt(b.get('balancedUpper'), 0, ' ms')}"
            f" (niedrig bis {fmt(b.get('lowUpper'), 0, ' ms')})",
        ]
    else:
        md.append("_Keine HFV-Daten verfügbar._")

    md += ["", f"### HFV-Verlauf ({days} Tage)", ""]
    if hrv.get("history"):
        md += ["| Datum | Nacht Ø (ms) | 5-Min-Hoch (ms) | 7-Tage Ø (ms) | Status |",
               "|---|---|---|---|---|"]
        for r in hrv["history"]:
            md.append(
                f"| {r['date']} | {fmt(r['lastNightAvg'], 0)} | {fmt(r['lastNight5MinHigh'], 0)} "
                f"| {fmt(r['weeklyAvg'], 0)} | {STATUS_DE.get(r['status'], r['status'] or '–')} |"
            )
    else:
        md.append("_Kein Verlauf verfügbar._")

    # --- Sleep -------------------------------------------------------------
    md += ["", f"## Schlaf ({days} Tage)", ""]
    if sleep:
        md += [
            "| Datum | Von | Bis | Gesamt | Tief | Leicht | REM | Wach | Score | Ruhepuls | HFV | Atmung | SpO2 | Body Battery |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for s in sleep:
            score = f"{s['score']} ({s['score_label']})" if s["score"] is not None else "–"
            bb = f"+{s['body_battery_change']}" if (s["body_battery_change"] or 0) > 0 else fmt(s["body_battery_change"])
            md.append(
                f"| {s['date']} | {s['start']} | {s['end']} | {hhmm(s['total_s'])} | {hhmm(s['deep_s'])} "
                f"| {hhmm(s['light_s'])} | {hhmm(s['rem_s'])} | {hhmm(s['awake_s'])} | {score} "
                f"| {fmt(s['resting_hr'], 0)} | {fmt(s['overnight_hrv'], 0)} | {fmt(s['respiration'], 1)} "
                f"| {fmt(s['spo2'], 0)} | {bb} |"
            )
        avg_total = sum(s["total_s"] for s in sleep) / len(sleep)
        scores = [s["score"] for s in sleep if s["score"] is not None]
        md += ["", f"Ø Schlafdauer: **{hhmm(avg_total)} h**"
               + (f", Ø Score: **{sum(scores)/len(scores):.0f}**" if scores else "")]
    else:
        md.append("_Keine Schlafdaten verfügbar._")

    # --- Weight ------------------------------------------------------------
    md += ["", f"## Gewicht ({wdays} Tage)", ""]
    if weight:
        md += ["| Datum | Gewicht (kg) | BMI | Körperfett % | Muskelmasse (kg) | Wasser % |",
               "|---|---|---|---|---|---|"]
        for w in weight:
            md.append(
                f"| {w['date']} | {fmt(w['weight_kg'], 1)} | {fmt(w['bmi'], 1)} | {fmt(w['body_fat_pct'], 1)} "
                f"| {fmt(w['muscle_mass_kg'], 1)} | {fmt(w['body_water_pct'], 1)} |"
            )
        first, last = weight[0], weight[-1]
        delta = last["weight_kg"] - first["weight_kg"]
        md += ["", f"Aktuell: **{last['weight_kg']:.1f} kg** ({last['date']}), "
               f"Veränderung seit {first['date']}: **{delta:+.1f} kg**"]
    else:
        md.append("_Keine Gewichtsdaten verfügbar._")

    md += ["", "---", "_Exportiert mit export_garmin.py_", ""]
    return "\n".join(md)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7, help="Tage für HFV und Schlaf (Standard 7)")
    parser.add_argument("--weight-days", type=int, default=30, help="Tage für Gewicht (Standard 30)")
    parser.add_argument("--clip", action="store_true", help="Markdown in die Zwischenablage kopieren")
    parser.add_argument("--out", type=Path, default=EXPORT_DIR, help="Zielordner (Standard ./export)")
    parser.add_argument("--cloud-token", action="store_true",
                        help="Token als Base64 in die Zwischenablage legen (für GARMINTOKENS in der Cloud)")
    args = parser.parse_args()

    if args.cloud_token:
        return cloud_token()

    print("Anmeldung bei Garmin Connect ...")
    try:
        api = login()
    except GarminConnectConnectionError as exc:
        print(f"Verbindung fehlgeschlagen: {exc}", file=sys.stderr)
        return 1
    except GarminConnectAuthenticationError as exc:
        print(f"Anmeldung fehlgeschlagen: {exc}", file=sys.stderr)
        return 1

    days = daterange(args.days)
    today = date.today()

    print(f"Lade HFV ({args.days} Tage) ...")
    hrv = fetch_hrv(api, days)
    print(f"Lade Schlaf ({args.days} Tage) ...")
    sleep = fetch_sleep(api, days)
    print(f"Lade Gewicht ({args.weight_days} Tage) ...")
    weight = fetch_weight(api, today - timedelta(days=args.weight_days - 1), today)

    md = render_markdown(hrv, sleep, weight, args.days, args.weight_days)

    args.out.mkdir(parents=True, exist_ok=True)
    md_path = args.out / f"garmin_{today.isoformat()}.md"
    json_path = args.out / f"garmin_{today.isoformat()}.json"
    md_path.write_text(md, encoding="utf-8")
    json_path.write_text(
        json.dumps({"exported": today.isoformat(), "hrv": hrv, "sleep": sleep, "weight": weight},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    if args.clip:
        try:
            copy_to_clipboard(md)
            print("Markdown in die Zwischenablage kopiert.")
        except Exception as exc:  # noqa: BLE001
            print(f"Zwischenablage nicht verfügbar: {exc}", file=sys.stderr)

    print(f"\nFertig:\n  {md_path}\n  {json_path}")
    print(f"\nHFV: {len(hrv['history'])} Tage, Schlaf: {len(sleep)} Nächte, Gewicht: {len(weight)} Messungen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
