# Карта статистики и потоков данных DotaMate

Аудит 09.10.2026 (только чтение). Сверено: код в `C:\Users\vsegd\Documents\DOTAMATE` и на сервере `~/dotamate-src`
(md5 совпадают у `tools/daily-update.js`, `build-stats.js`, `match-source.js`, `build-our-stats.js`,
`collect-steam-matches.js`, `sync-deploy.js`, `hero-stat-tiles.js`, `js/stats.js`, `deploy/api/index.php`);
данные — с сервера (`data/stats.json`, собран 2026-10-09T09:00:40Z, md5 совпадает с `~/www/dotamate.ru/data/stats.json`).

Обозначения: **[факт]** — подтверждено кодом/данными; **[предп.]** — вывод без прямой проверки; **[?]** — неизвестно.

---

## 1. Общая схема

```
Внешние источники                 Сборщики (cron на сервере)                  Хранилище (сервер, не в deploy)
Steam Web API ─────────────────── tools/collect-steam-matches.js  ─────────── data/steam-matches[-turbo]/ДАТА.jsonl.gz
OpenDota /publicMatches ───────── tools/collect-public-matches.js ─────────── data/public-matches[-top]/ДАТА.jsonl
Stratz GraphQL (match) ────────── tools/collect-meta-matches.js   ─────────── data/meta-matches/ДАТА.jsonl
Stratz heroStats ──────────────── fetch-hero-positions.js, tools/fetch-rank-positions.js, fetch-hero-builds.js
Реплеи Valve + OpenDota proMatches tools/replay/collect.js ───────────────────── ~/dotamate-collector/archive/
OpenDota proMatches ───────────── tools/pro/sync.js ──────────────────────────── ~/dotamate-data/pro/

         │  чтение базы — только через tools/match-source.js (steamStream/publicStream/metaMatches)
         ▼
Расчёт (tools/build-*.js, порядок — tools/daily-update.js)  →  data/*.json
         ▼
tools/sync-deploy.js → deploy/data/ → tools/deploy-hostiman.js → ~/www/dotamate.ru/data/*.json (статика)
         ▼
Потребители: js/*.js (fetch /data/*.json), генераторы страниц build-*.js (статический HTML),
deploy/api/index.php (/api/*, PHP), deploy/api/pro.php (/pro/)
```

Прод-backend — **PHP** (`deploy/api/index.php`, `pro.php`) на Hostiman + статические JSON. `server.js`
(Node, Postgres/Redis, стриминг), `deploy/worker.js` (Cloudflare), Docker/Caddy/MediaMTX — **в проде не работают**
[факт: на сервере нет процесса server.js; CLAUDE.md «Хостинг с 26.09.2026»]. Это наследие (см. §7).

## 2. Расписание (сервер, `~/dotamate-collector/crontab.txt`, время MSK)

| Когда | Что | Замок |
|---|---|---|
| каждые 10 мин (:02) | `collect-steam-matches.js --budget 48 --keep-days 30` | heavy.lock + `.lock` сборщика |
| каждые 10 мин (:06) | `tools/replay/collect.js --limit 5 --keep-days 7` (архив эфира) | heavy.lock |
| :23, :53 | `tools/pro/sync.js` (/pro/) | heavy.lock, пропуск во время daily |
| 04:17 и 10:17 | `tools/daily-update.js --auto` (весь пересчёт + выкладка данных) | `logs/daily.lock` |
| 06:47 | `collect-steam-matches.js --fill-ranks --days 3` | `.lock` сборщика (без heavy.lock) |
| 12:00 | `tg-post.js --send` (Telegram) | — |

`--auto`: если `logs/last-success.txt` = сегодня, запуск пропускается (`daily-update.js:186`) — при успешном
утреннем прогоне 10:17 ничего не делает, хотя комментарий о бюджете Stratz «10:17 — до 300» предполагает обратное.

## 3. Порядок ежедневного пересчёта (`tools/daily-update.js`)

