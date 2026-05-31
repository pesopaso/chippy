@echo off
rem Chippy — one-click local server.
rem Double-click this file to serve src/local over http://localhost and open the app.
rem ES modules and the File System Access API require an http(s)/localhost origin,
rem so the app cannot run from a file:// double-click — this fixes that.

cd /d "%~dp0"
echo.
echo  Chippy is starting at  http://localhost:8000/app.html
echo  Keep this window open while you use the app. Press Ctrl+C to stop.
echo.

rem Open the browser, then start a static server (tries python, then py, then npx).
start "" http://localhost:8000/app.html
python -m http.server 8000 2>nul || py -m http.server 8000 2>nul || npx --yes serve -l 8000

echo.
echo  No local server found. Install Python (python.org) or Node (nodejs.org),
echo  then run this file again.
pause
