# Dota 2 Helper v43 — streaming setup

## Что используется
- браузерный WebRTC publisher через MediaMTX;
- WHIP для OBS;
- RTMP для OBS/совместимых клиентов;
- WebRTC/HLS playback;
- WebSocket live-chat;
- подписки, модераторы и баны;
- stream sessions и архив сессий;
- Caddy HTTPS reverse proxy;
- Coturn с short-lived REST credentials для WebRTC ICE.

## Запуск
1. Скопируйте `.env.example` в `.env`.
2. Задайте `DOMAIN`, `PUBLIC_ORIGIN`, `PUBLIC_MEDIA_HOST`, `TURN_REALM`, `TURN_SECRET` и остальные секреты.
3. Выполните `docker compose up -d --build`.
4. Откройте `https://ВАШ-ДОМЕН/stream.html`.

## OBS / WHIP
Для браузерной публикации приложение использует WHIP endpoint MediaMTX вида:
`https://PUBLIC_MEDIA_HOST/SLUG/whip`

Stream key передаётся как временный publish token и не хранится в клиентском HTML.

## OBS / RTMP
MediaMTX принимает RTMP на порту 1935. Приложение показывает владельцу канала URL с параметрами `user` и `pass` после создания/ротации stream key.

Не публикуйте такой URL и не вставляйте его в открытые документы: stream key является секретом канала.

## TURN
Coturn использует shared secret. Браузер получает short-lived TURN credentials через `GET /api/stream/ice`; сам `TURN_SECRET` в браузер не передаётся.

Порты TURN: `3478/tcp`, `3478/udp` и relay range `49152-49252/udp`.

## MediaMTX
- playback (`read`) не требует stream key;
- publish/auth проверяется через `/api/mediamtx/auth`;
- WebRTC HTTP listener: `8889`;
- HLS listener: `8888`;
- RTMP listener: `1935`;
- WebRTC ICE UDP/TCP: `8189`.

## Безопасность
- не коммитьте `.env` и содержимое `secrets/`;
- stream keys ротируются через Studio;
- JWT и CSRF проверяются сервером;
- WebSocket больше не принимает имя пользователя от клиента;
- TURN secret никогда не отправляется браузеру;
- production должен работать через HTTPS.
