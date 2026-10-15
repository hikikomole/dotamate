# Единое ежедневное обновление — разведка и план (03.10.2026, НЕ утверждено, код и crontab не менялись)

## Факты (сервер, crontab.txt = crontab -l)
- 04:17 и 10:17 MSK: tools/daily-update.js --auto (10:17 — повтор, выходит, если сегодня был успех). Работает с 27.09, last-success 2026-10-03.
- :41 каждый час: tools/replay/collect.js --limit 5 (архив реплеев для /live).
- 12:00: tg-post.js --send (Telegram «Мета дня»).
- daily-update сам выкладывает на прод (tools/deploy-hostiman.js) без команды «выкладывай» и без версии +1.
- 7 дней подряд (27.09–03.10) пропуски: сбор META, роли, роли по рангам, билды — Stratz HTTP 429 на сборе META, остальные шаги Stratz падают следом.
- 03.10: свежие матчи OpenDota 525/1400 запросов, 52 403 новых матча, 64 мин; top-срез 13 мин; докачка истории 0 мин.
- Только вручную (в daily нет): fetch-patch-notes, fetch-hero-valve-data, valve-hero-stats, fetch-home-meta, fetch-hero-guide-data, fetch-talent-names-ru, fetch-valve-items-ru / build-items-ru, build-heroes-snapshot, иконки, topup-hero-abilities. Способности — внутри daily, раз в 90 дней.
- Защиты уже есть: замок logs/daily.lock (6 ч), отметка успеха, дедуп по match_id по дням (collect-public-matches), _tried.json + запись через .tmp/rename (collect-meta-matches), откат способностей при провале проверки, блок выкладки при чужих правках deploy/.
- Локальная задача Windows «DotaMate - ежедневное обновление» — последний лог 26.09 (висела на замке). Возможный двойной запуск с сервером.

## План (кратко)
Фазы: 0 замок/предпроверка → 1 сбор (OpenDota свежие, top, история; Stratz одним бюджетом с паузой при 429) → 2 справочники Valve (раз в сутки, только если изменились) → 3 пересчёт в staging + проверки → 4 атомарная подмена data/ → 5 выкладка по решению владельца.
Вне суток: /live в реальном времени, реплеи ежечасно, Telegram 12:00.
