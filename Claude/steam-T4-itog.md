# T4 — /me на Steam Web API (03.10.2026, НЕ выложено)

## Что оказалось
Всё ядро T4 уже работало с v35 (claude/plan-me-profil.md): deploy/api/index.php — GetMatchHistory (100 матчей, кеш 1 ч), GetMatchHistoryBySequenceNum (кеш m/<match_id>.json бессрочно, .miss 1 ч, бюджет/flock/таймауты), status 15 → 403 history_unavailable; js/me.js — инструкция «Настройки → Сообщество → Общедоступная история матчей», сравнение с data/stats.json и подпись «база 0–4500 MMR». Потребители /api/dota/player: только js/me.js (+ комментарии в build-pages.js, tools/collect-steam-matches.js). Express server.js этот путь не обслуживает. Контракт не менялся.

## Найдено и исправлено (только js/me.js)
- Steam отдаёт в истории лобби без игры (lobbyType 4, heroId 0, duration 0, radiant_win=true). Раньше они считались «Победой» с «Герой #0» и шли в винрейт/топ героев. Теперь функция played(m) (details, win, heroId>0, duration>0): такие строки — «не сыгран», герой «—», в победы и «Мои герои» не входят.

## Проверка
- Прод (php на сервере, s906/s908): 1855062057, 822501650, 111296588 — 200, total 500, 20 матчей, 20/20 с подробностями; 87278757 → history_unavailable; abc → bad_id. Ключ (32 символа) не найден ни в одном .js/.html/.json в ~/www/dotamate.ru и ~/dotamate-src/deploy.
- Стенд (облако, Playwright 1366 px, ответы API — реальные с прода, только offset=0): 3 открытых профиля — таблица и «Мои герои»; у 111296588 3 лобби «не сыгран», победы 12 из 17; закрытый — «История матчей закрыта» с инструкцией; обрыв соединения — «Нет связи с сервером». Ошибок JS 0. Скриншоты t4-*.png в outputs чата.
- Ограничение стенда: php-CLI на сервере не заполняет $_GET, поэтому догрузка offset 20–80 на стенде не проверялась (на проде работает с v35). data/stats.json на стенде — с ПК, не свежий с сервера.

## Для выкладки
Изменён только js/me.js — шаблон s129/s119 (push → build-pages → sync → deploy).
