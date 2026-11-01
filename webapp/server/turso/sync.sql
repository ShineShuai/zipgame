-- Device sync on Turso (src/platform/sync/cloud, server/README.md "Device sync"). A scheme of its own: it does not touch the Game-of-Day or
-- behaviour tables of schema.sql and may live in a database of its own (SYNC.cloud.backends of src/config.js has its own url and token).
-- Run once: turso db shell <db> < sync.sql   (idempotent).
--
-- The encrypted slices of a player's devices, so that devices that are never open together can still meet. Ciphertext only (made on the device,
-- src/core/sync/cloud-keys.js): a group id (random-looking), the device, a counter, the UTC day and the sealed slice as base64url text.
-- Append-only: the browser token only INSERTs (its own token: turso db tokens create <db> -e never -p all:data_read -p sync:data_add); nobody can
-- update or delete with it, so a device writes a new row with seq = its highest + 1, and readers take the newest row that opens. tools/sync-prune.mjs
-- (the pruning token: -p all:data_read -p sync:data_delete) keeps the newest 3 rows per device and drops groups idle for 180 days.
-- A trigger cannot check WHO writes (SQLite has no hash function, and a secret it could read the public token could read too): anyone with the
-- public token can add rows to any group id they can list, and the page skips what does not open. The trigger bounds the damage: shape, size, a
-- seq that jumps by at most 1000, 30 rows per device between prunes, and a ceiling on the whole table (below).
CREATE TABLE IF NOT EXISTS sync (
  id   TEXT NOT NULL,
  dev  TEXT NOT NULL,
  seq  INTEGER NOT NULL,
  day  INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (id, dev, seq)
);

-- The ceiling and the off switch, changed by you with your own login (the browser token can only read it):
--   UPDATE sync_cfg SET cap = 0;        no row is accepted any more
--   UPDATE sync_cfg SET cap = 400000;   the default: rows are refused once the highest row id passes the cap
-- It bounds the storage and the rows-written quota (on the free plan, as far as I know, the quota counts all databases of the account, so a
-- separate database does not separate it from the Game-of-Day submits and the behaviour rows).
CREATE TABLE IF NOT EXISTS sync_cfg (id INTEGER PRIMARY KEY CHECK (id = 1), cap INTEGER NOT NULL);
INSERT OR IGNORE INTO sync_cfg (id, cap) VALUES (1, 400000);

-- 'closed' (ceiling reached) and 'full' (30 rows of this device since the last prune) are failures the page retries later; 'invalid' is final.
-- The statements only read and raise, as the other triggers do (libSQL checks them against the token's permissions: it has data_read).
DROP TRIGGER IF EXISTS sync_ai;
CREATE TRIGGER sync_ai AFTER INSERT ON sync
BEGIN
  SELECT RAISE(ABORT, 'closed')
  WHERE COALESCE((SELECT max(rowid) FROM sync) > (SELECT cap FROM sync_cfg WHERE id = 1), 1);
  SELECT RAISE(ABORT, 'invalid')
  WHERE typeof(NEW.id) <> 'text' OR length(NEW.id) <> 32 OR NEW.id GLOB '*[^0-9a-f]*'
     OR typeof(NEW.dev) <> 'text' OR length(NEW.dev) <> 11 OR NEW.dev GLOB '*[^A-Za-z0-9_-]*'
     OR typeof(NEW.seq) <> 'integer' OR NEW.seq < 1
     OR typeof(NEW.day) <> 'integer'
     OR NEW.day NOT BETWEEN CAST(strftime('%s', 'now') AS INTEGER) / 86400 - 1 AND CAST(strftime('%s', 'now') AS INTEGER) / 86400 + 1
     OR typeof(NEW.data) <> 'text' OR length(NEW.data) NOT BETWEEN 16 AND 24000 OR NEW.data GLOB '*[^A-Za-z0-9_-]*'
     OR NEW.seq > COALESCE((SELECT max(seq) FROM sync WHERE id = NEW.id AND dev = NEW.dev AND rowid <> NEW.rowid), 0) + 1000;
  SELECT RAISE(ABORT, 'full')
  WHERE (SELECT count(*) FROM sync WHERE id = NEW.id AND dev = NEW.dev) > 30;
END;
