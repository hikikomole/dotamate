## Назначение файла

Файл `server.js` является бэкенд-сервером приложения Dota 2 Helper, написанным на Node.js без использования внешних HTTP-фреймворков. Он предоставляет REST API для аутентификации, управления профилями пользователей, избранными героями, сборками предметов, гайдами, каналами стриминга, подписками, модерацией, уведомлениями и донатами. Также файл реализует прокси-слой к внешним API OpenDota и Valve с кэшированием в Redis и встроенный WebSocket-сервер для чата трансляций и отслеживания зрителей.

## Зависимости и конфигурация

### NPM-модули
*   `http` (встроенный): создание HTTP-сервера, обработка входящих запросов и ответов.
*   `fs` (встроенный): чтение файлов секретов (переменные с суффиксом `_FILE`) и статических файлов фронтенда.
*   `path` (встроенный): резолв путей к файлам при раздаче статики.
*   `crypto` (встроенный): генерация CSRF-токенов, случайных ключей, HMAC-подписей, SHA-256 хешей ключей трансляций и криптографически безопасное сравнение байтов (`timingSafeEqual`).
*   `bcryptjs`: хеширование паролей пользователей при регистрации и их проверка при входе.
*   `jsonwebtoken`: создание и проверка JWT-токенов аутентификации.
*   `ws`: реализация WebSocket-сервера для чата и счетчика присутствия.
*   `pg` (`Pool`): пул соединений с базами данных PostgreSQL.
*   `redis` (`createClient`): реализация Redis-клиентов (`redis`, `pub`, `sub`) для кэширования, отслеживания присутствия, ограничений частоты запросов и Pub/Sub рассылки чата.

### Переменные окружения
*   `PORT`: порт для HTTP-сервера (по умолчанию `3000`).
*   `JWT_SECRET` / `JWT_SECRET_FILE`: секретный ключ для JWT (длина минимум 32 символа).
*   `DATABASE_URL` / `DATABASE_URL_FILE`: строка подключения к PostgreSQL.
*   `REDIS_URL` / `REDIS_URL_FILE`: URL подключения к Redis (по умолчанию `redis://redis:6379`).
*   `PUBLIC_MEDIA_HOST`: хост медиа-сервера (по умолчанию `localhost`).
*   `MEDIA_SCHEME`: протокол медиа-сервера (`http` по умолчанию).
*   `MEDIAMTX_WEBRTC_PORT`: порт WebRTC MediaMTX (по умолчанию `8889`).
*   `MEDIAMTX_HLS_PORT`: порт HLS MediaMTX (по умолчанию `8888`).
*   `PUBLIC_ORIGIN`: разрешенный домен CORS/CSRF (обязателен в режиме `production`).
*   `NODE_ENV`: режим работы (`production` включает строгие проверки).
*   `DB_POOL_MAX`: максимальное количество соединений в пуле PG (по умолчанию `20`).
*   `DB_SSL`: включение SSL для подключения к PG (`true`/`false`).
*   `DB_SSL_REJECT_UNAUTHORIZED`: проверка SSL-сертификата PG (`false` для самоподписанных).
*   `PUBLIC_MEDIA_BASE`, `PUBLIC_HLS_BASE`, `PUBLIC_RTMP_BASE`: переопределение базовых URL для потоков WebRTC, HLS и RTMP.
*   `TURN_SECRET`, `TURN_HOST`, `TURN_REALM`: параметры для генерации временных учетных данных TURN/ICE.
*   `CLOUDPAYMENTS_PUBLIC_ID`: публичный идентификатор терминала CloudPayments.
*   `CLOUDPAYMENTS_API_SECRET` / `CLOUDPAYMENTS_API_SECRET_FILE`: секретный ключ для проверки HMAC-подписи вебхуков CloudPayments.

## HTTP-эндпоинты

