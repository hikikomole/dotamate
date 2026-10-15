# Поиск по сайту с русскими синонимами (02.10.2026) — ВЫЛОЖЕНО, версия 10

Правило владельца: на сайте только оригинальные названия героев/предметов; русские — только для поиска, не показываются.

## Данные
- `tools/build-search-aliases.js` → `data/search-aliases.json` {heroes:{id:[...]}, items:{key:[...]}, pages:[{t,u}]}.
- Источник — файлы игры (читает VPK сам): `dota/pak01_dir.vpk` → `dota_russian.txt` (`npc_dota_hero_<x>__name_alias`), `abilities_russian.txt` + `abilities_english.txt` (`DOTA_SearchAlias_Ability_item_<x>`). Официальные синонимы Valve: 127/127 героев, 182/262 предмета.
- Остальные 80 предметов — `tools/search-aliases-own.json` (черновик Gemini gemini-3.6-flash, проверен вручную, убраны неоднозначные «шард», «аганим», «баннер» и т.п.).
- Запуск: `node tools/build-search-aliases.js ["<...\dota 2 beta\game>"]`. Нужна установленная игра → только на компьютере владельца. Перезапускать после патча и после новых гайдов (pages из *-urls.json), затем scp `data/search-aliases.json` в `~/dotamate-src/data/` и выкладка.

## Код
- `js/search.js` — единый модуль `window.D2HSearch` (heroes/items/pages/heroMatch/itemMatch/onReady). Регистр, ё/е, пробелы/дефисы, раскладка (gelf→пудж), начало слова, 1 опечатка (только если точных нет).
- Подключён в `page-shell.html` и `build-guide-pages.js` перед app.js.
- Переведены: `js/draft-tool.js` (findHeroes; home-draft через candidates), `js/app.js` (герои, предметы, статистика), `js/v43-features.js` (общий поиск: герои, предметы, страницы; группа «Разделы» заменена страницами).
- Рецепты «X — рецепт» → «X Recipe» (как в англ. клиенте): `tools/build-items-ru.py`, `js/app.js`, `data/items-ru.json` (на сервере переименовано тем же скриптом).

## Проверено
- 40/41 тестовых запросов. «скипетр» → сначала Ghost Scepter: у Valve это синоним обоих предметов.
- Стенд 1440 и 390 px, ошибок в консоли нет.
- Прод v10: на сервере search.js и search-aliases.json совпадают по md5 с локальными, `search.js?v=10` в страницах, «Abyssal Blade Recipe» в items-ru.json.
