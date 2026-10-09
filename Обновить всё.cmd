@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - obnovlenie na servere
echo.
echo   Запуск обновления dotamate.ru на сервере (вне расписания).
echo   По расписанию оно и так идёт каждую ночь в 04:17 МСК.
echo.
node tools\server-update.js
echo.
echo   Посмотреть ход обновления:  node tools\server-update.js --log
echo.
pause
