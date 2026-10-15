# T2 — пересчёты на данных Steam (03.10.2026)

Ничего не выкладывалось, версия сайта не менялась, daily-update.js, crontab, server.js, deploy/worker.js не тронуты, git commit не делался. Правки только на ПК (C:\Users\vsegd\Documents\DOTAMATE); в ~/dotamate-src НЕ отправлялись — проверка шла в копии на сервере ~/steam-t2/stand.

## Файлы (ПК)
- tools/match-source.js — новый общий модуль чтения базы: `--source opendota|steam` (или MATCH_SOURCE), по умолчанию opendota. publicRows() отдаёт Steam-матчи в формате строки OpenDota [id, start, dur, rank|null, lobby, mode, rw, h0…h9] → сборщики почти не менялись. steamMatches() — сырые строки Steam без повторов. Срезы Steam: base — ранг null или ≤ 65; top — известный ранг 75–85.
- tools/build-our-stats.js — чтение через match-source; `--source steam` работает с `--tier top` и `--turbo` (турбо из data/steam-matches-turbo); rank null не отсекается.
- tools/build-draft-calibration.js — чтение через match-source (пересчёт a на Steam: `--source steam`).
- tools/build-stats.js — чтение через match-source; rank null не идёт в разрез по рангам (раньше Math.floor(null)→«Рекрут»); со steam у героя добавляются gpm/xpm (новые поля, старые не менялись); снимки истории — data/stats-history-steam/ (не смешивать источники в одном ряду). Позиции/линии/предметы — как сейчас (Stratz).
- tools/build-meta.js — `--source steam`: финальный инвентарь из Steam (ranked ≥ 20 мин, ранг null или ≤ 65). Позиций нет → база долей по герою целиком (byPos 0, «*» на сайте), нишевые пусты, lanes [] (на странице «—»), графиков нет.
- fetch-hero-builds.js — `--source steam`: прокачка 1–10 и таланты из ability_upgrades теми же buildProgression/buildTalents. data/builds/ НЕ трогает (контракт по позициям, у Steam их нет) — пишет сверку data/steam-builds-check.json. Запись в data/builds/ — после T3.
- tools/check-draft-matrix.js — необязательный аргумент файла: `node tools/check-draft-matrix.js data/our-matrix.json` (структура и покрытие; сверка со Stratz — только для снимка с полем bracket).
- Формат выходных JSON не менялся (только добавлены gpm/xpm героя в stats.json при steam).

## Проверки (сервер, копия ~/steam-t2/stand)
- Регрессия OpenDota: старый код vs новый без флага — 11 выходных файлов (our-meta/matrix base/top/turbo, draft-calibration base/top, stats.json, hero-main-roles.json, meta-escape.json) совпали байт-в-байт без полей времени. Все 7 запусков exit 0.
- База Steam на проверке: 30 260 ranked + 18 561 турбо (02.10 15:19–21:31 UTC, с пропуском: T1-отрезок + отрезок 7582190000–7582207031). Сбор остановлен: Steam API с 19:56 UTC 03.10 отвечает 503 на любой запрос (проверено 2 раза, 7 запросов) — курсор data/steam-matches/_state.json = 7582207031.
- Сверка за один период (окончание матча 02.10 21:15:39–21:27:40 UTC, внутри непрерывного отрезка ленты):
  - OpenDota лобби 7: 4 591 матч, из них в Steam найдено 4 327 (94,2 %), расхождений героев/исхода 0. Steam (все ранги): 5 050, из них в OpenDota 4 595.
  - Винрейты 116 героев (≥ 100 матчей), OpenDota лобби 7 vs Steam все ранги: |разница| средняя 0,95 п.п., медиана 0,74, макс 4,63; корреляция 0,951. Топ-10: Death Prophet −4,6; Lone Druid −2,8; Marci −2,8; Jakiro −2,6; Broodmother +2,5; Morphling −2,4; Oracle +2,4; Mars +2,4; Slardar +2,4; Gyrocopter +2,4. Выборки почти совпадают (94 % общих матчей) — малая разница ожидаема.
  - OpenDota лобби 0+7 (как сейчас на сайте) vs Steam: средняя 1,21 п.п., макс 5,13 (Death Prophet −5,1), корреляция 0,923. Разница из-за лобби 0 (обычный All Pick: 594 из 5 187 = 11 %) — его Steam-сборщик не берёт.
  - Широкое окно (16:56–21:11, но Steam с пропуском — периоды не совпадают): 14 775 vs 18 701 матч, средняя 1,92 п.п., макс 9,52 (Void Spirit), корреляция 0,709 — на уровне шума выборки (ожидаемый 1σ 2,32 п.п.).
