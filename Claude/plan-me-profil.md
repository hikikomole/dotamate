# План: «Мой профиль» /me на Steam Web API (утверждён владельцем 03.10.2026) — ✅ ВЫЛОЖЕНО в v35; L1 (08.10) — ждёт «выкладывай»

## L1 (08.10.2026) — сводка на сервере, тенденция, гайды, карточка. ЖДЁТ ВЫКЛАДКИ
Файлы на ПК: deploy/api/index.php, js/me.js, css/theme-dark.css (блок «/me — L1» в конце), deploy/.htaccess (RewriteRule ^me/card/…), deploy/api/fonts/DejaVuSans(-Bold).ttf + LICENSE-DejaVu.txt. Внимание: на ПК в js/me.js уже лежали правки U3/T4 (не выложены) — выкладка L1 выложит и их.
- Контракт: ответ `/api/dota/player/<id>/matches` получил поле `summary` (старые поля не менялись): `{matches, all, heroes[], trend, minGames:10, z:1.96}`; `all`/герой = `{games,wins,wr,ci:[lo,hi],k,d,a,kda,gpm,xpm}` (+heroId у героя). `ci` — интервал Уилсона 95 %. Сводка по страницам 0..offset из кеша, Steam не вызывается. Сыгранный матч = details, win, heroId>0, duration>0.
- `trend` — последние N против предыдущих N, N = min(20, сыгранных/2), только при N ≥ 10; `z`, `sig` — z-тест двух долей (объединённая оценка), |z|>1,96.
- Роли/позиции НЕ выводятся: Steam Web API их не даёт (lane_role есть только у OpenDota для разобранных матчей, OpenDota с сервера недоступна); модель data/position-model.json — оценка, а не данные, по задаче «не угадывать».
- Карточка: `POST /api/dota/player/<id>/card` (только Origin dotamate.ru, только из кеша, ≥10 сыгранных) → 201 `{token,url:/me/card/<20 hex>/,image:/api/dota/card/<tok>.png}`; 403 forbidden, 400 bad_id, 409 no_data/not_enough, 429 rate_limited (500 карточек/сутки). Снимок ~/dotamate-data/cards/<tok>.json без Steam ID и номеров матчей, хранится 180 дн. PNG 1200×630 через GD (FreeType). `/me/card/<tok>/` — страница с og:*, twitter:card, noindex.
- UI: «Мои герои» (игр, винрейт с интервалом, средний, оценка — средний героя вне интервала Уилсона, K/D/A, GPM, XPM, ссылка /hero/<slug>/guide/), «Тенденция», «Выводы», «Поделиться результатом» (кнопка, после догрузки всех матчей).
- Проверка (стенд в облаке, php 8.3 -S + Playwright, тестовый кеш 100 матчей): сводка сверена со statsmodels (Уилсон, z-тест) — 0 расхождений по всем, 6 героям, обоим окнам; wilson(0,10), (10,10), (1,1) совпадают; 1366 и 390 px без горизонтальной прокрутки страницы; закрытый профиль, пустой профиль, ошибка Steam — свои сообщения; ошибок JS нет. Никнеймов в данных нет (Steam API их не отдаёт) — XSS-поверхность только числа; токен ограничен [a-f0-9]{20}, вывод через htmlspecialchars/esc.
- После выкладки проверить на сервере: php -l, `curl -X POST -H 'Origin: https://dotamate.ru'` …/card на открытом ID, PNG 200 image/png, /me/card/<tok>/ 200 через .htaccess.

## Решения владельца
- Без входа. Steam ID хранится только в браузере (localStorage `dmSteamId`).
- Источник — Steam Web API (ключ secrets/steam-api-key.txt). Реплеи, GC, PostgreSQL, TypeScript, /api/v1 — НЕ используем.
- Список матчей игрока — кеш 1 час; данные матча — бессрочно (матч не меняется), с пределом объёма кеша.
- Сразу 20 матчей, в фоне догрузка до 100 для топа героев.
- Ссылка «Мой профиль» в шапке. Telegram из шапки убрать, оставить только в подвале.
- Сравнение винрейта — с общим винрейтом героя из data/stats.json (ранга игрока Steam не даёт), с подписью.
- Эфир (/live, сборщик реплеев, аккаунты Steam.txt) и статистика (daily-update, build-stats, stats.json) — не трогать.
- Политика (03.10): основание обработки для /me — согласие (вводя Steam ID); п. 2.2 честно говорит, что Вебвизор может записать ввод в поля.

## Контракт API
`GET /api/dota/player/<id>/matches?offset=N`, N ∈ {0,20,40,60,80}.
- `<id>`: только цифры; 1–10 цифр (1…4294967294) или 17 цифр с префиксом 7656119 (64-бит → минус 76561197960265728). Иначе 400.
- 200: `{"accountId":123,"offset":0,"total":500,"cachedAt":1791000000,"matches":[{"matchId":9027113309,"start":1791018213,"duration":2400,"gameMode":22,"lobbyType":7,"heroId":46,"radiant":false,"win":true,"k":1,"d":7,"a":0,"gpm":311,"xpm":451,"lastHits":138,"netWorth":9232,"heroDamage":10278,"items":[0,36,236,168,63,11],"details":true}],"summary":{…L1…}}`
  - Если подробности матча не получены: `details:false`, поля duration, gameMode, win…items = null.
  - `total` — total_results из Steam (не больше 500).
- Ошибки — JSON `{"error":"<код>"}`: 400 bad_id / bad_offset; 403 history_unavailable (Steam status 15); 429 busy (Retry-After 5) / rate_limited (Retry-After 60 или до полуночи); 504 timeout; 502 upstream_error; 503 not_configured.
- Cache-Control: no-store.

## Сервер
- Ключ: `~/dotamate-data/secrets/steam-api-key.txt` (права 600). Никогда в логи/ответы.
- Кеш: `~/dotamate-data/cache/steam/` — hist-<accountId>-<offset>.json (1 ч), m/<matchId>.json (бессрочно), m/<matchId>.miss (1 ч). Предел 200 МБ, чистка до 90 % по mtime не чаще раза в 10 мин.
- Бюджет: budget.json (60 000 из 100 000 в сутки), 2 слота flock, таймаут вызова 8 с, общий ≤ 25 с.
- Подробности матча: GetMatchHistoryBySequenceNum с matches_requested=1 и сверкой match_id. GetMatchDetails не использовать (500).
- Сервер (08.10): PHP GD с FreeType и PNG есть, ImageMagick есть; системных шрифтов нет — шрифты лежат в deploy/api/fonts.

## Результат E (03.10.2026, v35, 18:33 МСК)
- Выкладка s171: версия 34 → 35. php -l без ошибок; 751/751 страниц со ссылкой /me/; /api/dota/player/1855062057 → 200, total 500; `..%2f` → bad_id. IndexNow: /me/ и /privacy/ — HTTP 200.

## Замечено, не сделано
- На /hero/, /item/, /guide/, /privacy/ в шапке нет значка «Патч 7.41f» (на /, /stats/, /me/ есть) — было до v35.
- js/home-daily.js строит ссылку героя из name (Vengeful Spirit → /hero/vengefulspirit/, нужна /hero/vengeful_spirit/).
- OpenDota с сервера отвечает нестабильно (522/521).
- Эффект /me сверить по Метрике через 1–2 недели (посещения /me/).