| Метод и путь | Что делает | Требует ли авторизации | Что отдаёт |
| :--- | :--- | :--- | :--- |
| `GET /api/health` | Проверка работоспособности сервера | Нет | JSON `{ok: true, version: 'v43'}` |
| `GET /api/stream/ice` | Получение временных учетных данных TURN/ICE | Нет (опционально читает JWT) | JSON `{iceServers: [...]}` |
| `GET /api/dota/heroes` | Проксирование списка героев из OpenDota | Нет | JSON массив героев |
| `GET /api/dota/items` | Получение агрегированного списка предметов | Нет | JSON массив предметов |
| `GET /api/dota/item/:id` | Детальные данные предмета с локализацией на русский | Нет | JSON объект предмета с полем `desc_loc` |
| `GET /api/dota/hero/:id/items` | Получение популярных предметов для героя из OpenDota | Нет | JSON объект популярности предметов |
| `GET /api/dota/hero/:name/abilities` | Список способностей героя с локализацией на русский | Нет | JSON массив способностей |
| `GET /api/security/csrf` | Генерация CSRF-токена и запись в cookie `d2h_csrf` | Нет | JSON `{csrfToken: string}` |
| `POST /api/auth/register` | Регистрация нового пользователя | Нет (Rate Limit: 8/15 мин) | JSON `{token, user}` |
| `POST /api/auth/login` | Аутентификация пользователя | Нет (Rate Limit: 12/15 мин) | JSON `{token, user}` |
| `GET /api/auth/me` | Получение данных профиля из JWT | Да (Bearer JWT) | JSON `{user}` |
| `GET /api/profile/channel` | Получение канала текущего пользователя | Да (Bearer JWT) | JSON `{channel}` |
| `GET /api/profile` | Сводная информация о профиле (избранное, сборки, гайды, подписки) | Да (Bearer JWT) | JSON `{user, favorites, builds, guides, subscriptions, stats}` |
| `GET /api/profile/favorites` | Получение списка ID избранных героев | Да (Bearer JWT) | JSON `{favorites: number[]}` |
| `POST /api/profile/favorites` | Полная перезапись списка избранных героев | Да (Bearer JWT) | JSON `{ok: true, favorites: number[]}` |
| `DELETE /api/profile/favorites/:id` | Удаление героя из избранных | Да (Bearer JWT) | JSON `{ok: true}` |
| `GET /api/profile/builds` | Получение сборок предметов пользователя | Да (Bearer JWT) | JSON `{builds: [...]}` |
| `POST /api/profile/builds` | Создание новой сборки предметов | Да (Bearer JWT) | JSON `{build}` |
| `DELETE /api/profile/builds/:id` | Удаление сборки предметов | Да (Bearer JWT) | JSON `{ok: true}` |
| `GET /api/profile/guides` | Получение списка гайдов пользователя | Да (Bearer JWT) | JSON `{guides: [...]}` |
| `POST /api/profile/guides` | Создание нового гайда | Да (Bearer JWT) | JSON `{guide}` |
| `PUT /api/profile/guides/:id` | Редактирование гайда пользователя | Да (Bearer JWT) | JSON `{guide}` |
| `GET /api/guides` | Получение опубликованных гайдов с пагинацией | Нет | JSON `{guides: [...], page, limit}` |
| `POST /api/guides/:id/like` | Переключение лайка на гайде (лайк/дизлайк) | Да (Bearer JWT) | JSON `{liked: boolean}` |
| `GET /api/channels/:slug/sessions` | История стрим-сессий канала | Нет | JSON `{sessions: [...]}` |
| `GET /api/payments/config` | Проверка конфигурации эквайринга | Нет | JSON `{provider, enabled, publicTerminalId}` |
| `GET /api/notifications` | Получение списка уведомлений пользователя | Да (Bearer JWT) | JSON `{notifications: [...], unread: number}` |
| `POST /api/notifications/read` | Отметка уведомлений как прочитанных | Да (Bearer JWT) | JSON `{ok: true}` |
| `GET /api/streams` | Список всех каналов и их live-статусов | Нет | JSON `{streams: [...]}` |
| `GET /api/streams/:slug` | Подробная информация о стриме | Нет (опционально читает JWT) | JSON объекта канала с флагами прав доступа |
| `POST /api/channels` | Создание нового канала трансляции | Да (Bearer JWT) | JSON `{channel, streamKey}` |
| `PUT /api/channels/:slug` | Обновление информации о канале | Да (Владелец) | JSON `{channel}` |
| `GET /api/channels/:slug` | Публичные данные канала | Нет | JSON `{channel, owner}` |
| `POST /api/channels/:slug/rotate-key` | Ротация ключа трансляции | Да (Владелец) | JSON `{streamKey}` |
| `POST /api/channels/:slug/live-beacon` | Сигнал завершения стрима (beacon) | Да (Владелец) | JSON `{ok: true}` |
| `POST /api/channels/:slug/live` | Изменение статуса прямого эфира (on/off) | Да (Владелец) | JSON `{ok: true, live, changed}` |
| `POST /api/channels/:slug/subscribe` | Подписка или отписка от канала | Да (Bearer JWT) | JSON `{subscribed: boolean}` |
| `GET /api/channels/:slug/moderators` | Список модераторов канала | Да (Модератор/Владелец/Admin) | JSON `{moderators: [...]}` |
| `GET /api/channels/:slug/bans` | Список заблокированных пользователей канала | Да (Модератор/Владелец/Admin) | JSON `{bans: [...]}` |
| `POST /api/channels/:slug/moderators` | Добавление модератора канала | Да (Модератор/Владелец/Admin) | JSON `{ok: true}` |
| `DELETE /api/channels/:slug/moderators/:username` | Удаление модератора канала | Да (Модератор/Владелец/Admin) | JSON `{ok: true}` |
| `POST /api/donations` | Создание записи о донате | Нет (опционально привязывает JWT) | JSON `{donationId, externalId, status, provider, enabled, message}` |
| `POST /api/webhooks/cloudpayments/pay` | Обработка вебхука оплаты CloudPayments | Нет (Проверка HMAC-подписи) | JSON `{code: 0}` |
| `POST /api/moderation/ban` | Блокировка пользователя на канале | Да (Модератор/Владелец/Admin) | JSON `{ok: true}` |
| `POST /api/mediamtx/auth` | Валидация ключа трансляции для MediaMTX | Нет (Сравнение SHA-256 хеша ключа) | JSON `{}` (200) или `{error}` (401) |