1. OpenDota: свежая лента (base ≤ Властелин) → `public-matches`; срез top (Divine 5/Immortal) → `public-matches-top`.
2. Stratz: роли (`hero-positions.json`), роли по рангам (`rank-positions.json`), предметы билдов → `builds-stratz/`.
3. Stratz детали матчей (до 2000/300) → `meta-matches/`.
4. Из `meta-matches`: `hero-items.json`, `item-impact.json`, `item-counters.json`, `item-stats.json` (+ страницы предметов).
5. Steam: прокачка/таланты → `data/builds/<id>.json`.
6. Способности (по сроку).
7. **Матрицы Steam «все ранги»** → `our-meta.json`, `our-matrix.json` (сбой = стоп всего);
   калибровка → `draft-calibration.json` (сбой = стоп); турбо; META (`meta-escape.json`, `meta-match/`);
   срез top (OpenDota) → `our-*-top.json`, `draft-calibration-top.json`, `draft-archive-check.json`.
8. Только на сервере: `live-winprob.json`, `live-hero-avg.json` (архив эфира).
9. `build-hero-counters.js` → `hero-counters.json`.
10. `collect-steam-matches.js --fill-ranks --days 3`, затем **`build-stats.js --source steam` → `stats.json`,
    `hero-main-roles.json`, снимок `stats-history-steam/ДЕНЬ.json`**.
11. Если контрпики ок: страницы героев, гайды героев, внутриигровые гайды (`tools/build-ingame-guides.js --publish`, сбой = пропуск), статьи (`deploy/hero/`, `deploy/guide/`).
12. Проверка отпечатка кода (`code-fingerprint.js`) → `sync-deploy.js` → `deploy-hostiman.js`.

Сбои сборщиков (шаги 1–6) не останавливают выкладку: остаются вчерашние файлы. В журналах 05–09.10 каждый день:
«пропуски: сбор META, роли героев, роли по рангам, билды героев» (Stratz 429 / «не отвечает» /
`Cannot read properties of undefined (reading 'constants')`) [факт: `logs/daily-2026-10-0*.log`].

## 4. Показатели: что → где → как → откуда

Базовые фильтры Steam-ленты [факт, `collect-steam-matches.js` + `build-stats.js addRow`]: lobby 7 + mode 22,
длительность > 900 с, 10 игроков, нет leaver_status > 1, все герои известны `heroes.json`; дубликаты match_id
отсеиваются внутри дневного файла (`match-source.js steamStream`).

Состояние базы на 09.10 [факт]: 1 200 455 матчей, **с 02.10 15:19 по 09.10 08:20 UTC (≈7 дней, а не 30)**;
дни 02.10–03.10 неполные (33 и 28 МБ против ~230 МБ у остальных); сбор выборочный — бюджет 48 запросов/10 мин,
`jumps` 287, пропущено 3,9 млн seq (`_state.json`). Ранг известен у 20,9 % матчей.

