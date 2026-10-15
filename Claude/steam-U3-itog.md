# U3 — /stats/ на Steam, без «0–4500», автовыкладка только данных (04.10.2026, ~00:35–01:15 МСК)

**НЕ ВЫЛОЖЕНО.** Ждёт «выкладывай». Правки только на ПК (C:\Users\vsegd\Documents\DOTAMATE); сервер ~/dotamate-src не тронут, crontab не тронут, commit не делался. Ночной daily 04.10 04:17 идёт на старом коде.
Бэкап исходных файлов ПК: Claude outputs/u3-bak/. Стенд на сервере: ~/u3/stand (копия src + правки), результаты ~/u3/r.

## Что сделано (файлы ПК)
1. /stats/ на Steam
- tools/match-source.js — steamStream() (потоковое чтение gunzip+readline, повтор id проверяется внутри дневного файла), steamToPublic(), срез STEAM_TIER.all (все ранги). Старые функции не менялись.
- tools/build-stats.js — `--source steam`: все рейтинговые матчи всех рангов потоком (одним проходом), ранги 1–6 + группа 7 «Божество 5 и Титан» (ранг матча ≥ 75 из ленты OpenDota top; 70–74 в лентах не бывает); новое поле posSteam {labeled, stratz, model{created, test}, pos{1,2,3,sup}} — позиции по разметке U2 (tools/match-positions.js). `positions` (Stratz 1–5), линии и покупки — как раньше (страницы героев берут positions[1–5], контракт не менялся). base.src = 'steam'|'opendota'. Срез top подписывается по T.source (он всегда OpenDota). Пороги прежние.
- tools/daily-update.js — перед статистикой `collect-steam-matches.js --fill-ranks --days 3` (ранг свежих Steam-матчей из только что собранной OpenDota), затем `build-stats.js --source steam` (таймаут 1 ч). tools/update-site.js — тоже `--source steam`.
- js/stats.js, css/stats.css — строка «Данные с ДД.ММ.ГГГГ, матчей N»; срез «Все рейтинговые» (OpenDota — «Рекрут–Властелин»); «По рангам»: группы 1–6 обязательны, 7 — столбец при наличии; пока мало — плашка «Разрез по рангам копится» с числами; «Позиции»: 4 карточки Керри/Мид/Оффлейн/Поддержка 4–5 (Steam) с пояснением точности модели (92,16 % на test); исправлен null.onchange на пустой вкладке рангов.
2. «0–4500» убран со всего сайта (только тексты)
- page-sections.html (кнопка драфта, «Источники» драфта, подзаголовок /stats/), build-pages.js (описания /stats/, /meta/, карточка META), guide-content.js (counter-picks), js/draft-tool.js (подпись калибровки и строка под переключателем), js/home-daily.js («N рейтинговых матчей всех рангов»), js/me.js (подпись сравнения), tools/hero-stat-tiles.js (2 подписи на страницах героев), подписи slice в tools/build-our-stats.js и tools/build-meta.js (идут в hero-counters/our-matrix/meta-escape → гайды героев, counter-picks, /meta/).
- Переключатель в драфте: **«Рекрут–Властелин»** (предложение; матрица 'our' до U5 — OpenDota, ранги до Властелина, поэтому «Все ранги» сейчас было бы неправдой). В U5 после перевода матрицы на Steam — «Все ранги». Логика драфта не менялась.
- Остались только комментарии в коде (collect-public-matches.js, build-our-stats.js, build-meta.js — на сайт не идут).
3. Автовыкладка — только данные
- tools/code-fingerprint.js (новый): md5 файлов кода (*.js/*.mjs/*.css вне data/deploy/logs/служебных папок, page-shell.html, page-sections.html, deploy/api/*.php, .htaccess, seo/*.json, assets/**) → ~/dotamate-data/code-fingerprint.json. На боевом src: 1 359 файлов, 0,15 с.
- tools/deploy-hostiman.js: после успешной выкладки на сервере пишет отпечаток (с номером версии).
- tools/daily-update.js: сверка в начале и перед sync. Расхождение (или нет отпечатка) → всё пересчитывается, sync/deploy пропускаются, в logs/daily-*.log: «ВЫКЛАДКА ЗАБЛОКИРОВАНА: код на сервере изменён после выкладки версии N (k файлов: изменён js/stats.js, новый tools/…)», код выхода 2, отметка успеха не пишется (10:17 повторит и снова заблокирует, пока не будет ручной выкладки). Совпало → «Код совпадает с выложенной версией N — выкладка данных разрешена».
- Ручная проверка: `node tools/code-fingerprint.js --check` (0 — совпадает, 1 — нет, список файлов).
4. js/me.js из T4 (played(): лобби без игры не «Победа») + новая подпись — в этой же выкладке.

## Проверки
- Регрессия OpenDota (сервер, стенд): build-stats.js без флага, старый код vs новый — stats.json идентичен, кроме builtAt, base.source (без «0–4500») и нового base.src. 1 195 115 матчей, 3,8 с.
- Steam (стенд, данные сервера на 00:45): 32 973 матча (02.10 15:19 — 03.10 21:24 UTC), ранг известен у 23,5 %; группы рангов 127/478/1 028/1 620/1 812/1 146/1 548; тир-лист 103 героя; posSteam: размечено 32 973 матча (85 по Stratz), Керри/Мид/Оффлейн по 65 946 игроков, поддержка 131 892, героев с ≥ 30 матчей 61/102/95/113; 4,5 с. Героев со всеми 6 рангами ≥ 300 — 0 (разрез появится по мере накопления).
- Время на боевом объёме не замерено (данных пока мало). Оценка по U2: чтение ~75 мкс/матч + разметка ~29 мкс/матч → при ~325 тыс. ranked/сутки × 30 дней ≈ 9,7 млн матчей ≈ 17 мин. Таймаут шага 1 ч.
- Защита выкладки (стенд, daily-update с заглушками шагов, DOTAMATE_SERVER=1): нет отпечатка → блок, exit 2; отпечаток записан → «совпадает», sync+deploy вызваны, exit 0; изменён js/stats.js + новый tools/zz-new.js → блок с перечнем двух файлов, exit 2; `--check` после отката → 0.
- Сборка в стенде: build-pages 11 стр., build-hero-pages 127, build-our-stats/hero-counters/meta/hero-guides/guide-pages — exit 0; «0–4500» в deploy (html/js/json) — 0 файлов.
- Playwright (облако, статика стенда + ассеты ПК, /api/dota/player — реальные ответы прода 1855062057 и закрытый 87278757), 1440 и 390: /stats/ все 9 вкладок, срез Divine 5 и Immortal (127 строк), /me с профилем (подпись «…всех рангов»), драфт на главной (кнопки «Divine 5 и Immortal | Рекрут–Властелин | Stratz»), 10 страниц героев (axe, pudge, invoker, antimage, crystal_maiden, juggernaut, lion, phantom_assassin, sniper, earthshaker) — ошибок JS 0 (внешние счётчики на стенде заблокированы, 404 /api/dota/hero-positions|hero-stats — нет на стенде).

## Выкладка (по «выкладывай»)
Готово: Claude outputs/shell/s960.cmd.ready (переименовать в shell/in/s960.cmd) + s960.sh: push-server && на сервере build-stats --source steam → build-our-stats → build-hero-counters → build-meta → build-pages → build-hero-pages → build-hero-guides → build-guide-pages → sync → deploy-hostiman (пишет отпечаток) → проверка: версия, `code-fingerprint --check`, «0–4500» на сайте = 0, stats.json src steam, ?v= у stats.js/me.js, md5 me.js.
build-our-stats/hero-counters/meta нужны, чтобы новые подписи slice попали в гайды героев, counter-picks и /meta/ сразу (на стенде 3 с + 0 с + 2 с).

## Для U4/U5
- Остальные сборщики (матрица, калибровка, META, билды) читают Steam через steamMatches() целиком — на боевом объёме нужен steamStream().
- Переключатель драфта в U5 → «Все ранги».
- data/stats-history-steam/ — новый ряд «Динамики» (OpenDota-ряд не смешивается); первые дни вкладка покажет «История копится».
