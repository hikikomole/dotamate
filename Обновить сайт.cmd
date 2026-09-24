@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - obnovlenie sayta
echo.
echo ================================================
echo   Пересчёт данных и выкладка на сайт
echo ================================================
echo.
echo Запускать после «Собрать матчи.cmd».
echo Пересобирает матрицы, заново подбирает коэффициент
echo прогноза и выкатывает всё на dotamate.ru.
echo Занимает пару минут.
echo.
node tools\update-site.js
echo.
pause
