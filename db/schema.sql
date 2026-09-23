-- Своя база публичных матчей нашего брекета (Herald — Guardian).
-- Источник: OpenDota /publicMatches. Храним только то, что нужно драфту:
-- кто с кем играл и кто выиграл. Ни игроков, ни личных данных тут нет.
CREATE TABLE IF NOT EXISTS matches (
  match_id    INTEGER PRIMARY KEY,
  start_time  INTEGER NOT NULL,
  duration    INTEGER NOT NULL,
  avg_rank    INTEGER NOT NULL,   -- avg_rank_tier: 11..15 Herald, 21..25 Guardian
  lobby_type  INTEGER NOT NULL,
  game_mode   INTEGER NOT NULL,
  radiant_win INTEGER NOT NULL,   -- 1 / 0
  r1 INTEGER NOT NULL, r2 INTEGER NOT NULL, r3 INTEGER NOT NULL, r4 INTEGER NOT NULL, r5 INTEGER NOT NULL,
  d1 INTEGER NOT NULL, d2 INTEGER NOT NULL, d3 INTEGER NOT NULL, d4 INTEGER NOT NULL, d5 INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_start ON matches(start_time);
CREATE INDEX IF NOT EXISTS idx_matches_mode  ON matches(game_mode, lobby_type);

-- Курсоры сборщика: докуда дошли вперёд (живой хвост) и назад (история).
CREATE TABLE IF NOT EXISTS collector_state (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
