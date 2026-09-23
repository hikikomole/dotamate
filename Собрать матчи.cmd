@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Сбор матчей нашего ранга — Dota Mate

echo.
echo ================================================
echo   Сбор публичных матчей 0-4500 MMR
echo ================================================
echo.
echo Тянет ленту матчей OpenDota и складывает их в
echo data\public-matches. Дневной лимит - 1800 запросов,
echo скрипт считает их сам и не превышает.
echo.
echo Можно запускать хоть каждый день: пропуски
echo докачиваются, ничего не теряется.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Не найден Node.js. Установите его с nodejs.org и запустите файл заново.
  pause
  exit /b 1
)

node tools\collect-public-matches.js --back 1800
echo.
echo Готово. Текущее состояние базы:
node tools\collect-public-matches.js --stats
echo.
pause
