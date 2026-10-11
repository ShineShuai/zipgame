-- Game-of-Day aggregates only (day, bin, best, seed): no player data. ~1.4-2.5 KB/day worst case. The behaviour rows (play) are at the end.
CREATE TABLE IF NOT EXISTS day  (day INTEGER PRIMARY KEY, n INTEGER NOT NULL, sum_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bin  (day INTEGER NOT NULL, bin INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, bin)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS best (day INTEGER NOT NULL, ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS best_day_ms ON best (day, ms);
-- Synthetic seed players of a day (JSON array of ms, already counted in day / bin / best). The row is also the "already seeded" gate.
CREATE TABLE IF NOT EXISTS seed (day INTEGER PRIMARY KEY, ms TEXT NOT NULL);

-- Behaviour rows (src/core/behaviour.js, server/README.md "Behaviour rows"): the same table and the same ceiling as server/turso/schema.sql.
-- The Worker validates before it inserts (POST /play), so there is no trigger here. No index: tools/behaviour.mjs reads the rows whole.
-- Off switch / ceiling, from your own login:  npx wrangler d1 execute zip-gotd --remote --command "UPDATE play_cfg SET cap = 0"
CREATE TABLE IF NOT EXISTS play (day INTEGER NOT NULL, ms INTEGER NOT NULL, u INTEGER, deep INTEGER, s INTEGER, pz BLOB, ev BLOB, v INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS play_cfg (id INTEGER PRIMARY KEY CHECK (id = 1), cap INTEGER NOT NULL);
INSERT OR IGNORE INTO play_cfg (id, cap) VALUES (1, 3000000);
