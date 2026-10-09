-- Game-of-Day aggregates on Turso, written straight from the browser (no Worker in between). No player data: one row per solve = (random id, day, time, bin).
-- Run once: turso db shell <db> < schema.sql   (idempotent). A database made with the earlier design (trigger-maintained day / bin / best tables) must be recreated.
--
-- Validation only. Turso (libSQL) checks every statement a trigger runs against the token's table permissions, so a trigger that maintains aggregate
-- tables would force the public token to be able to write them. Here the trigger only reads and raises: the browser token is just
--   turso db tokens create <db> -e never -p all:data_read -p submit:data_add
-- and n / sum / bins / best are computed from `submit` (plus `seed`) when they are read. `submit` is the only copy of the data: never delete from it.
-- Mirrors src/core/hist.js (NB = 80, TOP_K = 10, MIN_MS = 500, MAX_MS = 3600000, REPLAY_DAYS = 90) and the Worker: the day is a real date, at most
-- REPLAY_DAYS + 1 = 91 UTC days back and 1 ahead. No WITHOUT ROWID, so that it also loads on a database of the experimental Turso engine.
-- The queries the client sends are TURSO_SQL in src/platform/leaderboard.js; server/turso/schema.test.mjs runs them against worker.js.

-- Histogram bins as integer ms ranges [lo, hi), generated with binOf() of src/core/hist.js (SQL has no exact log()). The block between the marker lines is
-- written by tools/print-bin-edge.mjs --write: after changing NB, T0_MS or RATIO follow "Changing the histogram bins" in server/README.md.
CREATE TABLE IF NOT EXISTS bin_edge (bin INTEGER PRIMARY KEY, lo INTEGER NOT NULL, hi INTEGER NOT NULL);
-- bin_edge:begin  (generated: node tools/print-bin-edge.mjs --write, from NB = 80, T0_MS = 1000, RATIO = 1.1 of src/core/hist.js; do not edit by hand)
INSERT OR REPLACE INTO bin_edge (bin, lo, hi) VALUES
  (0, 0, 1100),
  (1, 1100, 1211),
  (2, 1211, 1332),
  (3, 1332, 1465),
  (4, 1465, 1611),
  (5, 1611, 1772),
  (6, 1772, 1949),
  (7, 1949, 2144),
  (8, 2144, 2358),
  (9, 2358, 2594),
  (10, 2594, 2854),
  (11, 2854, 3139),
  (12, 3139, 3453),
  (13, 3453, 3798),
  (14, 3798, 4178),
  (15, 4178, 4595),
  (16, 4595, 5055),
  (17, 5055, 5560),
  (18, 5560, 6116),
  (19, 6116, 6728),
  (20, 6728, 7401),
  (21, 7401, 8141),
  (22, 8141, 8955),
  (23, 8955, 9850),
  (24, 9850, 10835),
  (25, 10835, 11919),
  (26, 11919, 13110),
  (27, 13110, 14421),
  (28, 14421, 15864),
  (29, 15864, 17450),
  (30, 17450, 19195),
  (31, 19195, 21114),
  (32, 21114, 23226),
  (33, 23226, 25548),
  (34, 25548, 28103),
  (35, 28103, 30913),
  (36, 30913, 34004),
  (37, 34004, 37405),
  (38, 37405, 41145),
  (39, 41145, 45260),
  (40, 45260, 49786),
  (41, 49786, 54764),
  (42, 54764, 60241),
  (43, 60241, 66265),
  (44, 66265, 72891),
  (45, 72891, 80180),
  (46, 80180, 88198),
  (47, 88198, 97018),
  (48, 97018, 106719),
  (49, 106719, 117391),
  (50, 117391, 129130),
  (51, 129130, 142043),
  (52, 142043, 156248),
  (53, 156248, 171872),
  (54, 171872, 189060),
  (55, 189060, 207966),
  (56, 207966, 228762),
  (57, 228762, 251638),
  (58, 251638, 276802),
  (59, 276802, 304482),
  (60, 304482, 334930),
  (61, 334930, 368423),
  (62, 368423, 405266),
  (63, 405266, 445792),
  (64, 445792, 490371),
  (65, 490371, 539408),
  (66, 539408, 593349),
  (67, 593349, 652684),
  (68, 652684, 717952),
  (69, 717952, 789747),
  (70, 789747, 868722),
  (71, 868722, 955594),
  (72, 955594, 1051154),
  (73, 1051154, 1156269),
  (74, 1156269, 1271896),
  (75, 1271896, 1399085),
  (76, 1399085, 1538994),
  (77, 1538994, 1692893),
  (78, 1692893, 1862183),
  (79, 1862183, 4611686018427387904);
DELETE FROM bin_edge WHERE bin >= 80; -- bins that no longer exist (NB shrank); the table is never empty in between, so a solve sent meanwhile is still checked
-- bin_edge:end

-- One row per solve. `uid` (random, made by the client) makes a retry idempotent: INSERT OR IGNORE skips a known uid. `bin` is sent by the client
-- (binOf(ms)) and checked by the trigger, so that the reads can group by it without a log().
CREATE TABLE IF NOT EXISTS submit (uid TEXT PRIMARY KEY, day INTEGER NOT NULL, ms INTEGER NOT NULL, bin INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS submit_day ON submit (day, bin, ms); -- covers every read: a day's n, sum, bins and best never touch the table itself

-- Synthetic seed players of a day (tools/gotd-seed.mjs): a JSON array of 1..8 ms. The row is also the "already seeded" gate. Only the seeder's
-- token (-p all:data_read -p seed:data_add) can write it; the view below counts these players like real ones, as the other backends do.
CREATE TABLE IF NOT EXISTS seed (day INTEGER PRIMARY KEY, ms TEXT NOT NULL CHECK (json_valid(ms) AND json_array_length(ms) BETWEEN 1 AND 8));

-- Every player of a day, real and seed: all aggregates are computed from this.
DROP VIEW IF EXISTS solve;
CREATE VIEW solve AS
  SELECT day, ms, bin FROM submit
  UNION ALL
  SELECT s.day, j.value, (SELECT e.bin FROM bin_edge e WHERE j.value >= e.lo AND j.value < e.hi)
  FROM seed s, json_each(s.ms) j;

DROP TRIGGER IF EXISTS submit_ai; -- so that re-running this file also updates the rules
CREATE TRIGGER submit_ai AFTER INSERT ON submit
BEGIN
  SELECT RAISE(ABORT, 'invalid')
  FROM (SELECT date(substr(NEW.day, 1, 4) || '-' || substr(NEW.day, 5, 2) || '-' || substr(NEW.day, 7, 2)) AS d)
  WHERE typeof(NEW.uid) <> 'text'
     OR length(NEW.uid) NOT BETWEEN 8 AND 64
     OR typeof(NEW.day) <> 'integer'
     OR typeof(NEW.ms) <> 'integer'
     OR typeof(NEW.bin) <> 'integer'
     OR NEW.ms NOT BETWEEN 500 AND 3600000
     OR NOT EXISTS (SELECT 1 FROM bin_edge WHERE bin = NEW.bin AND NEW.ms >= lo AND NEW.ms < hi)
     OR d IS NULL
     OR strftime('%Y%m%d', d) <> printf('%08d', NEW.day)
     OR julianday(date('now')) - julianday(d) NOT BETWEEN -1 AND 91;
END;
