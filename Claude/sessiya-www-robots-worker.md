# Сессия 25.09.2026: www, AI-краулеры, ошибки воркера

Всё ниже проверено на живом сайте, не по чужому отчёту.

## 1. www.dotamate.ru — поднят

Записи `www` в DNS не существовало вовсе (`getent hosts` пусто), поэтому «таймаут»
из внешнего аудита был не таймаутом, а отсутствием имени.

Сделано владельцем в панели: `CNAME www → dotamate.ru`, Proxied; Redirect Rule
`https://www.*` → `https://${1}`, 301, Preserve query string.

Проверка: `curl -sI https://www.dotamate.ru/heroes/` → `301`,
`location: https://dotamate.ru/heroes/`. Путь сохраняется.

## 2. sitemap.xml — проблемы не было

`HTTP/2 200`, `content-type: application/xml`, 79 КБ. Внешний аудит-нейросеть
упёрлась в управляемый robots.txt Cloudflare, где заблокированы AI-краулеры, и
приняла отказ за ошибку сервера. Урок на будущее: чужой отчёт о сайте проверяется
curl'ом, а не принимается на веру.

## 3. AI Crawl Control — разделены чтение и обучение

Было: Search = Allow, **Agent = «Block on pages with ads»**, Training = Disallow.
Поскольку на сайте есть реклама, Agent-краулеры (те, что читают страницу, когда
человек о чём-то спросил ассистента) блокировались почти везде.

Стало: Search = Allow, **Agent = Allow (do not block)**, Training = Disallow,
Bot Preference Sync включён (не трогали).

Живой robots.txt сразу после: 3259 → 2757 байт. Ушли ChatGPT-User, Claude-User,
MistralAI-User, Kimi-User, Google-NotebookLM, meta-externalfetcher. Остались
обучающие: ClaudeBot, GPTBot, Claude-Web, anthropic-ai, CCBot, Bytespider,
Google-Extended, MistralAI-Training, а также Baiduspider и PetalBot.
Сигнал `Content-Signal: search=yes,ai-train=no,use=reference` на месте, свой хвост
с `Disallow: /api/` и строкой Sitemap цел.

Где переключать: Security → Settings → фильтр «AI» → Configure AI bot policies.

## 4. Ошибки воркера: 291 исключение за сутки

**Что показали цифры** (Cloudflare GraphQL Analytics, окно 24 часа,
`workersInvocationsAdaptive`, фильтр по scriptName):

| status | запросов |
| --- | --- |
| success | 786 |
| **scriptThrewException** | **291** |
| clientDisconnected | 7 |

То есть каждый четвёртый вызов падал необработанным исключением, и посетитель
видел страницу ошибки Cloudflare вместо сайта.

### Настоящая причина: мёртвый cron-триггер, а не только OpenDota

В панели воркера (Settings → Trigger events → Cron triggers) был настроен
**cron-триггер «каждые 5 минут»**, добавленный когда-то напрямую в панели —
его не было ни в `wrangler.jsonc`, ни в истории `deploy/worker.js`. У самого
`worker.js` нет обработчика `scheduled`, только `fetch`. Каждое срабатывание
триггера падало с ошибкой «Handler does not export a scheduled() function».

Арифметика сходится почти без остатка: 24 часа ÷ 5 минут = **288 срабатываний**,
зафиксированных `scriptThrewException` было **291**. То есть подавляющее
большинство вчерашних ошибок — это не OpenDota и не посетители, а фоновый шум
без единого пострадавшего пользователя (cron ничего не отдаёт наружу).

`git log --all -p -- deploy/worker.js` и поиск по `AUDIT.md`/`CLAUDE.md` не нашли
ни одного упоминания намеренного `scheduled`-обработчика — триггер удалён как
чистый мусор: Settings → Trigger events → Cron triggers → корзина → Save.
Теперь «No cron triggers configured».

**Исходящие подзапросы за те же сутки** (до этой правки): `api.opendota.com` —
3 успешных против **59 с кодом 4xx**; `api.stratz.com` — 7 против **23 с 4xx**.
По Stratz это известное ограничение (токен работает не более чем с двух IP за
15 минут, из воркера — 403). Проверка live-состояния OpenDota в момент разбора:
все шесть публичных эндпоинтов отдавали **522 через ~20 секунд ожидания** (ответ
их же Cloudflare, origin не отвечал) — с двух независимых сетей. Позже, при
повторной проверке, OpenDota снова отвечала 200 за 0.69 с — то есть у них была
временная деградация, а не полная недоступность навсегда. Подробный разбор:
`claude/opendota-razbor.md`.