| Показатель | Страница / блок | Формула | Источник → сборщик | Файл / API | Обновление | Ограничения |
|---|---|---|---|---|---|---|
| Матчей в базе, период, патч | /stats/ сводка | count матчей после фильтров; min/max start_time | Steam → collect-steam → build-stats | stats.json `base` | daily | период = то, что лежит в steam-matches (сейчас 7 дн.) |
| Победы Radiant | /stats/ сводка | radWins / total | Steam | `base.radiantWr` | daily | — |
| Распределение по рангам | /stats/ сводка | матчей с известным рангом по группам 1–7 | ранг из OpenDota по match_id (`--fill-ranks`) | `base.ranks` | daily | ранг у 20,9 %; группы 70–74 (Божество 1–4) отсутствуют |
| Винрейт героя | /stats/ тир-лист; паспорт героя; /me (сравнение) | w/n | Steam | `heroes[].wr` | daily | все ранги смешаны |
| «Надёжный» винрейт | /stats/ | нижняя граница Уилсона 95 % | Steam | `heroes[].lo` | daily | проверено пересчётом: 0 расхождений |
| Пикрейт | /stats/ | n/total (сумма по героям = 1000 %) | Steam | `heroes[].pr` | daily | при фильтре ранга показывается общий pr (см. п. С2) |
| Тир S–D | /stats/, паспорт героя | квинтили `lo` среди героев с n ≥ 1000 | Steam | `heroes[].tier` | daily | относительный, не абсолютный |
| Винрейт по рангу | /stats/ «По рангам», фильтр ранга; плитки героя | w/n в группе, n ≥ 300 | Steam + ранг OpenDota | `heroes[].rank[g]` | daily | группа 1: только 44 героя ≥ 300 → вкладка «копится» |
| Винрейт по длительности | /stats/ «Матчи», плитки героя, /guide/draft-fundamentals/ (25–35 против 45+, без <25) | w/n в корзинах <25/25–35/35–45/45+, n ≥ 300 | Steam | `heroes[].dur`, `durSwing` | daily | — |
| Гистограмма длительности | /stats/ «Матчи» | матчей по 5 мин | Steam | `base.duration` | daily | сумма = matches (проверено) |
| GPM/XPM героя | /stats/ (posSteam) | среднее за матч | Steam | `heroes[].gpm/xpm` | daily | — |
| Позиции 1/2/3/«4–5» | /stats/ «Позиции» | модель `position-model.json` (тест acc 79,5 %), ровно 3 кор + 2 саппорта в команде | Steam + `match-positions.js` | `posSteam` | daily | оценка, не данные Valve |
| Эталон «Разбора матча» (рейтинг) | /academy/match/ (`js/academy-analysis.js`) | `posSteam.pos[*].heroes`: n ≥ 30 (MIN_POS), GPM, XPM, K/D/A, урон, добивания, `m` — средняя длительность, мин (с 15.10.2026); приоритет над Stratz `positions`, т.к. размечен той же моделью, что и разбираемый матч | Steam + `match-positions.js` | `posSteam` | daily | оценка позиции, не данные Valve |
| Эталон «Разбора матча» (Turbo) | /academy/match/ для game_mode 23 | `posTurbo`: последние 7 дневных файлов `data/steam-matches-turbo`, те же поля; модель позиций обучена на рейтинговых — в Turbo её точность не измерялась; сбой → прошлый `posTurbo` | Steam турбо + `match-positions.js` | `posTurbo` | daily | срез Turbo, с рейтингом не смешивать |
| Позиции 1–5 (Stratz) | плитка «против других» на /hero/ (`hero-stat-tiles.js`); эталон «Разбора матча» /academy/match/ (`js/academy-analysis.js`: GPM, XPM, K/D/A, урон, добивания; `m` — средняя длительность, мин, для показателей «в минуту», с 15.10.2026) | среднее по позиции; n ≥ 30 | Stratz детали, текущий патч, ранги ≤ 65 | `positions` | daily (если Stratz жив) | другой срез, чем тир-лист |
| Роли героя (значки, «роль на ранге», фильтр позиции) | /stats/, сайт целиком (`hero-roles.js`) | доля позиции ≥ 10 %, сортировка по винрейту | Stratz heroStats по парам рангов | `heroes[].ro/rt`, `hero-main-roles.json`, `roles.fetchedAt` | daily, **фактически снимок 25.09** | Stratz падает ежедневно |
| Связки союзников | /stats/ «Связки», /guide/draft-fundamentals/ (`synergy`, топ-8) | d = w − σ(logit pA + logit pB); пары ≥ 300 | Steam: our-matrix.json (pairs.with) + винрейты stats | `synergy`, `antiSynergy` | daily | пересчёт e/d: 0 расхождений |
| Контрпики | /stats/, /hero/, гайды, /guide/counter-picks/, /guide/draft-fundamentals/ (`stats.counters`, топ-8), быстрая подготовка | log5: d = w − e; пары ≥ 300 | Steam: our-matrix (vs) + our-meta → build-hero-counters | `hero-counters.json`, `counters` | daily | зеркальных дублей в топ-40 нет (проверено) |
| Покупки предметов (доля, медиана 1-й покупки) | /stats/ «Предметы» | игроков с покупкой / игроков с покупками | Stratz детали, текущий патч | `items` | daily | ранги ≤ 65, ≈17 тыс. матчей |
| Исход линии | /stats/ «Линии», плитки героя | win/draw/loss по оценке Stratz, n ≥ 30 | Stratz | `lanes` | daily | ранги ≤ 65 |
| Динамика | /stats/ «Динамика» | разница wr первого и последнего снимка | снимки build-stats | `history` (до 60 дн.) | daily | сейчас 1 снимок; каждый снимок — окно всей базы, а не день |
| Срез Divine 5/Immortal | /stats/ тир-лист (селектор) | w/n, Уилсон, pr | OpenDota top → build-our-stats --tier top | `slices.top`; `our-meta-top.json` | daily | 255 662 матча, 29.09–09.10 |
| Срез «Про-матчи (архив эфира)» | /stats/ тир-лист (селектор) | w/n, Уилсон, средние K/D/A; уникальные match_id, герой раз на матч | реплеи архива эфира | `slices.pro` | daily (сервер) | v71: рейтинг от 10, 5–9 «мало данных»; локально (bbbe31c6): от 12 разных матчей с выбором героя, 5–11 «мало данных»; 1–4 скрыты |
| Pro pick / win / ban, «лучший pro winrate» | /stats/ вкладка «Про-сцена», главная («Избранные герои») | pro_win/pro_pick; порог 5 (таблица), 20 (сводка) | **живой OpenDota /heroStats** через `/api/dota/hero-stats` (кеш 24 ч) | API | 24 ч кеш | период и источник на странице не подписаны |
| Реальные покупки по фазам | карточка героя, быстрая подготовка, DraftMate | доля в фазе, порог по доле | Stratz | `hero-items.json` | daily | — |
| Статистика страниц предметов | /item/<key>/ | n, share, квартили времени, позиции, герои | Stratz | `item-stats.json` → build-item-pages.js | daily | — |
| Связь покупки предмета с победой (вариант Б; наблюдение, не причинный эффект) | DraftMate, главная | относит. эффект: (купил − не купил) − медиана героя | Stratz | `item-impact.json` | daily | наблюдение, не причинность (подписано в коде) |
| Прогноз драфта | DraftMate, /live, META, /guide/draft-fundamentals/ (точность и шанс фаворита из `draft-calibration.json`) | сумма парных отклонений → Platt (a), 70/15/15 | Steam all / OpenDota top | `our-matrix*.json`, `draft-calibration*.json` | daily | проверка на архиве эфира — `draft-archive-check.json` |
| Шанс победы по ходу игры | /live, итоги матча | логистическая регрессия, пишется только если лучше 50 % | архив эфира | `live-winprob.json` | daily (сервер) | — |
| Средние героя по минутам | /live карточки игроков | средние на отметках 5…60 мин, n ≥ 30 | архив эфира | `live-hero-avg.json` | daily (сервер) | — |
| Свои позиции 1–5 (не на сайте до ready) | — | линия по координатам 1:00–8:00 + добивания к 10:00; 5 — поддержка на лёгкой линии | архив реплеев эфира → tools/archive-positions.js; сверка — попутная, с уже собранными матчами Stratz (новых запросов нет) | data/archive-positions.json, кеш archive/positions-cache.json | daily (сервер), 240 с | ready: точность 4/5 ≥ 85 % на ≥ 200 командах эталона; на 09.10 эталон 3 матча |
| Прокачка/таланты | /hero/, карточка героя | поуровневый срез частот | Steam (+ Stratz предметы) | `data/builds/<id>.json`, `/api/dota/hero/<id>/build` | daily | — |
| Внутриигровые гайды | приложение DotaMate, `/data/ingame-guides/manifest.json` | KeyValues; pos=0 — все позиции | `hero-items.json` + `skill-chains.json` + `builds/` → `tools/build-ingame-guides.js --publish` | `data/ingame-guides/*.build` + `manifest.json` | daily после гайдов героев | проверка `--check`, ≥100 файлов и ≥120 героев; временная папка → rename с резервом `.old`; сбой сохраняет прежний результат |
| META «необычные сборки» | /meta/ | Σ −ln(p) leave-one-out | Steam (инвентарь) | `meta-escape.json`, `meta-match/` | daily | у Steam нет позиций |
| Личная статистика /me | /me/ | Уилсон, z-тест двух долей, оценка позиции (порт модели в PHP) | Steam API по запросу посетителя (бюджет 60 000/сут) | `/api/dota/player/*` | по запросу, кеш 1 ч | сравнение со stats.json `wr` |
| Про-матчи | /pro/ | без расчётов статистики | OpenDota | `~/dotamate-data/pro` → pro.php | 30 мин | пометка при данных старше 90 мин |

