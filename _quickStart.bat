@echo off
setlocal

rem Start in the batch file's folder by default.
set "APP_DIR=%~dp0"

rem If the app lives in a sibling folder named "coffee break", use that instead.
if exist "%~dp0coffee-break\package.json" set "APP_DIR=%~dp0coffee-break"

set "APP_URL=http://localhost:8080"

echo Starting npm in PowerShell...
start "npm start" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath $env:APP_DIR; npm start"

echo Waiting for %APP_URL% ...
:waitLoop
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto waitLoop
)

echo Opening Microsoft Edge...
where msedge >nul 2>&1
if %errorlevel%==0 (
    start "" msedge "%APP_URL%"
) else (
    if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
        start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%APP_URL%"
    ) else (
        if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
            start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%APP_URL%"
        ) else (
            start "" "%APP_URL%"
        )
    )
)

endlocal