## Middleware и безопасность

*   **HTTP заголовки безопасности (`securityHeaders`)**:
    *   `Content-Security-Policy`: устанавливает правила загрузки ресурсов (скрипты с `self`, `unsafe-inline`, `widget.cloudpayments.ru`; стили с `self`, `unsafe-inline`, `fonts.googleapis.com`; картинки, медиа, шрифты и фреймы).
    *   `Permissions-Policy`: разрешает использование `camera`, `microphone`, `display-capture` только для собственного домена.
    *   `X-Content-Type-Options`: `nosniff`.
    *   `X-Frame-Options`: `SAMEORIGIN`.
    *   `Referrer-Policy`: `strict-origin-when-cross-origin`.
    *   `Strict-Transport-Security`: задается при `NODE_ENV === 'production'` (`max-age=31536000; includeSubDomains; preload`).
*   **CORS и Origin Validation**:
    *   Функция `checkOrigin` сопоставляет заголовок `Origin` с переменной `PUBLIC_ORIGIN`. При несоответствии сервер возвращает `403 CORS origin denied`.
    *   Для HTTP-метода `OPTIONS` возвращается статус `204 No Content` с соответствующими заголовками `Access-Control-Allow-*`.
*   **Защита от CSRF (`requireCsrf`)**:
    *   Для изменяющих запросов (`POST`, `PUT`, `DELETE`), исключая вебхуки `/api/webhooks/` и авторизацию медиасервера `/api/mediamtx/auth`, сверяется значение заголовка `X-CSRF-Token` и значение из cookie `d2h_csrf`.
    *   Сравнение значений выполняется через `crypto.timingSafeEqual` для предотвращения атак по времени.
