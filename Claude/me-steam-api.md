# Задача 4 (/me) — разведка источников, 03.10.2026

Решение владельца 03.10: OpenDota с серверов Hostiman не работает → свой сервис. План ChatGPT («своя платформа с реплеями») разобран, см. ниже.

## Проверено (03.10.2026, с компьютера владельца, ключ secrets/steam-api-key.txt)
- OpenDota бесплатно: 3000 запросов/сутки, 60/мин (api.opendota.com/api/metadata: freeCallLimit 3000, freeRateLimit 60; заголовки x-rate-limit-remaining-*). Лицензии odota/core и odota/parser — MIT.
- Steam Web API, лимит 100 000 вызовов/сутки на ключ (steamcommunity.com/dev/apiterms). Условия: политика конфиденциальности, данные «как есть», не создавать впечатление связи с Valve.
- IDOTA2Match_570/GetMatchHistory?account_id=…: 200, ~0,7 с; до 100 матчей за запрос, всего до 500 (total_results 500). В ответе только match_id, match_seq_num, start_time, lobby_type, герои всех игроков — без победы и K/D/A. Закрытая история: status 15 «Cannot get match history for a user that hasn't allowed it» (так у 87278757 и у id 1). Выборка 15 открытых id из ленты: 15 из 15 открыты.
- GetMatchDetails: HTTP 500 на завершённых матчах (2 из 2) — не использовать.
- Полные данные матча: GetMatchHistoryBySequenceNum?start_at_match_seq_num=<seq матча>&matches_requested=1 — тот же match_id, есть radiant_win, duration, game_mode, players[] с kills/deaths/assists, items, gold_per_min, xp_per_min, net_worth, hero_damage, ability_upgrades. 20 из 20 матчей, 8,3 с последовательно (~0,4 с на запрос), ~15 КБ на матч. Этот приём описан в odota/core svc/fetcher/ApiFetcher.ts.
- Лента по номеру (100 матчей): 1,5 МБ; анонимных игроков (account_id 4294967295) 588 из 1000. Ранга/MMR в ленте и в истории нет.
- С сервера Hostiman НЕ проверено: SSH 03.10 не подключался (s154, s155 — timeout, SSH_EXIT=255). Задание s154.sh/s155 готово.

## Вывод
- Для /me реплеи, GC, Java-парсер, PostgreSQL не нужны: хватает Steam Web API.
- Ранг игрока Steam Web API не даёт → сравнение с общим винрейтом героя из data/stats.json (база 0–4500 MMR), с подписью.
