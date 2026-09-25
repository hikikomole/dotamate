@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - sbor META
echo.
echo ================================================
echo   Сбор деталей матчей для раздела META
echo ================================================
echo.
echo Берёт матчи из data\public-matches и спрашивает у Stratz предметы,
echo позиции и графики. У Stratz есть примерно каждый третий-четвёртый матч.
echo Если Stratz просит остыть - скрипт ждёт и продолжает сам.
echo Прервать - Ctrl+C, уже собранное не теряется.
echo.
node tools\collect-meta-matches.js --max 3000
echo.
node tools\collect-meta-matches.js --stats
echo.
echo Пересборка витрины META:
node tools\build-meta.js
echo.
pause
