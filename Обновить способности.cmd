@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Обновление способностей героев — Dota Mate

echo.
echo ================================================
echo   Обновление способностей героев на dotamate.ru
echo ================================================
echo.
echo Запускать примерно раз в три месяца, после крупных
echo патчей Dota 2. Займёт около минуты.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Не найден Node.js. Установите его с nodejs.org и запустите файл заново.
  goto :FAIL
)

echo [1/5] Забираю способности из OpenDota и локализации Valve...
call node tools\fetch-hero-abilities.js --force
if errorlevel 1 (
  echo [ОШИБКА] Не удалось получить данные. Проверьте интернет и попробуйте позже.
  goto :FAIL
)

echo.
echo [2/5] Проверяю снимок...
call node tools\check-hero-abilities.js
if errorlevel 1 (
  echo [ОСТАНОВЛЕНО] Снимок не прошёл проверку, на сайт он НЕ уедет.
  echo Данные на сайте остались прежними — ничего не сломано.
  goto :FAIL
)

echo.
echo [3/5] Копирую файл в папку deploy...
copy /y "data\hero-abilities.json" "deploy\data\hero-abilities.json" >nul
if errorlevel 1 (
  echo [ОШИБКА] Не удалось скопировать файл в deploy\data\.
  goto :FAIL
)

set "CLOUDFLARE_API_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0.env") do (
  if /i "%%a"=="CLOUDFLARE_API_TOKEN" set "CLOUDFLARE_API_TOKEN=%%b"
)
if not defined CLOUDFLARE_API_TOKEN (
  echo [ОШИБКА] В файле .env нет строки CLOUDFLARE_API_TOKEN=...
  goto :FAIL
)

echo.
echo [4/5] Публикую на dotamate.ru...
pushd deploy
call npx wrangler deploy
set "DEPLOY_CODE=%errorlevel%"
popd
if not "%DEPLOY_CODE%"=="0" (
  echo [ОШИБКА] Публикация не прошла. Чаще всего дело в токене Cloudflare:
  echo проверьте, что он не истёк и что с него снято ограничение по IP.
  goto :FAIL
)

echo.
echo [5/5] Проверяю сайт и сохраняю в GitHub...
call node tools\verify-live-abilities.js
if errorlevel 1 (
  echo [ВНИМАНИЕ] Файл опубликован, но сайт пока отдаёт прежнюю версию.
  echo Обычно это кеш: подождите минуту и откройте dotamate.ru заново.
)
call node tools\push-abilities.js

echo.
echo ================================================
echo   Готово. Способности на сайте обновлены.
echo ================================================
echo.
pause
exit /b 0

:FAIL
echo.
echo ================================================
echo   Не завершено. Сайт остался в прежнем виде.
echo ================================================
echo.
pause
exit /b 1