## 5. Где читается `data/stats.json`

- `js/stats.js` — /stats/ (все вкладки, кроме «Про-сцена»).
- `js/app.js` — вкладка «Про-сцена» /stats/ (`renderStats`, данные OpenDota, не stats.json).
- `tools/hero-stat-tiles.js` ← `build-hero-pages.js` — плитки и паспорт на /hero/<slug>/.
- `js/home-daily.js` — блоки главной; `js/me.js` — средний винрейт героя для /me.
- `js/my-heroes.js` — блок «Мои герои» на /heroes/: `heroes[].wr` и `history` (разница с самым ранним снимком не старше 7 дней).
- `tools/fetch-rank-positions.js`, `tools/valve-hero-stats.js`, `tools/build-item-stats.js` — упоминают/читают (служебно).

## 6. Найденные проблемы (подтверждённые)

Критичных (ломающих данные) не найдено. Пересчёт по серверным данным: сумма пикрейтов 999,9 %, сумма
матчей героев = 10 × матчей, общий винрейт 50,0 %, гистограмма = числу матчей, Уилсон и связки пересчитаны без расхождений.

**Высокие**
- В1. Неверное описание выборки: документы и подписи «30 дней / все рейтинговые матчи», фактически ≈7 дней (02.10–09.10)
  и выборочный сбор (48 запросов/10 мин, 287 прыжков курсора). Влияет на понимание пользователем.