- Матрица Steam (base): 28 712 матчей; на пару «против» среднее 89,7, медиана 54, пар < 50 — 3 770 из 8 001 (у OpenDota база 1,195 млн матчей). check-draft-matrix: base/top/turbo — структура ок, совокупный винрейт vs 50,26 / 49,72 / 50,29 %.
- Калибровка a на Steam: 0,00394 (28 712 матчей: 20 098/4 306/4 308), log loss 0,68306 (монетка 0,69315), Brier 0,245, угадано 55,41 %. На OpenDota сейчас a = 0,005103 (1 195 115 матчей), угадано 56,51 %. Меньшее a — от редкой матрицы, не от источника; честное сравнение — когда Steam наберёт сотни тысяч матчей.
- Divine/Immortal (ранг 7–8): 1 548 матчей Steam, на пару «против» 4,8 (медиана 3), пар < 50 — 7 997 из 8 001. МАЛО. И принципиально: ранг Steam-матча берётся только из ленты OpenDota top, поэтому Steam-срез — подмножество OpenDota top и ничего не добавляет. Калибровка top на Steam не запускается (< 5 000). Рекомендация: срез Divine/Immortal оставить на OpenDota (public-matches-top).
- Турбо Steam: 18 494 матча, на пару «против» 57,8 (медиана 34), пар < 50 — 5 120.
- Доля ранга у Steam: на отрезке, который база OpenDota покрыла, 6 606 из 7 228 (91 %); в целом 25,6 % (T1-отрезок OpenDota не покрыт).
- Прокачка/таланты Steam (герой целиком, все ранги) vs Stratz (самая частая позиция, Divine/Immortal): уровни 1–10 совпали 1 067/1 270 (84,0 %), таланты 425/496 (85,7 %); id способностей Steam и Stratz совпадают.
- META Steam: 28 618 матчей, 286 180 сборок, с оценкой 271 688; «24 часа» 5, «5 дней» 5, список 1 500, нишевые 0 (нет позиций); 187 страниц матчей.
- stats.json Steam: 28 712 матчей, тир-лист 96 героев (порог 1 000), связок 262, gpm/xpm у 127 героев.
- Сборка страниц в копии со Steam-данными: build-pages.js (11 страниц), build-hero-pages.js (127), build-hero-guides.js (127) — exit 0, строк с ошибками 0. В браузере (Playwright) страницы не открывались.

## Команды
- `node tools/build-our-stats.js --source steam [--tier top|--turbo]`, `node tools/build-draft-calibration.js --source steam`, `node tools/build-stats.js --source steam`, `node tools/build-meta.js --source steam`, `node fetch-hero-builds.js --source steam`, `node tools/check-draft-matrix.js data/our-matrix.json`.
- Сверка: ~/steam-t2/s197.js <корень> <seqA> <seqB> (на ПК: Claude outputs/shell/s197.js). Результаты прогонов: ~/steam-t2/r-old, r-new-od, r-steam.

## Для T5 / не сделано
- Steam-сборщик берёт только лобби 7; сайт сейчас считает лобби 0+7. Решить: оставить только рейтинговые (честнее) или добавить лобби 0 в collect-steam-matches.js.
- Steam даёт все ранги; ранг известен только при совпадении с OpenDota. «0–4500» на Steam точно не выделить без OpenDota.
- Steam-выходы пишутся в те же файлы, что OpenDota: для 7 дней параллели в T5 нужен отдельный каталог/суффикс вывода.
- Прокачка в data/builds/, позиции в META и /stats/#positions — после T3.
- Длинное окно сверки не собрано из-за 503 Steam; повторить, когда API оживёт (cursor 7582207031).
- Изменённые файлы на сервер (~/dotamate-src) не отправлены.
