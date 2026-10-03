-- Game-of-Day aggregates on Turso, written straight from the browser (no Worker in between). Aggregates only: no player data.
-- Run once: turso db shell <db> < schema.sql   (idempotent)
--
-- The browser token may only INSERT into `submit` (and read); it cannot touch the aggregate tables. The trigger below validates the
-- row and maintains day / bin / best, so the token holder cannot write anything that server/cloudflare/worker.js would reject.
-- Mirrors src/core/hist.js (NB = 80, TOP_K = 10, MIN_MS = 500, MAX_MS = 3600000, REPLAY_DAYS = 14) and the Worker: the day is a real date, at most REPLAY_DAYS + 1 = 15 UTC days back and 1 ahead.
CREATE TABLE IF NOT EXISTS day  (day INTEGER PRIMARY KEY, n INTEGER NOT NULL, sum_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bin  (day INTEGER NOT NULL, bin INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, bin)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS best (day INTEGER NOT NULL, ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS best_day_ms ON best (day, ms);
-- Synthetic seed players of a day (JSON array of ms, already counted in day / bin / best). The row is also the "already seeded" gate.
CREATE TABLE IF NOT EXISTS seed (day INTEGER PRIMARY KEY, ms TEXT NOT NULL);

-- Histogram bins as integer ms ranges [lo, hi), generated with binOf() of src/core/hist.js (the trigger has no log()).
CREATE TABLE IF NOT EXISTS bin_edge (bin INTEGER PRIMARY KEY, lo INTEGER NOT NULL, hi INTEGER NOT NULL);
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

-- One row per solve. `uid` (random, made by the client) makes a retry idempotent: INSERT OR IGNORE skips a known uid and the trigger does not fire.
-- Rows older than 2 days can be deleted at any time: the aggregates do not depend on them.
CREATE TABLE IF NOT EXISTS submit (uid TEXT PRIMARY KEY, day INTEGER NOT NULL, ms INTEGER NOT NULL) WITHOUT ROWID;

DROP TRIGGER IF EXISTS submit_ai; -- so that re-running this file also updates the rules
CREATE TRIGGER submit_ai AFTER INSERT ON submit
BEGIN
  SELECT RAISE(ABORT, 'invalid')
  FROM (SELECT date(substr(NEW.day, 1, 4) || '-' || substr(NEW.day, 5, 2) || '-' || substr(NEW.day, 7, 2)) AS d)
  WHERE typeof(NEW.uid) <> 'text'
     OR length(NEW.uid) NOT BETWEEN 8 AND 64
     OR typeof(NEW.day) <> 'integer'
     OR typeof(NEW.ms) <> 'integer'
     OR NEW.ms NOT BETWEEN 500 AND 3600000
     OR d IS NULL
     OR strftime('%Y%m%d', d) <> printf('%08d', NEW.day)
     OR julianday(date('now')) - julianday(d) NOT BETWEEN -1 AND 15;

  INSERT INTO day (day, n, sum_ms) VALUES (NEW.day, 1, NEW.ms)
    ON CONFLICT (day) DO UPDATE SET n = n + 1, sum_ms = sum_ms + NEW.ms;

  INSERT INTO bin (day, bin, n)
    SELECT NEW.day, bin, 1 FROM bin_edge WHERE NEW.ms >= lo AND NEW.ms < hi
    ON CONFLICT (day, bin) DO UPDATE SET n = n + 1;

  INSERT INTO best (day, ms)
    SELECT NEW.day, NEW.ms
    WHERE (SELECT COUNT(*) FROM best WHERE day = NEW.day) < 10
       OR NEW.ms < (SELECT MAX(ms) FROM best WHERE day = NEW.day);

  DELETE FROM best
    WHERE day = NEW.day
      AND rowid NOT IN (SELECT rowid FROM best WHERE day = NEW.day ORDER BY ms LIMIT 10);
END;
