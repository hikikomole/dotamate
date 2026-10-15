# U5 — сборка перехода на Steam (09.10.2026) — ВЫЛОЖЕНО v59, 12:01 МСК

## 1. Сверки data-steam/compare-*.json
| День | Статус | WR ср/макс, r | Пар <50 Steam / OD окно | a, угадано Steam / сайт | Матчей Steam |
|---|---|---|---|---|---|
| 04.10 | первый прогон, мало данных | 0,71 / 3,57, 0,933 | 1 195 / 365 | 0,00494, 56,14 / 56,53 % | 89 623 |
| 05–07.10 | сбой (SIGKILL, LVE) — повтор цифр 04.10, не годятся | — | — | — | — |
| 08.10 (перезапуск 18:17) | годен | 0,41 / 1,79, 0,975 | 26 / 53 | 0,005004, 56,64 / 56,62 % | 979 731 |
| 09.10 | годен | 0,38 / 2,03, 0,979 | 21 / 40 | 0,004949, 56,63 / 56,63 % | 1 082 485 |
Критерии выполнены 08 и 09.10 (владелец сократил период до суток).

## 2–3. Что изменено (ПК → сервер push-server; бэкап ПК Claude outputs/u5-bak/)
- tools/match-source.js, build-our-stats.js, build-draft-calibration.js, build-meta.js, fetch-hero-builds.js — из steam-track (потоковое чтение) + `--main` (срез all → our-matrix/our-meta/draft-calibration.json) и `--site` (fetch-hero-builds).
- fetch-hero-builds: Stratz → data/builds-stratz/ (при первом запуске копия прежних data/builds); `--source steam --site` → data/builds/ в контракте POSITION_1…5: прокачка/таланты Steam, «саппорт» → ключи 4/5 из билда Stratz (нет — больший из 4/5 по hero-positions.json), предметы Stratz, поле supMerged.
- daily-update.js / update-site.js — см. claude/ezhednevnoe-obnovlenie.md. Убраны: докачка истории OpenDota (основная лента), backfill покупок Stratz; Stratz --max 8000 → 2000.
- sync-deploy.js: builds-stratz в SKIP_DIRS.
- Фронт: драфт «Все ранги»; js/meta.js — позиция 'sup' («Поддержка 4–5», кнопка 5 скрыта, ниши 1/2/3/sup); js/hero-builds.js — подписи источника Steam.
- crontab: строка `13 7 * * * $HOME/dotamate-steam/run.sh` убрана (бэкап ~/u5/crontab.bak); data-steam/, ~/dotamate-steam, ~/u4 — оставлены до подтверждения владельца.

## Проверки
- Регрессия OpenDota (top, base) старый vs новый код: 5 файлов SAME.
- Стенд Playwright: 388 страниц × 1440/390 (главная, /stats/, /meta/, матч META, /me, /items/, /heroes/, /live/, 127 героев, 253 предмета) — ошибок JS 0.
- Выкладка (~/u5/deploy.sh под heavy.lock): матрица 13 пар <50, калибровка 127,7 п.п. → 65,6 %, турбо, META 989 962 матча / 188 страниц, прокачка 1 200 455 матчей (сверка со Stratz 87,7 % / 89,4 %), контрпики и /stats/ 1 200 455 матчей; удалено 170 старых meta-match из deploy. site-version 59, отпечаток совпадает.

## Известные ограничения
- Матчи META на Steam: без ников игроков (Скрытый профиль) и без итога линий.
- Предметы в билдах — Stratz от 25.09, пока Stratz отвечает 429.

## Дальше (решение владельца 09.10)
1. Сборщик реплеев: ~180 матчей/сутки (2 аккаунта × 90; третий аккаунт — строки в secrets/Steam.txt не полные: 5 строк) + проверить долю матчей ленты, разобранных у OpenDota (purchase_log). Принести цифры.
2. Затем блок «Что покупают»: Steam (что) + время из реплеев — скриншотом.
