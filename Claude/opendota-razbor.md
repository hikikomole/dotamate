# OpenDota: разбор и замена источника

## Проверка 03.10.2026 ~19:00 МСК (с сервера Hostiman, s173–s176): фильтр skill у Steam GetMatchHistory
- `GetMatchHistory?skill=1|2|3&game_mode=22` — работает: списки по 100 матчей у skill 1/2/3 не пересекаются (0 общих). В выдаче lobby 0 и 7 — ранговые отбирать по lobby_type=7.
- История короткая: до 500 матчей на фильтр (~1 час игр); `start_at_match_id` старше окна → 0 матчей. Значит, сбор только частым опросом (раз в 30–40 мин), задним числом не догнать.
- Сверка с OpenDota publicMatches (avg_rank_tier) на тех же матчах (OpenDota в этот раз ответила 40 из 40 запросов):
  - Normal: 299 матчей, медиана 41 (Archon 1), p10 23, p90 51; Archon 128, Crusader 72, Legend 50, Guardian 37, Herald 12.
  - High: 89, медиана 54, p10 52, p90 55; Legend 83, Ancient 6.
  - Very High: 144, медиана 65, p10 61, p90 75; Divine 68, Ancient 65, Legend 11. Immortal в выборке 0.
- Вывод: Very High ≠ «Divine 5 и Immortal» (почти половина — Ancient). Normal+High ≈ Herald…Legend/начало Ancient — близко к срезу «до 4500», но граница не та же. Замена без пересчёта матриц и калибровки невозможна; годится как запасной источник с отдельным срезом.

## 25.09.2026: 4xx в воркере (исторически, воркер Cloudflare)
- За сутки api.opendota.com: 3 × 2xx, 59 × 4xx; прямые запросы — 522 через ~20 с с двух сетей; dotaconstants на GitHub и dota2.com/datafeed отвечали 200.
- Сайт не падал благодаря снимкам data/*.json. fetchJson: 3 попытки без таймаута → до 61 с ожидания.
- Предложено: таймаут 5 с, не ретраить 5xx, отрицательный кеш 10–15 мин, убрать неиспользуемый itemPopularity-эндпоинт или дать ему fallback, ключ OpenDota (цены не проверены).
- С v35 прод — PHP deploy/api/index.php на Hostiman; применимость этих пунктов к PHP-коду не перепроверена.