*   **Ограничение частоты запросов (Rate Limiting)**:
    *   Реализовано с использованием Redis (`INCR` + `EXPIRE`) и фолбэком на локальный `Map` (`localRateFallback`).
    *   Глобальный лимит API (`rateLimit`): 300 запросов в минуту на один IP-адрес.
    *   Лимит регистрации (`/api/auth/register`): 8 попыток за 15 минут с одного IP.
    *   Лимит входа (`/api/auth/login`): 12 попыток за 15 минут с одного IP.
*   **Контроль размера тела запроса**:
    *   Функция `rawBody` ограничивает объем принимаемых данных (по умолчанию до 2 МБ, для обычных JSON-тел — до 1 МБ). При превышении соединение сбрасывается (`req.destroy()`).

## Точки входа

При запуске файла асинхронно исполняются следующие операции:
1.  **`initDb()`**: отправляет запросы в PostgreSQL для создания таблиц (`users`, `channels`, `subscriptions`, `moderators`, `bans`, `notifications`, `donations`, `favorites`, `builds`, `guides`, `guide_likes`, `stream_sessions`) и индексов, если они отсутствуют в базе.
2.  **`initRedis()`**: подключает клиенты `redis`, `pub` и `sub` к Redis-серверу. Клиент `sub` подписывается на Pub/Sub каналы `chat:*` и `presence:*` для ретрансляции событий через WebSocket.
3.  **Запуск HTTP-сервера**: вызывает `server.listen(PORT)`, открывая прием входящих TCP-соединений и WebSocket-запросов на указанном порту.
## Функции

