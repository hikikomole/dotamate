# Games batch 2 — локальная реализация

Добавлены `/games/counter-pick/`, `/games/budget-build/`, `/games/minimap-awareness/`, `/games/rune-timing/`, `/games/cooldown-tracking/` в порядке плана.

## Источники и границы модели

- Контрпики: 122 соперника; только существующие пары из `data/hero-counters.json`, n ≥ 300. Направление — кандидат против соперника; d не является обещанием победы. Снимок Ranked All Pick 0–4500 MMR, 2026-09-25.
- Закуп: цены из `js/games/data/mechanics.json` версии 6966: Blink 2250, Force Staff 2200, Glimmer Cape 2150, Ghost Scepter 1500, Dust 80, Boots 500, Eul 2600. Свойства — явно описанные эффекты местного каталога, с сохранёнными выдержками.
- Миникарта: полностью оригинальная условная схема; игровые координаты, скорости и дальности не заявлены.
- Руны: вода 2:00/4:00; сила с 6:00 через 2 минуты — `guide-content.js`, `match-timings`. Путь, обход и переходы между эпизодами условные; внутри эпизода часы идут 1:1.
- Кулдауны версии 6966: Blink 15 с, Force Staff 19 с, Ghost Scepter 22 с; без сокращения перезарядки. Начальное обучение наблюдает Blink с шестой секунды после применения, сохраняя полные 15 с кулдауна.

## Проверки

- `node build-pages.js`: 36 страниц, локальные копии ресурсов и данных.
- `node tools/check-games.js`: исходные пять игр и 15 сценариев новой партии на dt=1/60; успех, ошибка, таймаут, оценка S–D, совет, бюджет, возврат покупки, лимит слотов, отсутствие повторной награды, развитие сложности, сверка источников.
- `node tools/check-links.js`: 777 страниц, 75 394 ссылки, битых нет.
- `node tools/check-palette.js`: 0 нарушений.
- `node --check`: 26 файлов; браузерные модули проверяются через `--input-type=module --check` со stdin, сборочные — как CommonJS.
- `node tools/check-games-browser.js`: локальный Chromium, 1440/1100/360 px, DPR 2, кнопки ≥44 px, отсутствие горизонтального переполнения и JS-исключений, обучение без очков, начисление очков кнопками, пауза по visibilitychange, результаты, цели Metrika через заглушку и повтор R. Внешние подключения блокируются. Скриншоты и JSON-отчёт: `outputs/games-batch2-qa/`.
- Ограничение: физические телефоны и стабильность 60 fps на них не проверены; браузерный прогон использует управляемый RAF. Отправка реальных событий Metrika не выполнялась.

## Изменённые и добавленные исходники

- `build-pages.js`, `games-registry.js`, `css/games.css`.
- `js/games/engine.js`, `js/games/logic.js`, `js/games/play.js`, `js/games/hub.js`.
- `js/games/tactics.js`, `js/games/tactics-logic.js`, `js/games/tactics-art.js`, `js/games/data/tactics.js`.
- `js/games/counter-pick.js`, `js/games/budget-build.js`, `js/games/minimap-awareness.js`, `js/games/rune-timing.js`, `js/games/cooldown-tracking.js`.
- `tools/games-render.js`, `tools/build-tactics-data.js`, `tools/check-games.js`, `tools/check-games-browser.js`.
- Этот отчёт: `docs/games/batch-2-report.md`.

Сборка перегенерировала страницы из существующего `build-pages.js`, включая `games/**/index.html`, их локальные копии в `deploy/`, ресурсы `deploy/js/games/`, `deploy/css/games.css`, `page-urls.json` и штатные снимки `data/games/item-recipes.json` / `data/live-items.json` с копиями в `deploy/data/`. Исходники `css/tokens.css`, `art.js`, `lane.js` и `mechanics.json` не редактировались. Коммит, публикация, установка пакетов и внешние запросы не выполнялись.
