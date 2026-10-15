# План доработок: Эфир, главная, статистика (02.10.2026)

## ЖДЁТ ВЫКЛАДКИ
- **/live, чат 2 (09.10.2026): шанс победы по ходу игры (log loss 0,5905 против 0,6931 на 97 отложенных матчах, точность 66,4 %) + страница итогов /live/match/?id= (noindex, не в sitemap)** — claude/plan-efir-10-zadach.md (раздел «Чат 2», там список файлов и md5). data/live-winprob.json отправить на сервер отдельно (push-server data/ не переносит). Выкладывать вместе с чатом 1 (общие live.js/live.css).
- **/live, чат 1 (09.10.2026): покупки в ленте событий, CLS телефона 0,094→0,001 на стенде, плашка «Связь потеряна» с автопереподключением, цели Метрики live_view/live_switch** — claude/plan-efir-10-zadach.md (раздел «Чат 1»). Файлы: js/live.js, css/live.css, page-sections.html, build-pages.js, tools/build-live-items.js (новый, пишет data/live-items.json при build-pages). Шаблон выкладки s119. (По истории версий v57 — чат 1 уже выложен; сверить md5 live.js на сервере перед выкладкой.)
- **Раздел /pro/ — результаты про-матчей, драфты, ключевые моменты, страницы турниров (09.10.2026)** — claude/pro-matchi.md (порядок выкладки и строка crontab там). Календарь отложен: нет надёжного источника без заявки на Liquipedia LPDB.
- 50 новых гайдов по предметам — claude/gaidy-50-oktyabr.md; выкладывает другой чат.
- Ещё 100 гайдов (guide-content.js, теперь 221 статья) — claude/gaidy-100-oktyabr.md. Для сборки каталога в build-pages.js добавлены тег КИБЕРСПОРТ (группа rank) и 37 slug в GUIDE_ITEM_SUBS. Перед выкладкой на сервере запустить build-guide-pages.js, build-pages.js, build-sitemap.js (746 адресов), затем indexnow.js. Без git commit.

## Выложено в версии 34 (03.10.2026 16:14 МСК) — «Герой дня» + «Вопрос дня» на главной
- Задача 3 из claude/plan-rost-trafika-oktyabr.md (подробности и числа проверок там). Вариант A, две карточки равной высоты между DraftMate и «Что есть на сайте».
- Файлы: js/home-daily.js (новый), page-sections.html (секция homeDaily в конце файла; порядок задаёт build-pages.js), build-pages.js (homeDaily между draftTool и home-cards + /js/home-daily.js defer), css/home-hero.css (стили .hd-*/.hq-* в конце).
- Цели Метрики создать владельцу: home_daily_click, home_daily_answer (JavaScript-событие).
- v33 — пустая выкладка (push упал по таймауту SSH, сборка прошла на старом коде). Шаблон s152.sh; push и sshr в задании связывать через &&.

