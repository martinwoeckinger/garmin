@echo off
cd /d "%~dp0"
python export_garmin.py --clip %*
pause
