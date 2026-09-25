@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - avtoobnovlenie
echo.
echo Ставлю ежедневное обновление сайта в Планировщик Windows...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Не найден Node.js.
  pause
  exit /b 1
)
node tools\install-daily-task.js %*
echo.
echo Чтобы выключить: запустите этот файл с параметром --remove
echo или удалите задачу "DotaMate" в Планировщике заданий.
pause