## Выложено в версии 32 (03.10.2026 15:08 МСК) — скорость на телефоне
- Задача 2 из claude/plan-rost-trafika-oktyabr.md, замеры — claude/zamer-skorosti.md. Lighthouse: / 80→83, /hero/axe/ 81→87, гайд 79→90, /live 74→92, /items 76→85.
- Маленькие иконки сайта (favicon-32/icon-192/apple-touch-icon), портреты героев webp (png оставлены), defer у 7 общих скриптов (page-shell.html, tools/hero-card.js), CSS Google Fonts через media="print" onload.
- Шаблон выкладки со всеми сборщиками страниц: s147.cmd + s147.sh (push → hero-pages → hero-guides → item-stats → item-pages → guide-pages → role-guides → glossary → privacy → sitemap → build-pages → sync → deploy → проверка иконки/webp/defer), ~3 мин.
- Стенд без записи в проект: копия проекта в $HOME/stand (device_bash, без secrets/.env/*.txt с ключами), сборщики там, архив deploy → облако, свой node-сервер с /api/live/* + Playwright.

## Выложено в версии 31 (03.10.2026 14:35 МСК) — перелинковка статей о предметах
- Задача 1 из claude/plan-rost-trafika-oktyabr.md. tools/guide-items.js (новый, общая связь статья↔предмет), build-guide-pages.js (блок «Предмет в цифрах»: /item/ + до 6 героев из data/item-heroes.json), build-item-pages.js (раздел «Гайд по предмету»).
- Сервер: 77 статей со ссылкой на /item/, 98 страниц /item/ со ссылкой на гайд. IndexNow: 175 адресов, HTTP 200. Шаблон выкладки — s141.sh/s142.sh.

## План возвращаемости (решение владельца 02.10.2026)
1. ✅ Перелинковка — выложено в v17 (подробности ниже) и v31 (статьи о предметах).
2. ✅ Замер скорости на телефоне и правки по замеру — v32.
3. Личный кабинет /me по Steam ID: OpenDota через свой сервер с кешем на сутки, Steam ID хранится только в браузере, без входа; подсказка, если статистика матчей в профиле закрыта.
4. Web Push о патчах/гайдах по выбранным героям на своём сервере (email не делаем; Telegram-канал уже готов и настроен).
5. ✅ «Герой дня» на главной + квиз по предметам из items-ru.json; серия дней в localStorage — v34.

## Выложено в версии 17 (02.10.2026 17:31 МСК) — этап 1, перелинковка
- build-hero-guides.js: в конце 127 гайдов по героям раздел `#dalshe` «Что дальше» (+ пункт в оглавлении): до 3 гайдов героев, которые контрят (hc.against), до 3 — кого он обыгрывает (hc.good), до 3 «похожие роли» (тот же основной атрибут + больше всего общих ролей Valve, при равенстве меньший id), «Собрать драфт с X в DraftMate» (`/#draft=<id>----_----_`), «Как работают контрпики». Ссылки только на героев, у которых есть гайд. Стили — существующий `.article-main .linked-list`.
- build-guide-pages.js: «Другие гайды» — до 2 гайдов с тем же tag, затем следующие по списку, всего 4 (было 3 соседних).
- Проверено: в блоке 5–11 ссылок (меньше всех — chen, 5), битых ссылок на героев 0; на сервере блок есть в 127 из 127 гайдов.
- Эффект сверить по Метрике (глубина просмотра, повторные визиты) через 1–2 недели.

## Выложено в версии 7 (02.10.2026 13:42 МСК)
- Главная, блок DraftMate (#homeDraft): вместо «Перевес драфта −104,4 пп» — «Шанс победы по драфту» в % (Мы · Они, полоса), той же калибровкой, что в самом инструменте: D2HDraft.summary() отдаёт prob (null у среза без калибровки — тогда по-старому перевес п.п.). Огромная золотая кнопка заменена на компактную «Открыть DraftMate →» под слотами. Предметы: колонки «Мы»/«Они», легенда «обычно покупают · в рамке — нажмите, чтобы учесть сборку», убраны «нет данных» и шапки «Обычно / Сборка»; кликабельные предметы в пунктирной рамке за разделителем; на ≤560 px — второй строкой. Файлы: page-sections.html, js/draft-tool.js (summary.prob), js/home-draft.js, css/home-hero.css.

## Выложено в версии 6 (02.10.2026 ~13:30 МСК)
- /live: «табло» (.lv-board/.lv-bteam), шанс по драфту у каждой команды, полоса по низу табло, свёрнутое «Как считается…», кнопка «Открыть в DraftMate →» справа.
- Ranked All Pick (инструмент) → DraftMate везде; «Ranked All Pick» как режим игры оставлен.
- IndexNow: tools/indexnow.js, ключ 2c8e579f28eebdb6c463d02d501e3ed2.txt.
- Убраны все технические надписи-eyebrow; отступ от шапки до заголовка 30 px (≤560 px — 20 px).
- Крипы раз в 1 с (CREEP_STEP = 1) для новых матчей — проверить размер файла на первом таком матче.
- Плашка победы в паузе между матчами (lastItem в live.js, prev в /api/live/now).
- Мусор: в корне проекта пустые папки «Claude» и «outputs» — владелец может удалить.

## ВАЖНО: кеш браузеров и выкладка
- См. claude/versiya-sayta.md.
- tools/sync-deploy.js не выкладывает data/public-matches-top (сырые матчи).

## Локальный стенд для проверки
- /live и /live/match (09.10, чат 2): на ПК (device_bash) копия исходников в ~/w без больших data → node build-pages.js там → tar deploy/live + css js security.js data/live-*.json + assets (live, roles, items, heroes webp) ~4,5 МБ → stage; с сервера tar our-matrix-top, draft-calibration-top и 3 файла матчей base64 через sshr; облако — свой node-сервер (/api/live/now с текущим матчем у конца, /api/live/match/<id>) + Playwright. Для fullPage-скриншотов снимать loading=lazy у картинок.
- /live (09.10, быстрее всего): на ПК tar deploy/live + css js security.js assets/{live,roles,items,heroes без png} + data (heroes, draft-calibration-top, our-matrix-top — с сервера) ~4,5 МБ → stage; файл матча с сервера gzip|base64 через sshr; облако — свой node-сервер (задержка 400 мс на /api и /data, файл /tmp/down = обрыв /api) + Playwright/Lighthouse 12.8.2 (CHROME_PATH=/opt/pw-browsers/chromium). Правки — одним python-скриптом на стенд и на ПК, сверка md5.
- /live (старый способ): «Claude outputs/stand» → tar → облако, node-сервер со своими /api/live/now|match|heat + Playwright.
- Главная: deploy/index.html + css + js + assets/heroes|items|roles → tar; data/ с сервера (14 файлов DraftMate: heroes, draft-matrix, hero-main-roles, hero-positions, our-matrix(-top), our-meta(-top), draft-calibration(-top), draft-archive-check, hero-items, items-ru, item-impact) архивом tar.gz → base64 через sshr.
- Проще (03.10): весь ~/dotamate-src/deploy с сервера одним архивом: sshr - "cd ~/dotamate-src && tar czf - deploy | base64 -w0" > out\sNN.b64 (~52 МБ, ~1 мин), декодировать на ПК, stage в облако.
- Гайды: deploy/guide/<slug> + deploy/css → tar → облако, python http.server + Playwright (executablePath /opt/pw-browsers/chromium).
- Сборщики без записи в deploy/ проекта: скопировать *.js, tools, js, data, css в ~/w/r (device_bash) и собирать там. Для /item/ брать css/ проекта (deploy/css отстаёт от v30).
- /pro/ (09.10): облако — php -S с router.php, webroot www/dotamate.ru, данные ../../dotamate-data/pro от tools/pro/sync.js (PRO_DIR), Playwright с блокировкой внешних запросов.

## Дальше по плану
- Задача 4 из claude/plan-rost-trafika-oktyabr.md: личный кабинет /me по Steam ID.
- ✅ /live: CLS на телефоне — сделано 09.10 (чат 1). После выкладки сверить по Метрике/Cloudflare.
- Эфир — остальные пункты: claude/plan-efir-10-zadach.md (чаты 3–5; чат 2 сделан, ждёт выкладки).
- Шанс по ходу игры: переобучать tools/build-live-winprob.js по мере роста архива (сейчас 647 матчей); решить, включать ли в daily-update.
- Средние значения по героям из архива в статистику — когда в архиве будет около 500 матчей (на 09.10 в архиве 648).
- data/heroes.json (OpenDota) отстаёт от данных Valve — подумать о переходе на dota2.com/datafeed/herodata (см. claude/gaidy-100-oktyabr.md).
- Опционально: пост «Герой дня» в Telegram — только по отдельной команде владельца.
- /pro/: пункт «Про-матчи» в меню (нужны все сборщики страниц); календарь — после заявки на Liquipedia LPDB.

## DraftMate — модель
- js/draft-model.js — единая формула (draft-tool.js, live.js, live-match.js, tools/check-draft-archive.js).
- Срезы: «Divine 5 и Immortal» (top, по умолчанию), «До 4500 MMR» (our), «Stratz» (без вероятности).
- build-draft-calibration.js --tier top: 37 651 матч, a = 0,00562, 56,26% на 5 649 отложенных, log loss 0,68165 против 0,69315.

## Этап 4: предметы в драфте
- Вариант Б: tools/build-item-impact.js → data/item-impact.json; ≥100 матчей в группе, T ≤ 20 мин; 93 пары у 24 героев; в вероятность не входит.
