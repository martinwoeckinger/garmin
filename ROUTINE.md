# Cloud-Routine (Claude Code Routines)

Die Routine läuft täglich um 08:00 (Wien) in der Anthropic-Cloud, klont dieses Repo,
führt `export_garmin.py` aus, analysiert das Ergebnis und committet die Analyse
nach `analyse/JJJJ-MM-TT.md`. Das Ergebnis ist in der Claude-App am Handy sichtbar
(Code-Tab, Routinen) und als Datei im Repo.

## Einmalige Einrichtung

1. **Garmin-Token als Umgebungsvariable hinterlegen**
   Lokal ausführen, der Wert liegt danach in der Zwischenablage:

   ```
   python export_garmin.py --cloud-token
   ```

   Unter https://claude.ai/code/environments die Cloud-Umgebung öffnen und bei
   Umgebungsvariablen eine Zeile `GARMINTOKENS=<eingefügter Wert>` eintragen.
   Der Wert ist Base64 (nur Buchstaben, Ziffern, `+/=`), weil die .env-Eingabe
   das rohe JSON mit Leerzeichen und Anführungszeichen nicht sauber übernimmt.

2. **Netzwerk freigeben**, falls die Umgebung eine Domain-Allowlist nutzt:
   `connect.garmin.com`, `connectapi.garmin.com`, `diauth.garmin.com`,
   `sso.garmin.com`, `pypi.org`, `files.pythonhosted.org`.

3. **Repo-Zugriff**: Die Routine braucht Lese- und Schreibrechte auf
   `github.com/martinwoeckinger/garmin` (GitHub-App von Claude Code).

## Python in der Cloud

In der Standard-Cloud-Umgebung sind `python` und `python3` Python 3.11, `garminconnect` braucht
aber Python 3.12 oder neuer. Die Routine verwendet deshalb explizit `python3.13` für pip und Skript.

## Token-Erneuerung

Der Zugriffstoken ist ca. 24 h gültig und wird über den Refresh-Token erneuert.
Falls Garmin den Refresh-Token irgendwann rotiert oder er abläuft, schlägt die Routine
mit "Anmeldung fehlgeschlagen" fehl. Dann lokal einmal `python export_garmin.py`
ausführen (ggf. neu anmelden), danach `python export_garmin.py --cloud-token` und den neuen
Wert wieder in `GARMINTOKENS` eintragen.

## Manuell auslösen

Unter https://claude.ai/code/routines die Routine öffnen und "Run" wählen,
auch vom Handy aus.
