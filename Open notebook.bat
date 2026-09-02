@echo off
setlocal
title Engineering Notebook
cd /d "%~dp0"
rem Optional: pass a port, e.g.  Start notebook.bat 8080
set "PORT=8765"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   Engineering Notebook
echo   ====================
echo.

if not exist "index.html" (
  echo   ERROR: this file has been moved away from the website folder.
  echo   Keep "Start notebook.bat" in the same folder as index.html.
  echo.
  pause
  exit /b 1
)

if not exist "notebook.pdf" (
  echo   Note: notebook.pdf is missing, so the site will open with an
  echo   empty drop zone. Put your PDF in this folder to fix that.
  echo.
)

rem Find a Python. Any of these three will do.
set "PY="
py -3 -c "pass" >nul 2>&1 && set "PY=py -3"
if not defined PY ( python -c "pass" >nul 2>&1 && set "PY=python" )
if not defined PY ( python3 -c "pass" >nul 2>&1 && set "PY=python3" )

if not defined PY (
  echo   ERROR: Python was not found on this computer.
  echo.
  echo   The notebook needs a small local web server. Browsers refuse to
  echo   load a PDF from a file opened directly, so double-clicking
  echo   index.html will not work.
  echo.
  echo   Install Python from https://python.org/downloads
  echo   ^(tick "Add python.exe to PATH" during setup^), then run this again.
  echo.
  pause
  exit /b 1
)

echo   Starting the notebook at http://localhost:%PORT%
echo.
echo   Your browser should open in a moment.
echo   Leave this black window open while you are reading.
echo   To stop: close this window, or press Ctrl+C.
echo.

start "" "http://localhost:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1

echo.
echo   The notebook server has stopped.
echo   ^(If it stopped immediately, port %PORT% is probably already in use -
echo    it may already be running in another window.^)
echo.
pause