- В2. Вкладка «Про-сцена» и «лучший pro winrate» — живые данные OpenDota `/heroStats` без указания источника,
  периода и выборки (`stats/index.html:72`, `js/app.js:342–380`); рядом в селекторе тир-листа — другой «про»-срез
  (131 матч архива). Две разные «про-статистики» на одной странице.
- В3. Роли героев (значки, «Роль на ранге», фильтр позиции в тир-листе) — снимок Stratz от 25.09 (`stats.json roles.fetchedAt`);
  обновление падает каждый день (журналы 05–09.10). Дата снимка на странице не показана.
- В4. Смешение срезов на /stats/ и /hero/: тир-лист — Steam все ранги, 7 дней; «Предметы», «Линии», Stratz-позиции и
  плитка «против других» — детальные матчи Stratz текущего патча, кандидаты из ленты OpenDota base (ранги ≤ 65),
  ≈17 тыс. матчей (`build-stats.js:192`, `collect-meta-matches.js:120`). В подписях ранг Stratz-выборки не указан.

**Средние**
- С1. «Место по винрейту» на /hero/ сортирует по сырому `wr` (`tools/hero-stat-tiles.js:24`), /stats/ — по Уилсону `lo`:
  место героя расходится между страницами.
- С2. Фильтр ранга в тир-листе показывает пикрейт по всем рангам (`js/stats.js:93`, `pr: h.pr`).
- С3. Срез «Про-сцена» (архив) выводит героев с 1 матчем (винрейт 0/100 %) — нет `MIN` (`build-stats.js:316`).
- С4. `data/stats-history-steam/` публикуется на сайт: нет в `SKIP_DIRS` (`tools/sync-deploy.js:24`), подтверждено на
  `~/www/dotamate.ru/data/`. Комментарий в build-stats говорит обратное. Не секрет, но лишние файлы.
- С5. «Динамика»: каждый снимок — винрейт по всему окну базы (скользящее окно), подпись «по дням» вводит в заблуждение;
  ряд Steam сейчас 1 снимок.
- С6. `--auto` второго прогона 10:17 пропускается после успешного 04:17 (`daily-update.js:186`) — расписание Stratz
  «2000 утром + 300 днём» на деле не работает.
- С7. Ошибки API отдают `$e->getMessage()` клиенту (`deploy/api/index.php:1810` и соседние) — может раскрыть внутренние
  URL. Ключей в URL OpenDota нет [предп.: не проверял все места].

**Низкие**
- Н1. Группа ранга 7 = 75–85; ранги 70–74 из ленты не приходят — на странице не пояснено.
- Н2. Устаревшие комментарии: `fetch-hero-positions.js` (Worker), `build-meta.js` (0–4500 MMR), `build-stats.js`
  заголовок (источник public-matches), CLAUDE.md «Стек/Структура» (server.js как backend, wrangler).
- Н3. Дублирование формул: Уилсон — `build-stats.js`, `js/app.js wrScore`, `index.php wilson`; модель позиций —
  `match-positions.js` и порт в `index.php`. Изменение одной копии не меняет другие.

**Риски [предп., не подтверждено]**
- Р1. `build-stats`/`build-our-stats` читают дневной файл, в который сборщик каждые 10 мин дописывает gzip-член, не под
  heavy.lock: чтение недописанного члена может уронить расчёт. На 09.10 счётчики our-meta и stats совпали (1 200 455).
