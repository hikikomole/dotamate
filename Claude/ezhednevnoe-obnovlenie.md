# Ежедневное обновление (сервер Hostiman; обновлено 09.10.2026, U5)

Запуск: crontab на сервере, `tools/daily-update.js --auto` в 04:17 и 10:17 МСК (10:17 — повтор, выходит, если сегодня был успех). Задача Windows снята (26.09). Выкладывает только данные (отпечаток кода, см. claude/versiya-sayta.md).

## Порядок с U5 (v59)
1. OpenDota: свежие публичные матчи (ранг Steam-матчей и кандидаты Stratz), срез Divine 5/Immortal (свежие + история --back 400). Докачка истории основной ленты убрана.
2. Stratz, малый бюджет: детали матчей `collect-meta-matches --max 2000` (время покупок, линии, эталон позиций 4/5); backfill покупок убран. Покупки/предметы/страницы предметов — по этим матчам, как раньше.
3. Роли Stratz (hero-positions, rank-positions); «Предметы билдов (Stratz)» → data/builds-stratz/; «Прокачка и таланты (Steam)» `fetch-hero-builds.js --source steam --site` → data/builds/ (контракт POSITION_1…5, поддержка 4/5 — общий билд, supMerged).
4. Способности (раз в 90 дней).
5. Steam (куча 1200 МБ): матрица `build-our-stats --source steam --tier all --main` и калибровка `build-draft-calibration --source steam --tier all --main` (сбой — стоп), турбо `--source steam --turbo`, META `build-meta --source steam`. Верхний срез top и его калибровка — OpenDota, как раньше.
6. Контрпики → ранг Steam-матчей (--fill-ranks) → /stats/ (`build-stats --source steam`) → страницы героев, гайды, статьи → sync → deploy.

Сбор Steam — отдельная строка crontab каждые 10 мин (`collect-steam-matches.js --budget 48 --keep-days 30`), ранги — 06:47. Параллельный расчёт «,1» (run.sh) из crontab убран 09.10; data-steam/ и ~/dotamate-steam оставлены до подтверждения владельца.

Журнал logs/daily-ДАТА.log, отметка logs/last-success.txt, замок logs/daily.lock (6 ч). Сбои сбора не блокируют выкладку; сбой матрицы/калибровки — блокирует. Лимиты хостинга: память ≈ 1,5–2 ГБ, процессов 45 — шаги идут по одному.
