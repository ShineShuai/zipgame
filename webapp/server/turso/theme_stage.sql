-- The theme stage on Turso: where a theme waits while its event runs (src/themes/source.js). Run once: turso db shell <db> < theme_stage.sql (idempotent).
-- The library of themes is not in any database or on any web server: it lives with the author (themes/). A theme is put here for the days of its event
-- (node themes/tools/stage.mjs publish ...) and deleted when the event ends (stage.mjs withdraw ...), so a player can only ever read what is on offer right now.
-- The browser's public token already reads every table (-p all:data_read) and has no write permission here: only you write, with your own login.
-- Withdrawing = deleting the row. `from_ms` / `until_ms` (UTC ms) say when the offer runs, for the page's countdown; they are not an access control (a
-- browser may read the table at any time), so end an event by deleting its row. A row is one bundle (src/themes/bundle.js): at most 200 KB of JSON.
CREATE TABLE IF NOT EXISTS theme_stage (
  event    TEXT PRIMARY KEY CHECK (length(event) BETWEEN 1 AND 40 AND event NOT GLOB '*[^a-z0-9-]*'),
  theme    TEXT NOT NULL CHECK (length(theme) BETWEEN 1 AND 24 AND theme NOT GLOB '*[^a-z0-9-]*'),
  v        INTEGER NOT NULL CHECK (v >= 1),
  from_ms  INTEGER NOT NULL,
  until_ms INTEGER NOT NULL CHECK (until_ms > from_ms),
  bundle   TEXT NOT NULL CHECK (json_valid(bundle) AND length(bundle) <= 204800)
);
-- the query of the client (STAGE_SQL in src/themes/source.js)
CREATE INDEX IF NOT EXISTS theme_stage_until ON theme_stage (until_ms);
