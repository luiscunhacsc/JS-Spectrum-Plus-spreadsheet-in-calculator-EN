@echo off
setlocal
set "APP=%~dp0index.html"
if not exist "%APP%" (
    echo Could not find index.html next to this launcher.
    pause
    exit /b 1
)
start "" "%APP%"
if errorlevel 1 (
    echo Could not open the emulator in your default browser.
    pause
    exit /b 1
)
