@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - obnovlenie vsego
echo.
echo ================================================
echo   Полное обновление dotamate.ru
echo ================================================
echo.
echo Матчи OpenDota, META из Stratz, способности (когда пора),
echo пересчёт матриц и одна выкладка на сайт. Час-два.
echo Прервать - Ctrl+C, собранное не теряется.
echo Журнал - папка logs.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Не найден Node.js.
  pause
  exit /b 1
)
node tools\daily-update.js %*
echo.
pause
