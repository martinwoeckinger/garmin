# Garmin + Hevy: Dashboard und täglicher Export

## Dashboard (GitHub Pages)

`docs/` enthält ein statisches Dashboard (Tag / Woche / Monat / Kraft) mit allen Garmin-
und Hevy-Kennzahlen. Die Daten liegen in Supabase (Schema: `supabase/schema.sql`), der Login
läuft über Supabase Auth (E-Mail + Passwort oder Magic-Link). Wie die Daten über die
MCP-Konnektoren nach Supabase kommen, steht in `SYNC.md`.

Veröffentlichen: In den Repo-Einstellungen unter *Pages* die Quelle auf **GitHub Actions**
stellen; der Workflow `.github/workflows/pages.yml` deployt `docs/` bei jedem Push auf `main`
(oder manuell über *Run workflow*). URL: `https://martinwoeckinger.github.io/garmin/`.
Lokal testen: `python3 -m http.server -d docs 8000` und `http://localhost:8000` öffnen.

## Garmin-Export für die tägliche Analyse (bisheriger Ablauf)

Holt HFV-Status (mit 7-Tage-Verlauf), Schlafdaten und Gewicht aus Garmin Connect
und schreibt sie als Markdown und JSON nach `export/`. Das Markdown ist so formatiert,
dass es direkt an Claude übergeben werden kann.

## Täglicher Ablauf

1. `export.bat` doppelklicken (oder im Terminal `python export_garmin.py --clip`).
2. Das Markdown liegt danach in der Zwischenablage und unter `export/garmin_<Datum>.md`.
3. In Claude den Prompt aus `PROMPT.md` einfügen, Export darunter einfügen, absenden.

## Einrichtung (einmalig)

```bash
pip install -r requirements.txt
```

Beim ersten Lauf fragt das Skript nach E-Mail, Passwort und ggf. dem MFA-Code.
Die Sitzungs-Tokens werden unter `~/.garminconnect` gespeichert, danach ist kein Login mehr nötig.
Alternativ können `GARMIN_EMAIL` und `GARMIN_PASSWORD` als Umgebungsvariablen gesetzt werden.

## Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `--days N` | 7 | Zeitraum für HFV und Schlaf |
| `--weight-days N` | 30 | Zeitraum für Gewicht |
| `--clip` | aus | Markdown zusätzlich in die Zwischenablage kopieren |
| `--out PFAD` | `./export` | Zielordner |

## Was exportiert wird

- **HFV:** Status (ausgeglichen / unausgeglichen / niedrig), Nacht-Durchschnitt, 5-Minuten-Hoch,
  7-Tage-Durchschnitt, persönliche Baseline, Tagesverlauf.
- **Schlaf:** Zeiten, Gesamtdauer, Tief/Leicht/REM/Wach, Sleep Score, Ruhepuls, HFV, Atemfrequenz,
  SpO2, Body-Battery-Änderung.
- **Gewicht:** Gewicht, BMI, Körperfett, Muskelmasse, Körperwasser je Messung.

Die JSON-Datei enthält dieselben Daten unverändert, falls du sie anders auswerten willst.

## Automatisch in der Cloud (Handy)

Siehe `ROUTINE.md`: Eine Claude-Code-Routine führt Export und Analyse täglich in der Cloud aus,
das Ergebnis landet in der Claude-App und unter `analyse/`.

## Hinweise

- `export/` ist in `.gitignore`, damit keine Gesundheitsdaten in ein Repo gelangen.
- Garmin drosselt bei zu vielen Anfragen; bei einem Rate-Limit einfach später erneut starten.
- Einzelne fehlende Tage (z. B. Uhr nicht getragen) werden übersprungen, der Export bricht nicht ab.
