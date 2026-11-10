# Daten-Sync: Garmin (Missing MCP) + Hevy → Supabase

Das Dashboard unter `docs/` liest ausschließlich aus Supabase. Befüllt wird Supabase von
einer Claude-Code-Session (Routine oder manuell), die die MCP-Konnektoren **Missing MCP**
(Garmin) und **Hevy** abfragt, die Antworten als JSON ablegt und mit
`sync/push_to_supabase.py` in die Datenbank schreibt. Es sind keine zusätzlichen Secrets
nötig: Das Skript nutzt die Supabase-Management-API, deren Zugang in der Cloud-Umgebung
über den Supabase-Konnektor eingebunden ist (alternativ `SUPABASE_ACCESS_TOKEN` setzen).

## Ablauf (täglich, z. B. 08:00 Wien)

1. Tool-Antworten unverändert als Dateien nach `sync/data/` schreiben (Präfix = Tool):

   | Datei | Tool | Zeitraum |
   |---|---|---|
   | `stats_range_<von>_<bis>.json` | `get_stats_range` | letzte 7 Tage |
   | `sleep_range_<von>_<bis>.json` | `get_sleep_summary_range` | letzte 7 Tage |
   | `hrv_trend_<von>_<bis>.json` | `get_hrv_trend` | letzte 7 Tage |
   | `activities_<von>_<bis>.json` | `get_activities_by_date` | letzte 14 Tage |
   | `weigh_ins_<von>_<bis>.json` | `get_weigh_ins` | letzte 14 Tage |
   | `training_load_<von>_<bis>.json` | `get_training_load_trend` | letzte 7 Tage |
   | `vo2max_<von>_<bis>.json` | `get_vo2max_trend` | letzte 7 Tage |
   | `intensity_4w.json` | `get_weekly_intensity_minutes` (weeks=4) | – |
   | `body_battery_<von>_<bis>.json` | `get_body_battery` | letzte 7 Tage |
   | `stats_body_<datum>.json` | `get_stats_and_body` | gestern und vorgestern (nicht heute: unvollständig) |
   | `readiness_<datum>.json` | `get_training_readiness` | heute, gestern, vorgestern |
   | `hevy_workouts_p1.json`, `…_p2.json` | `get_user_workouts` (pageSize 10) | Seite 1 und 2 |

2. `python3 sync/push_to_supabase.py` ausführen. Das Skript macht partielle Upserts
   (nur gelieferte Spalten werden überschrieben), protokolliert in `sync_runs` und löscht
   die Dateien nach Erfolg. `--dry-run` zeigt nur das SQL, `--keep` behält die Dateien.

3. Nichts committen – `sync/data/` ist in `.gitignore`.

## Routine-Prompt (Claude Code Routines)

```
Heute ist {{date}}. Synchronisiere meine Gesundheitsdaten nach Supabase, wie in SYNC.md
beschrieben: Rufe die Missing-MCP- und Hevy-Tools für die dort genannten Zeiträume auf,
speichere jede Antwort unverändert unter sync/data/ mit dem passenden Dateinamen und führe
danach `python3 sync/push_to_supabase.py` aus. Melde kurz, wie viele Zeilen geschrieben
wurden und ob ein Tool fehlgeschlagen ist. Committe nichts.
```

Voraussetzungen für die Routine: Repo `martinwoeckinger/garmin`, Konnektoren Missing MCP,
Hevy und Supabase aktiviert, Python 3 vorhanden (keine Zusatzpakete nötig).

## Backfill

Für längere Zeiträume dieselben Tools mit größeren Fenstern aufrufen
(`get_stats_range` max. 28 Tage, `get_sleep_summary_range` max. 90 Nächte,
`get_hrv_trend` max. 30 Tage, `get_training_load_trend`/`get_vo2max_trend` max. 90 Tage,
Hevy seitenweise bis `page_count`). Garmin drosselt bei vielen Anfragen; dann später erneut.

## Schema

`supabase/schema.sql` ist idempotent und legt an: `garmin_daily` (eine Zeile pro Tag mit
Schlaf, HFV, Ruhepuls, Stress, Body Battery, Schritte, Kalorien, Bereitschaft,
Trainingslast, VO2max, Gewicht …), `garmin_activities`, `garmin_weekly_intensity`,
`hevy_workouts`, `hevy_sets`, `sync_runs` sowie die Sichten `v_garmin_weekly` und
`v_garmin_monthly`. RLS: nur eingeloggte Nutzer lesen, Schreiben nur über die
Management-API.
