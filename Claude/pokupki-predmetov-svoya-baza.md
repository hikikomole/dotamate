# Покупки предметов из своей базы + карточка героя в статье контрпиков (25.09.2026)

Коммит `46429841`, воркер `e84eb3fa`.

## Данные
- tools/collect-meta-matches.js тянет `stats.itemPurchases{time itemId}` из Stratz → поле игрока `b:[[сек, itemId]]`. `--backfill` дозапрашивает старые матчи.
- tools/build-hero-items.js → data/hero-items.json `{n, start, early, mid, late, vlate:[{i,g}]}`. Фазы: <0, 0–10, 10–25, 25–40, 40+ мин. Матчи с патча (patch-notes.json timestamp).
- Порог по доле: g ≥ max(2, ⌈n×2%⌉), до 6 на фазу. Исключены рецепты, tpscroll, id не из каталога.
- На 25.09: 1218 матчей, n на героя min 8 / медиана 73 / max 343. У 8,5% игроков Stratz покупок не отдаёт.
- Stratz находит ~23% наших матчей; daily-update теперь --max 8000 (~1800 матчей/сутки).

## Фронт
- Карточка (app.js openHero): Кто контрит → Покупки → Способности → Гайд.
- /guide/counter-picks/: ячейки `{t,href,hero}` → `a[data-hero-open]`; делегированный клик в app.js (без модификаторов) открывает карточку. Окно + скрипты разделов подключаются только в статьях с dataTable counters.

## Не сделано
- Страницы героев и гайды («Варианты закупов») всё ещё на seo/hero-guide-data.json (OpenDota).
