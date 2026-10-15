# 100 гайдов (02.10.2026, вторая партия) — ВЫЛОЖЕНО, версия 21

Добавлены в конец `guide-content.js` (121 → 221), страницы собраны `build-guide-pages.js`, каталог — `build-pages.js`, sitemap 746 адресов. Копия статей: `Claude outputs/u-guides-oct/new-guides-100b.json`; резервные копии: guide-content.bak2.js, build-pages.bak.js; перед правками выкладки — `Claude outputs/guides/build-pages.before-groups.js`, `guide-content.before-attr.js`.

## Каталог (build-pages.js, учтено при выкладке v21)
- `GUIDE_ITEM_SUBS`: 37 новых slug предметных статей распределены по подразделам (basics/early/damage/defense/control/team).
- Новые темы каталога: `heroes` «Герои и способности» (тег ГЕРОИ, 44 статьи), `patch` «Патчи» (тег ПАТЧ, 10, вкл. patch-741-overview), `esports` «Киберспорт» (тег КИБЕРСПОРТ, 4). КИБЕРСПОРТ убран из `rank`; playing-vs-illusions оставлен в «Роли и драфт» (GUIDE_GROUP_BY_SLUG).
- Итог: Предметы 100, Герои и способности 44, Механики и фарм 17, Роли и драфт 16, Карта и обзор 11, Рейтинг и рост 10, Патчи 10, Новичку 8, Настройки 5, Командная игра 4, Киберспорт 4 = 229.

## attributes-explained — исправлено по файлам игры (VPK, npc_dota_hero_*.txt, 7.41f)
- Сила: Primal Beast и Centaur 4.3, Tiny 4.2, Ogre Magi 4 (было «Tiny, Ogre Magi, Centaur по 4.2»).
- Ловкость: Morphling 4.2 (лидер), Terrorblade 4, Monkey King 3.7 (было Morphling 3.9).
- Интеллект: Pugna 5.2, Outworld Destroyer 4.2, Skywrath Mage 4.1 (OD раньше пропущен).
- Таблица «к 25 уровню»: Tidehunter 25 + 3.9 → 118.6 силы, 2729 здоровья; Anti-Mage 25 + 2.8 → 92.2 ловкости, 17.4 брони, +92 скорости атаки; Invoker 22 + 4 → 118 интеллекта, 1491 маны (база 120 HP / 75 маны из npc_dota_hero_base.txt).

## Источники
- Valve datafeed 02.10.2026: herodata (все 128 записей, без Target Dummy), itemdata (нейтральные), patchnotes (русские), abilitylist/itemlist; актуальный патч 7.41f.
- Файлы игры с ПК (Steam, VPK 26.09.2026): npc_units.txt, neutral_items.txt, items.txt (IsObsolete — устаревшие предметы исключены), abilities_russian.txt, tips_russian.txt.
- data/items-ru.json, data/item-heroes.json (OpenDota) — сайт.
- Киберспорт: Википедия (The International), GosuGamers, dota2.com; системные требования — Steam.

## Найдено, не исправлено
- data/heroes.json (OpenDota) отстаёт от Valve: у Anti-Mage ловкость 24→25, скорость 310→315 (на страницах героев сайта цифры из OpenDota).
- В патчах 7.41c/d/e есть запись героя с id 1961, которого нет в списке героев Valve, — пропущена.
- Названия у Valve: Outworld Destroyer, Ringmaster (в data/heroes.json — Outworld Devourer, Ring Master).
