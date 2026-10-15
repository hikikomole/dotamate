# Лимиты хостинга (обновлено 10.10.2026)

## С 10.10.2026 тариф RuBig (сменил владелец; таблица лимитов Hostiman, скриншот владельца)
| Лимит | Было (RuGold) | Стало (RuBig) |
|---|---|---|
| Одновременных процессов (NPROC) | 45 | **115** |
| Одновременных веб-процессов (EP) | 20 | **30** |
| RAM | 1536 МБ | **3072 МБ** |
| CPU (на 1 ядро, не менее) | 30 % | **70 %** |
| Диск | 30 000 МБ | **50 000 МБ** |
| Время выполнения | 200 с | **400 с** |
| Скорость диска / IOPS | 100 МБ/с / 10240 | без изменений |

Что это значит для работы (не проверено на практике — первые дни смотреть журналы):
- Запас по процессам ×2,5 и по памяти ×2: можно не бояться 503 из-за одновременных node/java, но тяжёлое по-прежнему держать в очереди `heavy.lock` (памяти 3 ГБ на ВСЁ: PHP сайта + daily + сборщики; java разборщика реплеев сама берёт до -Xmx1500m).
- Диск 50 ГБ: база Steam на 30 дней ≈ 6,5–7,6 ГБ gzip (docs/architecture/data-independence.md §6) — помещается с запасом.
- Ограничения в crontab (UV_THREADPOOL_SIZE=2, --v8-pool-size=1, heavy.lock, skip-if-daily) пока НЕ снимать: менять по одному и только после наблюдения.

## История: 503 из-за лимита процессов (09.10.2026, тариф RuGold, NPROC 45)
- 09.10 с 04:52 до 05:15 МСК сайт отдавал 503 (270 ответов). error.log: `lsapi … CONNECTION_RESET`; `bash: fork: Resource temporarily unavailable` — упор в NPROC, не в память.
- Сделано: UV_THREADPOOL_SIZE=2 и NODE_OPTIONS=--v8-pool-size=1 в crontab; flock heavy.lock перед сборщиками реплеев, Steam и /pro/; /pro/ sync пропускается во время daily-update (skip-if-daily.sh). Копии crontab: crontab.txt.bak-threads-*, bak-queue-*.
- При новых 503: `grep -c CONNECTION_RESET ~/logs/dotamate.ru.error.log`, `ps -L -u $(id -u) --no-headers | wc -l`, `ps -u $(id -u) -o pid,etimes,args`.

## Сборщик реплеев: «parser exit 1» — причина и исправление (10.10.2026, ЖДЁТ ВЫКЛАДКИ)
- Причина: ошибка библиотеки Clarity 4.0.1 в нашем ~/dotamate-collector/dotamate-parser.jar (сборка 02.10): `java.lang.ArrayIndexOutOfBoundsException: Index 518583089 out of bounds for length 16384` в `skadistats.clarity.model.state.ClientFrame.getEntity`, падение за ~1 с. Не память, не процессы, не аккаунты Steam (11 аккаунтов работают).
- Масштаб (archive/_state.json на 10.10 00:20): 804 матча готовы, 97 — «parser exit 1», 6 — «нет salt». Каждый сломанный матч повторялся до 3 раз и занимал место в пачке из 5 → «итог 0–2/5».
- Исправление: новый разборщик = odota/parser master `7925516` (OpenDota сам перешёл на Clarity **5.0.1**) + наш ParseCli; MapProbe переведён на API Clarity 5 (getByDtName/getAllByDtName → `entities.stream().filter(Entities.byDtName(..))`). Файлы: tools/replay-parser/dotamate-parser.jar (md5 34e00031…), MapProbe.java/.class (md5 class 16fc50d0…). Старые — Claude outputs/u2/old-parser/.
- Проверка на сервере (~/backup/diag-parser, отдельно от архива):
  - 9035771412 (падал): старый — exit 1 за 1,1 с; новый — 241 521 строка за 5,5 с, нормализация OK (10 игроков, 3185 с), MapProbe OK;
  - 9035774674 (рабочий): старый 7,1 с, новый 5,6 с; нормализованный матч старый = новый (0 различий), вывод MapProbe побайтно одинаков (md5 f2cd84a5).
- collect.js (локально): текст исключения разборщика пишется в журнал; матч с исключением (exit 1) больше не повторяется (skip); снятие по таймауту/сигналу — повтор как раньше; потолок --limit поднят 5 → 10.
- Выкладка (по «выкладывай»): копия старого ~/dotamate-collector/dotamate-parser.jar → новый jar туда же; push кода; crontab — `--limit 6` (11 аккаунтов × 90 salt = 990 в сутки ≥ 144 запуска × 6 = 864); первые запуски — смотреть время запуска и память.