- Р2. При долгом сбое Stratz `meta-matches` пустеют после смены патча (`m.t < patchTs`) — вкладки «Предметы/Линии»
  станут пустыми; пустого состояния у этих вкладок нет (`js/stats.js items()/lanes()`).

## 6а. Статус исправлений (выложено v71, 09.10.2026; порог 12 — только локально, коммит bbbe31c6)

Исправлено: В1 (подпись «выборка», `base.sampled/days`), В3 (дата снимка ролей), В4 (подписи среза Stratz, `base.stratz`),
С1 (место по `lo`), С2 (пикрейт по рангу), С3 (про-срез в v71: 1–4 не показываются, 5–9 «мало данных», 10+ в рейтинге),
С4 (`stats-history-steam` и `.tmp` не выкладываются), С5 (подпись «Динамики»), С6 (комментарий: 10:17 — страховка),
С7 (5 ответов API без текста исключения), Р2 (пустые состояния «Предметы/Линии»), атомарная запись и проверка JSON перед
выкладкой, ошибка `reading 'constants'` (`fetch-hero-builds.js`). В2: период OpenDota не подписывается (решение владельца),
срез архива переименован в «Про-матчи (архив эфира)». Р1 — не подтверждён, не менялся. Удалено наследие (§7).
План и проверки — `docs/architecture/statistics-remediation-plan.md`.

## 6б. Выложено 10.10.2026 (v72, v73)

Про-тир-лист — порог 12 разных матчей (v72). Сборщик реплеев (`tools/replay/collect.js`) — новый разборщик на Clarity 5.0.1 (раньше ~10 % матчей падали «parser exit 1»), сбойные матчи не повторяются, salt частями по 5, crontab `--limit 6` (v73). Подробно, с проверками — `data-independence.md` §8–§9.

## 7. Наследие и исключения

