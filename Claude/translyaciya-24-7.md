# Трансляция 24/7 из разобранных реплеев

Круглосуточный эфир визуализации (миникарта canvas + события), без видео/GPU. Слой данных = архив разобранных матчей; эфир = расписание поверх архива.

## ПРАВИЛО ВЛАДЕЛЬЦА (02.10.2026)
- **Ничего не выкладывать на сайт и на сервер, пока владелец не скажет.** Все изменения копятся локально, потом выкладываются одним разом.

## Ждёт выкладки (локально готово, 02.10.2026)
- tools/replay/normalize.js — `creepFrames()` (все крипы раз в 2 с из вывода MapProbe), экспорт { normalize, creepFrames }.
- tools/replay/collect.js — второй проход MapProbe по .dem (`PROBE_FLAGS`, cp = jar + tools/replay-parser), поле `creeps` в файле матча; при ошибке матч сохраняется без creeps, причина в журнале. Временный файл work/<id>.probe.jsonl удаляется в cleanup.
- tools/replay-parser/MapProbe.class (javac 21, -proc:none) — нужен на сервере в ~/dotamate-src/tools/replay-parser (push-server исключает только jar).
- js/live.js — значки строений из файлов игры (assets/live/bld-*.png), разрушенные исчезают; все крипы точками, плавно.
- page-sections.html + css/live.css — раскладка /live: «События» в правой колонке под командами, низ событий = низ карты (лента absolute, мин. 130 px; совпадение проверено на 1440/1536/1920, на 1280–1366 события ниже карты на 60–90 px — колонке команд не хватает высоты); колонка команд 470–560 px, карта — остальное; легенда под картой вне высоты ряда; «Преимущество» на всю ширину; ≤1100 px — одна колонка. Исправлена горизонтальная прокрутка на 390 px (шапка блока «Преимущество» переносится).
- Этап 3, статистика: tools/build-stats.js раздел 5 → stats.json `slices.top` (из our-meta-top.json) и `slices.pro` (архив эфира, только про-матчи: n, винрейт, Уилсон, пикрейт, средние У/С/П, лиги); без архива берётся прошлый slices.pro. js/stats.js — в тир-листе селектор среза «До 4500 MMR / Divine 5 и Immortal / Про-сцена» с честными подписями (нет «7000+»). tools/build-our-stats.js — исправлена подпись среза top (было «0-4500 MMR»). Текст шапки /stats/ дополнен.
- Проверено в облаке: /live и /stats без ошибок JS, нет горизонтальной прокрутки на 390 px; срезы: top 37 651 матч / 127 героев, pro 20 матчей BLAST SLAM VIII / 64 героя (данные сервера на 02.10 ~08:40).
- Вкладка «Герои» на графике преимущества (линия капитала каждого героя) уже выложена 02.10 и остаётся.
- Порядок выкладки: build-pages.js → sync-deploy.js → push-server.js → deploy-hostiman.js. Срезы на /stats/ появятся после ближайшего daily-update на сервере (04:17/10:17) — либо запустить build-stats.js на сервере и выложить. После — проверить первый матч с полем creeps в журнале сборщика.

## Страница /live/
- Файлы: js/live.js, css/live.css, assets/live/minimap.jpg, assets/live/bld-*.png, секция `live` в page-sections.html, PAGES в build-pages.js, deploy/api/index.php (handleLive), deploy/.htaccess.
- API: `/api/live/now` → {serverTime, current{matchId,start(ms),len,t0}, next}; `/api/live/match/<id>`; `/api/live/heat`.
- Расписание: ~/dotamate-data/live-schedule.json под flock; сначала непоказанные про-матчи.
- Выкладка на сайт: build-pages.js → tools/sync-deploy.js → tools/push-server.js → **tools/deploy-hostiman.js** (без последнего сайт не обновляется). daily-update на сервере сам выкладывает сайт из ~/dotamate-src.

## Про-матчи — работает на сервере
- collect.js: 1 запрос к OpenDota /proMatches за запуск; про-матчи первыми. Поле `pro` в файле матча и index.json.

## Миникарта
- Официальная миникарта из pak01 → assets/live/minimap.jpg. u = (cell − 54)/148, v = (202 − cell)/148.
- Извлечение из VPK: `Claude outputs/shell/vpkls.js <pak01_dir.vpk> <regex> [outdir]` (через мост на Windows), конвертация vtex_c → PNG — Source2Viewer-CLI (скачивается в облаке с GitHub ValveResourceFormat).
- В pak01 есть также panorama/images/minimap/dotamap_{radiant,dire}_buildings_psd (320×320, все строения стороны).

## Сборщик реплеев
- cron `41 * * * *` → tools/replay/collect.js --limit 5. Журнал ~/dotamate-collector/collect.log, архив ~/dotamate-collector/archive/matches.
- crontab: править только полным файлом (~/dotamate-collector/crontab.txt).
- Схема 3 (inv) на сервере; первые матчи схемы 3 — с прогона 08:41 МСК 02.10.

## MapProbe (обработчик Clarity)
- tools/replay-parser/MapProbe.java: `java -cp dotamate-parser.jar:<dir> MapProbe file.dem [шаг_сек]` → строки `bld` и `cr` (живые крипы линии/осадные, кроме m_bIsWaitingToSpawn).
- Время как в odota/parser: round((serverTick из CNETMsg_Tick, во время паузы m_nPauseStartTick − m_nTotalPausedTicks)/30) − round(m_flGameStartTime); только m_nGameState=5. Проверка: конец 3835 = t1 матча 9024842732.
- Позиции 36 строений совпали в 9024842732 и 9024489311. Обе tower4 в журнале боя называются одинаково → какая пала, неизвестно (убирается первая по списку).

## Крипы — решение владельца: все крипы раз в 2 с, плавно
- Формат: creeps {step:2, from, f:[[side,x,y, …], …]}, side 0 Radiant / 1 Dire, x/y целые клетки.
- Размер на 64-мин матче 9024842732: +936 КБ JSON / +204 КБ gzip (файл был 552 КБ / 158 КБ gzip). Время MapProbe ~6 с.

## ВАЖНО: перенос файлов на компьютер владельца
- Каждый раз копировать в новую папку (outputs/uN/…) и после записи сверять md5 (PNG/JPG меняют байты при передаче — сверять пиксели).

## Технические константы
- Java на сервере: ~/dotamate-collector/jre21, флаги `-Xmx1500m -Xlog:disable -Xlog:all=warning:stderr -XX:+UseSerialGC -XX:ActiveProcessorCount=2 …`.
- Парсер: odota/parser + ParseCli (jar на сервере ~/dotamate-collector/dotamate-parser.jar). Нормализатор схема 3.
- Мост: .cmd писать с CRLF и без кириллицы в командах.
