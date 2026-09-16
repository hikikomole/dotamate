# Dota 2 Helper v43 — Local Preview

## Запуск

Запустите `Open Dota 2 Helper.cmd`. Сервер предпросмотра слушает `http://127.0.0.1:4173`.

Проверка: `http://127.0.0.1:4173/api/health` должна вернуть `ok: true` и `version: v43`.

Локальный preview не требует PostgreSQL/Redis и предназначен для проверки статических страниц и Dota data proxy. Production-функции профиля, стриминга и платежей требуют соответствующих сервисов и секретов.
