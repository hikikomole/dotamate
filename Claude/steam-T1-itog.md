# T1 — сборщик матчей Steam Web API (03.10.2026)

Ничего не выкладывалось, daily-update.js и crontab не тронуты, git commit не делался, версия сайта не менялась.

## Файлы
- tools/collect-steam-matches.js — новый (похожего не было: tools/collect-public-matches.js ходит в OpenDota и хранит только героев, исход и ранг). На ПК и на сервере ~/dotamate-src одинаковые, md5 e8453782cb5f64bf8d87212ec8153057.
- tools/sync-deploy.js — в SKIP_DIRS добавлены steam-matches, steam-matches-turbo (на ПК и на сервере).
- .gitignore — data/steam-matches/, data/steam-matches-turbo/.
- Сервер: тестовые данные в ~/dotamate-src/data/steam-matches*, логи ~/steam-t1/. Мост: Claude outputs/shell/s184–s192.

## Как устроено
- Лента GetMatchHistoryBySequenceNum по 100 матчей; курсор nextSeq в data/steam-matches/_state.json (запись .tmp → rename, после записи данных).
- Бюджет: --budget N на запуск (по умолчанию 2000), дневной потолок 90 000 (10 000 из 100 000 оставлено /api/dota/player — ключ общий).
- 429: ждать 30 с (Retry-After не приходит), пауза +0,5 с (до 6 с), после 100 успешных −0,25 с (не ниже 1,5 с). 5xx/сеть: 10·n с, 6 попыток подряд — выход без сдвига курсора.
- Замок data/steam-matches/.lock (pid; брошенный снимается, если процесса нет или старше 6 ч). Проверено: второй запуск при идущем первом вышел с кодом 3.
- Фильтр: lobby_type 7 + game_mode 22 → data/steam-matches/, game_mode 23 → data/steam-matches-turbo/; duration > 900 с; human_players = 10; ни у кого leaver_status > 1 (1 = отключался и вернулся — оставляем).
- Хранение: YYYY-MM-DD.jsonl.gz по дню start_time (UTC), дописываются gzip-члены; дедуп по match_id внутри дня.
- Ранг: avg_rank_tier из data/public-matches и public-matches-top (день матча ±1); нет — null. `--fill-ranks` дозаполняет позже, `--stats` — счёт, доля ранга, дубли.
- «Догнали ленту» — только если пачка < 100 и отставание < 1 ч (в глубине ленты Steam отдаёт 99 из 100 — первая версия из-за этого останавливалась).

## Формат строки
[match_id, match_seq_num, start_time, duration, rank|null, radiant_win(0/1), game_mode, lobby_type, bans[hero_id…], p0…p9]
p (по player_slot: 0–4 Свет, 128–132 Тьма): [hero_id, player_slot, kills, deaths, assists, last_hits, denies, gpm, xpm, level, net_worth, hero_damage, tower_damage, hero_healing, [item_0..5], [backpack_0..2], item_neutral, item_neutral2, aghanims_scepter, aghanims_shard, moonshard, leaver_status, [ability, time, …]]. account_id не хранится.

## Проверка (сервер, 03.10 18:25–19:26 UTC)
- Запуск 1 (--budget 450, старт seq 7581867167 ≈ 25 ч назад): 450 запросов за 55,7 мин; 429 — 15; 5xx — 0. Просмотрено 43 494 матча: ranked 20 921, турбо 12 973; отсеяно: другие режимы 7 218, короткие 284, с покинувшими 2 098.
- Запуск 2 (--budget 50) продолжил с курсора 7581920050 (= nextSeq после запуска 1): 50 запросов, 429 — 5, ranked 2 111, турбо 1 417, дублей 0.
- Итого 500 запросов: ranked 23 032, турбо 14 390; дублей по match_id 0 (--stats).
- Ранг: 1 153 из 23 032 ranked (5,01 %), турбо 48 из 14 390; все найденные — из public-matches-top (Divine 5+). --fill-ranks: дозаполнено 0.
- Причина низкой доли: в этом диапазоне match_id (02.10 15:19–17:12 UTC) в data/public-matches (база 0–4500) — 0 строк, хотя диапазон внутри oldest/newest базы: сборщик OpenDota (1400 запросов/сутки) оставляет пропуски. В public-matches-top — 3 613 строк. Нужен замер доли ранга на свежем окне, которое база OpenDota уже прошла (T5).
- Размер: ~1,1 КБ на матч в gzip (ranked 1 107 Б, турбо 1 168 Б).

## Проблемы и не сделано
- Темп: пауза быстро упирается в 6 с (≈ 8 запросов/мин ≈ 480 матчей ранкед/мин просмотра ≈ 11–12 тыс. запросов/сутки). Отставание стояло на ~25,8 ч и не сокращалось — лента не догоняется. Для «реального времени» нужно стартовать от текущего seq (без --start-seq — так и сделано по умолчанию) и подобрать паузу (6 с даёт 429 ~3 %, 1,5–2 с — ~10 %).
- Объём полной ленты: ~0,6–0,7 млн ranked/сутки ≈ 0,7 ГБ/сутки — решать в T5 (бюджет или срез). Диск сервера: свободно 2,9 ТБ.
- Ранг из OpenDota покрывает малую долю матчей — для T2 Divine/Immortal-срез и ранги по Steam-данным почти пусты; вопрос к владельцу/T5.
- Тестовые данные (~42 МБ) на сервере оставлены для T2/T3; курсор указывает на 02.10 — перед боевым запуском удалить data/steam-matches/_state.json, чтобы начать с текущего момента.
