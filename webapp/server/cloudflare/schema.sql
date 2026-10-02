-- Game-of-Day aggregates only: no player data. ~1.4-2.5 KB/day worst case.
CREATE TABLE IF NOT EXISTS day  (day INTEGER PRIMARY KEY, n INTEGER NOT NULL, sum_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bin  (day INTEGER NOT NULL, bin INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, bin)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS best (day INTEGER NOT NULL, ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS best_day_ms ON best (day, ms);
-- Synthetic seed players of a day (JSON array of ms, already counted in day / bin / best). The row is also the "already seeded" gate.
CREATE TABLE IF NOT EXISTS seed (day INTEGER PRIMARY KEY, ms TEXT NOT NULL);