**Главный расход процессорного времени.** Русский словарь Valve
(`abilities_russian.txt`) весит **2 404 104 байта**. `getOfficialRuMap()` на каждом
вызове читал его из Cache API, делал `JSON.parse` и собирал `Map` на тысячи ключей,
а `getHeroAbilities` вызывал его **до шести раз на один запрос** — по разу на
способность. На бесплатном плане лимит 10 мс процессорного времени на вызов.

## Что исправлено в `deploy/worker.js` — два деплоя

**Первый деплой, версия `953e544b`** (откат на
`abf61412-31ba-4ede-876f-d9d0f7a594ce`):

1. `getOfficialRuMap()` держит готовую `Map` в изоляте и обновляет её раз в шесть
   часов — вместо повторного разбора 2.4 МБ по шесть раз на запрос.
2. Весь `export default fetch` обёрнут в `try/catch`: причина пишется через
   `console.error` (метод, URL, стек), а посетитель получает нормальный ответ —
   JSON `{"error":"internal_error"}` для `/api/dota/*` и текстовую страницу 500
   для остального, а не страницу ошибки Cloudflare.

**Второй деплой, версия `ac070790`** (откат на `953e544b`):

3. `fetchJson`: таймаут 5 секунд на попытку (`AbortSignal.timeout`) вместо
   неограниченного ожидания; одна повторная попытка вместо трёх для 429/5xx.
   При нынешних 20 секундах до 522 у OpenDota старый код держал вызов воркера
   до минуты — отсюда часть из 7 суточных `clientDisconnected`.
4. `cachedJson`: отрицательный кеш на 10 минут. Если апстрим только что упал,
   следующие холодные колоу не ждут заново те же 5 секунд, а сразу уходят к
   локальному снимку.
5. Таймауты добавлены на все четыре прямых `fetch` в файле: OpenDota/JSON-эндпоинты
   (через `fetchJson`, 5с), словарь Valve с GitHub (8с — файл тяжелее), Valve
   itemdata datafeed (5с), Stratz GraphQL (5с).

Оба раза ассеты не менялись («No updated asset files to upload») — тронут только
скрипт воркера. После второго деплоя проверены 11 адресов (главная, `/heroes/`,
`/guides/`, sitemap, четыре API-эндпоинта, редирект `/item/dagon_2/`, `/api/dota/hero/1/build`,
www) — все 200/301, ответы 0.38–0.71 с.

## 5. Включена Workers Observability

Панель: Observability → Enable, logs + invocation logs + persist. Бесплатный план —
200k событий в сутки. Чтобы следующий `wrangler deploy` не выключил её обратно,
блок добавлен и в `deploy/wrangler.jsonc`:

```jsonc
"observability": { "logs": { "enabled": true, "invocation_logs": true, "persist": true } }
```

Именно через эти логи и нашёлся мёртвый cron-триггер: фильтр `level:error` за
последний час показал 12 записей, и все двенадцать — с одинаковым сообщением
`*/5 * * * *` через равные 5-минутные интервалы, что сразу указало на
scheduled-триггер, а не на HTTP-трафик.

## Известный мёртвый код (не трогали — не входит в согласованный риск)

`/api/dota/hero/{id}/items` в воркере вызывает `api.opendota.com/.../itemPopularity`,
но во фронтенде на него никто не ссылается: покупки предметов берутся из
локального снимка `data/hero-items.json`. Эндпоинт живой, но бесполезный —
отдельная, более рискованная правка (менять роутинг), пока не делалась.

## Что проверить в следующий раз

- Через сутки открыть Observability, посмотреть `workersInvocationsAdaptive` —
  доля `scriptThrewException` должна упасть примерно до нуля теперь, когда
  cron-триггер удалён, а не просто снизиться.
- Отфильтровать `console.error` с текстом `worker unhandled` — если что-то
  продолжает падать, там будет точный стек.
- OpenDota может снова деградировать — таймаут и отрицательный кеш теперь не дают
  этому превращаться в ожидание до минуты и разрывы соединений у посетителей.
