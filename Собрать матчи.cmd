@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - sbor matchey
echo.
echo ================================================
echo   Сбор публичных матчей 0-4500 MMR
echo ================================================
echo.
echo Тянет ленту матчей OpenDota и складывает в data\public-matches.
echo Дневной лимит 1800 запросов, скрипт считает их сам.
echo Если OpenDota просит остыть - скрипт ждёт и продолжает сам.
echo Полный заход занимает около часа. Прервать - Ctrl+C.
echo Пропуски не теряются: следующий запуск их доберёт.
echo.
node tools\collect-public-matches.js --back 1800
echo.
echo Состояние базы:
node tools\collect-public-matches.js --stats
echo.
pause
