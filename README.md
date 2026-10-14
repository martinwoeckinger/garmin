# Garmin-Export für die tägliche Analyse

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

## Hinweise

- `export/` ist in `.gitignore`, damit keine Gesundheitsdaten in ein Repo gelangen.
- Garmin drosselt bei zu vielen Anfragen; bei einem Rate-Limit einfach später erneut starten.
- Einzelne fehlende Tage (z. B. Uhr nicht getragen) werden übersprungen, der Export bricht nicht ab.
