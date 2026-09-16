# Dota 2 Companion v43 — Platform Layer

v43 сохраняет существующую структуру сайта и объединяет локальный Companion с серверной платформой.

## Основные возможности
- серверные избранные герои;
- серверные билды;
- серверные пользовательские гайды;
- профиль с подписками и статистикой;
- каналы и stream sessions;
- WebRTC/WHIP/RTMP/HLS через MediaMTX;
- WebSocket чат;
- уведомления;
- CloudPayments donation intent + webhook HMAC.

## Канонические API
- `GET /api/streams`
- `GET /api/streams/:slug`
- `GET /api/channels/:slug`
- `GET /api/channels/:slug/sessions`
- `GET /api/channels/:slug/moderators`
- `GET /api/channels/:slug/bans`
- `GET /api/profile`
- `GET/POST/DELETE /api/profile/favorites`
- `GET/POST/DELETE /api/profile/builds`
- `GET/POST/PUT /api/profile/guides`
- `GET /api/guides`
- `POST /api/guides/:id/like`
- `GET /api/notifications`
- `GET /api/security/csrf`
- `GET /api/stream/ice`
- `GET /api/health`
- `GET /api/dota/heroes`
- `GET /api/dota/items`
- `GET /api/dota/item/:id` — официальное описание предмета (Valve datafeed), с автопереводом на RU через DeepL (см. `DEEPL_API_KEY` в `.env`)
- `GET /api/dota/hero/:id/items` — реальная популярность предметов у героя (OpenDota)
- `GET /api/dota/hero/:internal_name/abilities` — способности героя (OpenDota constants), с автопереводом на RU

## Проверки
Перед публикацией выполните:

```text
node --check server.js
node --check preview-server.js
node --check security.js
node --check js/*.js
```

Также проверьте YAML для `docker-compose.yml` и `mediamtx.yml`, HTTP 200 для статических страниц и отсутствие 404 для локальных assets.