| функция | что делает | к каким внешним сервисам, файлам или БД обращается |
|---|---|---|
| secret | Извлекает значение секрета из файла, переменной окружения или возвращает fallback | Файловая система (fs) |
| q | Выполняет SQL-запрос и возвращает массив всех найденных строк | БД PostgreSQL |
| one | Выполняет SQL-запрос и возвращает первую строку результата | БД PostgreSQL |
| run | Выполняет SQL-запрос без обработки возвращаемых строк | БД PostgreSQL |
| now | Возвращает текущую временную метку в миллисекундах | - |
| slugify | Преобразует строку в URL-безопасный слаг с транслитерацией кириллицы | - |
| token | Генерирует JWT-токен для авторизованного пользователя | - |
| verifyToken | Проверяет подлинность и расшифровывает JWT-токен | - |
| auth | Извлекает и проверяет токен авторизации из HTTP-заголовка Authorization | - |
| cookies | Парсит заголовки Cookie из HTTP-запроса в объект | - |
| json | Формирует и отправляет HTTP-ответ в формате JSON с заголовками безопасности | - |
| securityHeaders | Устанавливает базовые HTTP-заголовки безопасности в объекте ответа | - |
| allowedOrigin | Проверяет, входит ли источник запроса в список разрешенных | - |
| checkOrigin | Валидирует заголовок Origin входящего HTTP-запроса | - |
| requireCsrf | Проверяет соответствие CSRF-токена в Cookie и заголовке X-CSRF-Token для мутирующих запросов | - |
| rateLimit | Проверяет и фиксирует количество запросов для ограничения частоты вызовов | Redis |
| rawBody | Считывает тело HTTP-запроса в виде сырой строки с ограничением по объему | - |
| body | Считывает и разбирает тело HTTP-запроса из формата JSON | - |
| urls | Формирует структуру URL-адресов для медиапотоков (WHIP, WebRTC, HLS, RTMP) | - |
| hashStreamKey | Вычисляет хеш SHA-256 для ключа трансляции | - |
| safeChannel | Приводит объект канала к главному публичному формату | - |
| userById | Запрашивает профиль пользователя по его идентификатору | БД PostgreSQL |
| channelBySlug | Запрашивает данные канала и имя его владельца по слагу | БД PostgreSQL |
| isMod | Проверяет, назначен ли пользователь модератором канала | БД PostgreSQL |
| canModerate | Проверяет права пользователя на модерацию (владелец, администратор или модератор) | БД PostgreSQL |
| notify | Сохраняет новое системное уведомление для пользователя | БД PostgreSQL |
| initDb | Создает таблицы и индексы базы данных при отсутствии | БД PostgreSQL |
| mediamtxAuth | Проверяет ключ трансляции при аутентификации запросов от медиасервера MediaMTX | БД PostgreSQL |
| officialItems | Выделяет массив предметов из структуры ответа датафида Dota 2 | - |
| objectValues | Преобразует структуру объектов или массивов в плоский массив значений | - |
| normalizeItems | Фильтрует невалидные элементы, приводит ID к числовому типу и удаляет дубликаты предметов | - |
| mergeItems | Объединяет базовые данные предметов с информацией из словаря констант | - |
| fetchJsonSafe | Выполняет HTTP-запрос по указанному URL и возвращает JSON-ответ | Внешние HTTP-сервисы |
| fetchItemsList | Загружает списки предметов из внешних источников, объединяет и нормализует их | Внешние HTTP-сервисы (www.dota2.com, api.opendota.com, raw.githubusercontent.com) |
| getItemsList | Получает агрегированный список предметов Dota 2 с использованием кэша | Redis, внешние HTTP-сервисы |
| dotaProxy | Проксирует HTTP-запросы к данным о героях и предметах Dota 2 | Redis, внешние HTTP-сервисы (api.opendota.com) |
| getConstantsMap | Загружает словари констант с внешнего сервиса и сохраняет их в кэш | Redis, внешние HTTP-сервисы (api.opendota.com) |
| parseVdfTokens | Парсит строки текстового файла формата VDF в карту токенов локализации | - |
| buildAttribMap | Формирует карту атрибутов способностей и предметов из массива | - |
| fillPlaceholders | Заменяет шаблоны плейсхолдеров в тексте на значения из карты атрибутов | - |
| hasUnresolvedPlaceholder | Проверяет наличие нераскрытых плейсхолдеров в тексте | - |
| getOfficialRuMap | Загружает файл русской локализации VDF из репозитория и кэширует его | Redis, внешние HTTP-сервисы (raw.githubusercontent.com) |
| resolveRuText | Подбирает и подставляет русский перевод для способности или предмета | Redis, внешние HTTP-сервисы |
| fetchOfficialItem | Загружает данные предмета из официального датафида Valve | Внешние HTTP-сервисы (www.dota2.com) |
| getItemDetail | Возвращает детальные данные о предмете с локализованным описанием | Redis, внешние HTTP-сервисы |
| getHeroAbilities | Возвращает список способностей героя с локализованными описаниями | Redis, внешние HTTP-сервисы |
| getHeroItemPopularity | Возвращает статистику популярности предметов для героя с кэшированием | Redis, внешние HTTP-сервисы (api.opendota.com) |
| api | Главный обработчик и маршрутизатор всех REST API запросов | БД PostgreSQL, Redis, внешние HTTP-сервисы |
| viewersCount | Считает количество активных зрителей канала | Redis |
| initRedis | Устанавливает соединения с Redis и подписывается на каналы Pub/Sub | Redis |
| broadcast | Рассылает сообщение всем подключенным к каналу WebSocket-клиентам | - |
| chatHistory | Возвращает список последних сообщений чата из кэша | Redis |
| handleWsMessage | Обрабатывает входящие команды WebSocket (сообщения чата, модерация, баны) | Redis, БД PostgreSQL |
| serveStatic | Проверяет наличие и раздает статические файлы из файловой системы | Файловая система (fs) |
