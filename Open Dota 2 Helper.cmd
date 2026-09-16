@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Dota 2 Companion requires Node.js 18 or newer.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
start "Dota 2 Companion Server" cmd /c "node preview-server.js"
for /l %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto OPEN
  timeout /t 1 /nobreak >nul
)
echo.
echo The local server did not start in time. Check the server window for details.
pause
exit /b 1
:OPEN
start "" "http://127.0.0.1:4173/"
exit /b 0
