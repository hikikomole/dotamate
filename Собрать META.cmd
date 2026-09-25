@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dota Mate - sbor META
echo.
echo ================================================
echo   Сбор деталей матчей для раздела META
echo ================================================
echo.
echo 1. Спрашивает у Stratz предметы и позиции свежих матчей.
echo 2. Пересобирает витрину META.
echo 3. Выкладывает обновлённые данные на сайт.
echo Если Stratz просит остыть - скрипт ждёт и продолжает сам.
echo Прервать - Ctrl+C, уже собранное не теряется.
echo.
node tools\collect-meta-matches.js --max 3000
echo.
node tools\collect-meta-matches.js --stats
echo.
echo Пересборка витрины META:
node tools\build-meta.js
if errorlevel 1 goto fail
echo.
echo Выкладка на сайт:
node tools\publish-meta.js
if errorlevel 1 goto fail
echo.
echo Готово.
pause
exit /b 0
:fail
echo.
echo ОШИБКА - на сайт ничего не выложено. Скопируйте текст выше и покажите Claude.
pause
exit /b 1
