@echo off
cd /d "%~dp0.."
if not exist _deploy\server mkdir _deploy\server
ssh -i "%USERPROFILE%\.ssh\dotamate_hostiman" -p 8228 s278486@ruvip72.hostiman.ru "cd ~/dotamate-src && tar -cf - --ignore-failed-read build-pages.js page-sections.html js/me.js js/meta.js css/me.css css/meta.css css/home-hero.css tools/daily-update.js tools/sync-deploy.js docs/architecture/statistics.md docs/architecture/data-independence.md 2>/dev/null" | tar -xf - -C _deploy\server
echo.
echo ГОТОВО. Напишите Claude: "шаг 1 готов"
pause
