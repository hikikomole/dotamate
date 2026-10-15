# Стримы пользователей на DotaMate — анализ и план (02.10.2026, черновик, не утверждён)

## Что уже есть в проекте (проверено по файлам)
- server.js (Node, 316 строк, без Express): регистрация/вход (JWT, bcrypt, CSRF), каналы (`POST /api/channels`, ключ трансляции хранится как SHA-256), ротация ключа, `/api/streams`, `/api/streams/:slug`, live вкл/выкл + stream_sessions + уведомления подписчикам, `/api/mediamtx/auth` (проверка ключа для MediaMTX), `/api/stream/ice` (временные TURN-пароли), WebSocket-чат `/ws?channel=` (история в Redis, удаление, бан, счётчик зрителей), донаты CloudPayments (заготовка).
- db/schema.sql + initDb: users, channels, subscriptions, moderators, bans, stream_sessions, donations…
- mediamtx.yml (RTMP 1935, WHIP/WebRTC 8889, HLS 8888, UDP 8189), docker-compose.yml (app, postgres, redis, backup, mediamtx, coturn, caddy), Caddyfile (media./hls. поддомены), STREAMING_SETUP.md.
- НЕТ фронтенда: stream.html / channel.html / studio / клиентского API — в проекте не найдено ни одного файла, который вызывает /api/streams или /ws.

## Главная проблема
- dotamate.ru сейчас — Hostiman RuGold (виртуальный хостинг, PHP, ispmanager). Docker, MediaMTX, coturn, постоянный Node-процесс с открытыми портами и UDP там, по всей видимости, запустить нельзя (проверить в шаге 0).
- Видео — это трафик: один зритель 720p ≈ 2,5 Мбит/с ≈ 1,1 ГБ/час; 100 зрителей ≈ 250 Мбит/с. Нужен отдельный VPS в РФ с безлимитным/широким каналом.

## Схема
- dotamate.ru (Hostiman) — страницы как сейчас.
- stream.dotamate.ru (новый VPS) — docker compose из проекта: app(server.js)+postgres+redis+mediamtx+coturn+caddy.
- Стример: OBS → RTMP/WHIP или кнопка «Начать эфир» в браузере (WHIP).
- Зритель: WebRTC (задержка < 1 с), запасной HLS.

## Этапы
0. Проверка и выбор VPS (без изменений сайта): что разрешает Hostiman; VPS РФ 2–4 vCPU, 4 ГБ, 100 Мбит+; поддомен stream.
1. Сервер: развернуть compose на VPS, секреты только на VPS, пин версий образов (сейчас :latest), healthcheck; включить запись live по факту публикации (хуки MediaMTX runOnReady/runOnNotReady), а не по кнопке браузера.
2. Аудит server.js перед запуском: безопасность (CORS webrtcAllowOrigins '*', гостевой чат, лимиты), N+1 в /api/streams, мёртвый live-beacon.
3. Фронтенд (vanilla JS, существующая вёрстка): /streams/ список эфиров, /stream/<канал> плеер+чат, /studio/ создать канал, ключ, «Начать эфир» из браузера, инструкция для OBS; вход/регистрация.
4. Модерация и правила: жалобы, бан, отключение эфира админом, правила сообщества; ограничения нагрузки (макс. одновременных эфиров/битрейт).
5. Проверка на стенде (нагрузка: N зрителей), затем выкладка по «выкладывай».
6. Потом: записи эфиров, донаты (CloudPayments), уведомления.

## Решения владельца
- VPS: какой и бюджет.
- Кто может стримить: все сразу или по заявке.
- Чат для гостей или только для зарегистрированных.