**09.10.2026 удалены** (коммит до удаления — `6c348012`): `server.js`, `deploy/worker.js`, `deploy/wrangler.jsonc`,
`deploy/.wrangler/`, `tools/update-site.js`, `tools/publish-meta.js`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`,
`mediamtx.yml`, `setup-secrets.sh`, `STREAMING_SETUP.md`, `README-v43-PLATFORM.md`, `docs/server-js-map.md`, `db/`,
`.netlify/`, `netlify-site/`; из `package.json` — скрипт `start` и зависимости pg, redis, ws, jsonwebtoken, bcryptjs.
Ниже — состояние до удаления (для истории).


- `server.js`, `preview-server.js`, `deploy/worker.js`, `docker-compose.yml`, `Caddyfile`, `mediamtx.yml`, `js/v43-*.js`,
  `.d2h-data-cache-v43/` — не прод. `preview-server.js` — только локальное превью.
- `/api/dota/hero-stats`, `/api/dota/hero/<id>/items` — живой прокси OpenDota (единственные живые внешние статистики в /api).
- Лента OpenDota base (`public-matches`) больше не источник цифр /stats/, нужна для ранга Steam-матчей и кандидатов Stratz.
- Параллельный расчёт «,1» (`data-steam/`, `~/dotamate-steam/`) — не трогать (claude/start-novogo-chata.md).
- Локальная `deploy/` и `data/` на компьютере устарели (stats.json от 25.09, в `deploy/js` нет 8 файлов из `js/`);
  источник правды — сервер.

## 8. Не проверено

- Визуально на мобильных: только CSS (`css/stats.css` — `overflow-x:auto`, сетки 1 колонка ≤ 900 px); скриншотов не делал.
- Живой ответ `/api/dota/hero-stats` и период OpenDota pro-статистики.
- Дубликаты match_id между дневными файлами Steam (`--stats` читает всю базу — тяжело для лимитов хостинга, не запускал).
- Корректность модели позиций и калибровки сверх метрик в файлах; `tools/replay/*`, `tools/pro/sync.js` — по заголовкам.
- Тестов (unit) в проекте нет; есть проверочные скрипты `tools/check-*.js` — не запускались.

## 9. Правило сопровождения

Меняешь сборщик, формат `data/*.json`, порог, источник или порядок в `daily-update.js` — обнови этот файл
(таблица §4, расписание §2, проблемы §6) в том же изменении.

## 6в. Аудит фронтенда статистики 10.10.2026 — исправлено в коде, не выложено

Отчёт: проект claude.ai, `claude/audit-frontend-statistiki-2026-10-10.md`.

- «Герой дня» строит адрес через `slugForHero` (`js/home-daily.js`): `/hero/vengefulspirit/` давал 404.
- Вёрстка:
  - `/stats/`: таблицы в двух колонках прокручиваются внутри своей обёртки; широкие таблицы до 1279px — тоже;
  - страница героя: `.hx-row` с `flex-wrap` растягивала плитки по ширине таблицы;
  - шапка на 761–1023px ужата: на 768px страница была 982px.
- Вкладка «Про-сцена»:
  - винрейт показывается только при 5+ пиках, иначе «мало данных»;
  - проценты через запятую;
  - блок «Item Analytics» убран: снимок OpenDota itemPopularity без даты, подпись «Выборка: 12» означала первые 12 строк;
  - «Сравнить» — форма вместо `prompt()`;
  - имя героя в строке — ссылка.
- Подписи источников:
  - доля роли в шапке /hero/ — Stratz, все ранги;
  - «Что покупают» — матчи Stratz;
  - «Таланты по ролям»;
  - гайд «Контрпики» без зашитого «340 тысяч».
- Доступность: вкладки `tablist/tab/tabpanel` и стрелки; `<h1>` на /stats/, /heroes/, /items/, /game/; пустое состояние поиска; `favicon.ico` (в `sync-deploy.js`).
- Не сделано: английские названия талантов (данные `data/builds`), подсветка «выше винрейт» у талантов 20/25 (методический вопрос).

## 6г. 11.10.2026 — повторы и битые строки детальных матчей Stratz (локально, не выложено)

- `build-stats.js`, `build-hero-items.js`, `build-item-counters.js`, `build-item-impact.js`, `build-item-stats.js` читают
  `data/meta-matches` через `match-source.js metaMatches()`: повтор id отсеивается, битая строка пропускается
  (раньше `JSON.parse` без try ронял три сборщика навсегда). На локальной базе 23–26.09: 2023 строки → 1999 матчей (24 повтора).
- `collect-meta-matches.js`: `_tried.json` пишется через `.tmp` + rename и сохраняется по SIGTERM/SIGINT (таймаут шага в
  daily-update) — источник повторов закрыт.
- 1.3 (11.10.2026): /stats/ — при `builtAt` старше 36 ч над сводкой плашка «Данные от …, ежедневное обновление задерживается» (`js/stats.js`, `.st-stale` в `css/stats.css`).
  `daily-update.js` при блокировке выкладки (код 2) и фатальной ошибке шлёт сообщение в личный Telegram владельца
  (`~/dotamate-data/telegram.env`: TG_TOKEN + TG_ALERT_CHAT; без TG_ALERT_CHAT — ничего не делает; публичный канал TG_CHAT не используется).
- 1.4 (11.10.2026): `tools/check-reference-data.js` — шаг daily-update перед матрицами: версия `data/patch-notes.json` против
  списка патчей Valve и hero_id последнего закрытого дня Steam (50 тыс. строк) против `data/heroes.json`. Ничего не обновляет;
  расхождение → «пропуск: справочники», текст в `logs/reference-check.txt` и сообщение владельцу в Telegram. Не стоп.
- 2.1 (11.10.2026, решение владельца — «только текущий патч»): `tools/match-source.js` отсекает матчи Steam (и строки
  OpenDota в `publicRows`) раньше `data/patch-notes.json timestamp` — во всех сборщиках сразу: /stats/, контрпики, связки,
  DraftMate (матрица и калибровка), META, прокачка, модель позиций. `stats.json base.patchFrom`, подпись на /stats/
  «только патч X (вышел …)». `MATCH_ALL_PATCHES=1` — без отсечки. Отсечка сдвигается только после
  `node tools/fetch-patch-notes.js` (сигнал — `check-reference-data.js`); в первые сутки нового патча выборка мала.
- 2.2 (11.10.2026): связки на /stats/ — ожидаемая доля по винрейтам `our-meta.json` (та же выборка и момент, что матрица пар;
  на сервере: 38 из 40 пар топа те же, |Δd| ≤ 0,2 п.п.); `stats.json countersAt` — дата `hero-counters.json`; если контрпики
  старше сводки на 20+ ч (их пересчёт упал), над таблицей «Контрпики — расчёт от …».
- 2.3 и 2.5 не делались: решения владельца 09.10 — второй запуск 10:17 остаётся страховкой только после фатального сбоя (В2,
  исправлен комментарий в daily-update.js), период данных OpenDota на «Про-сцене» не подписывается.
- 2.4: CLAUDE.md — расписание 04:17 и 10:17 МСК (сервер в МСК), выкладка только на сервере по команде владельца.
- 3.1 (11.10.2026, решение владельца — «подключить к DraftMate»): срез «Турбо» в DraftMate вместо среза Stratz —
  `our-matrix-turbo.json`, `our-meta-turbo.json`, своя калибровка `draft-calibration-turbo.json`
  (`build-draft-calibration.js --source steam --tier turbo`, шаг daily после матрицы турбо; на сервере 11.10: 837 854 матча,
  проверка 136 195, угадано 58,2 %, log loss 0,672 против 0,693). `data/draft-matrix.json` (снимок Stratz 23.09) сайтом больше
  не читается: DraftMate — без него, счётчик пар на главной — из `our-matrix.json`.
- 3.2 (11.10.2026, решение владельца — «заменить своим расчётом»): `lane-matrix.json` — `tools/build-lane-matrix.js`;
  `skill-chains.json` — `fetch-hero-builds.js --source steam --site`; `home-meta.json` — `tools/build-home-meta.js` из
  `stats.json` (+ `bn` — баны героя в `stats.json heroes`; колонка «Банят чаще всего»), главная пересобирается в daily
  (`build-pages.js`); `item-heroes.json` — `tools/build-hero-items.js`. `draft-matrix.json` не читается (п. 3.1).
  `fetch-patch-notes.js` берёт версию сначала из списка Valve (home-meta теперь повторяет версию из patch-notes).
  Подробно — `data-independence.md`.
- 1.2 (11.10.2026): `match-source.js` распаковывает gzip с `Z_SYNC_FLUSH` — недописанный член файла текущего дня читается
  до места обрыва без ошибки (проверено на склейке из полного и обрезанного члена: 4 строки, без исключения). Замок
  `heavy.lock` daily не берёт: шаги идут часами, сборщик Steam стоял бы всё это время.
- Этап 4 (11.10.2026): `sync-deploy.js` убирает из `deploy/data` верхнеуровневые *.json, которых нет в `data/`;
  `checkDataJson` проверяет и `data/builds/*.json`, `data/meta-match/*.json`; `daily.lock` снимается, если его процесс
  не жив (или старше 12 ч); комментарии `collect-steam-matches.js` о `pendingTo` приведены к коду.
  Старая копия проекта `Desktop\Dotamate` (26.09) — переименовать или удалить владельцу: в ней `deploy-hostiman.js` без защиты.
- v90 → v91: `sync-deploy.js` в v90 убрал `deploy/data/abilities.json` и `hero_abilities.json` — запасные справочники
  PHP-API (`constantsMap`), у которых нет пары в `data/`. Возвращены, в `sync-deploy.js` — список `DEPLOY_ONLY`.
- v92 (11.10.2026): DraftMate не прыгает — (1) строка-пояснение среза в шапке больше не показывается (при «Турбо» она
  сдвигала инструмент), пояснение — в подсказке кнопки; (2) полоса драфта на главной (`js/home-draft.js`) растёт при пиках в
  полном инструменте — `ResizeObserver` возвращает `#draftTool` на прежнее место экрана. Стенд: 1440/768/390 — поле поиска
  после 5 пиков на том же месте (было: уезжало на 80–250 px). v91 вернул «Stratz» на главную: push-server перезаписал
  сгенерированные страницы deploy/ локальными копиями без пересборки — при ручной выкладке пересобирать все страницы.


## Замечание 17.10.2026: аномалии в связках и коротких матчах

В `stats.json` (Steam, все ранги) встречаются экстремальные значения: `antiSynergy` Enchantress + Shadow Demon — 14% побед в 1 498 матчах вместе, `durSwing` Shadow Demon — 16,5% в матчах до 25 минут. Причина не выяснена (гипотезы: «руинерские» связки, боты, ошибка разбора). До проверки статьи не используют `antiSynergy` и корзину `lt25`; /guide/draft-fundamentals/ сравнивает 25–35 и 45+ мин.
