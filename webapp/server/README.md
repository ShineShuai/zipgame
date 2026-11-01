# Game-of-Day averages backends

Stores per-day aggregates only (day totals, ~80 histogram bins, the 10 fastest times); no player data. (The anonymous behaviour rows for the grading analysis are a separate table: see "Behaviour rows" at the end.) Deploy any number of backends, then fill `src/config.js`:
`backends` = id -> `{ type, url, key? }` (type `cloudflare` or `supabase`; the same type may appear several times, e.g. a second Supabase project in another region),
`always` = the id written on every solve, `order` = the backups in failover order, `replicatedFrom` = see "Writes" below.
`?lb=<id>` in the page URL moves that backup to the front of `order` for one load.

## Writes
Every solve goes to `always` (if set and configured) AND, in parallel, to the first backend of `order` that answers; further backups are only tried when the ones before them fail (timeout 3 s, network error, non-2xx except 400/422, malformed reply). The summary shown to the player comes from `always`, else from the backup that answered; the submit never waits for more than that. With `always` unset (or not configured) only the backup chain writes, as before.
Why two copies: the first backup then holds (nearly) every solve, so a player who cannot reach `always` still sees the averages of everyone, not just of the players who failed over to the same backend.
Delivery is tracked per solve in the attempt record (`done` = backends that hold it): a retry (next page load, `replay.unsent()`) writes only what is missing, and a later answer of `always` replaces a backup's summary. A backend that never answers (blocked for that player) is retried at most `MAX_ROUNDS` = 3 times, and only after the solve is stored somewhere. The databases can still differ: a solve of a player who cannot reach `always` is not in it, and a failed backup write leaves that backup one short.
`replicatedFrom` (YYYYMMDD) = the first UTC day on which every solve is written twice; `replicatedTo` (optional) = the last such day. Set `replicatedFrom` to the first day after this config went live; it stays valid when `always` changes later (new Turso, say, with the same two writes), because the old backends keep their days. Add `replicatedTo` when the two writes stop (`always: null`, or no backup left): the days after it are then added up again. On a replicated day the backends hold copies of the same players, on every other day (one write each, failover) different ones. With `always: null` from the start leave both out: `replicatedFrom` is not tied to `always`, it says which days were stored twice, so a leftover value makes the stats page show only the fullest backend of every single-write day.
A 400/422 answer (invalid input, e.g. a day outside the window) is never retried and never fails over; the backend counts as done.

## Seed players (cold start)
`tools/gotd-seed.mjs` (nightly, `.github/workflows/gotd-seed.yml`) adds 3..8 synthetic players to a day on every configured backend (`--only ID` for one); they count in `n`, `sum`, `bins` and `best` like real players, and are listed in `seeds: [ms]` of both read APIs so the stats page and the calibration can subtract them. A day is seeded once per backend: a retry answers `exists` (Worker: HTTP 409) and changes nothing. A seeding cannot be undone, so look at a dry run first (workflow input `dry_run`, or `npm run gotd:seed`).
One-time setup, one shared secret `SEED_PLAYERS_SECRET` for GitHub, the Worker and Supabase. Keep it in a file outside the repo and never type it on a command line or in an environment variable; every consumer below reads the file (surrounding whitespace is ignored, so a trailing newline does no harm):
```
umask 077; openssl rand -hex 24 > ~/.zip-seed-secret
```
1. GitHub: `gh secret set SEED_PLAYERS_SECRET < ~/.zip-seed-secret` (or paste the value in Settings > Secrets and variables > Actions). The workflow writes it to a temporary file for the script.
2. Cloudflare: `npx wrangler d1 execute zip-gotd --remote --file=schema.sql` (adds the `seed` table), `npx wrangler secret put SEED_PLAYERS_SECRET < ~/.zip-seed-secret`, `npx wrangler deploy`. `wrangler secret put NAME` takes the value from stdin: it prompts (hidden input) in a terminal and reads the redirected file otherwise; the secret is never an argument. A Worker without the table still answers `/stats` (with `seeds: []`).
3. Supabase keeps only the SHA-256 of the secret, so that the database never holds the secret itself. Re-run `supabase/schema.sql`, then `node tools/gotd-seed.mjs --token-file ~/.zip-seed-secret --print-supabase-sql` and paste the one statement it prints (`insert into gotd_secret ... on conflict ...`) into the SQL editor of every Supabase project. It contains the hash, not the secret.
Tests: `npm run test:server` (seeding on the real worker code) and `server/supabase/test.py` (`seed_gotd`).

## Stats page (`stats.html`)
Reads every configured backend in parallel (no failover). The default source "combined" gives one list of days: on a replicated day (`replicatedFrom`..`replicatedTo`) the backends hold copies of the same players, so the copy with the most players of that day is used (a tie goes to the backend listed first: `always`, then the backups); on every other day they hold different players, so n, sum and bins add up and best-10 = the ten fastest of the union. The bars are coloured by the backend a day was taken from; "days <always> lacks players" counts replicated days on which `always` holds fewer players than the fullest copy (from the first day `always` has data: a backend added later has no earlier days). Any single backend can be chosen as the source too.
Every backend type exposes the same public, read-only aggregate API (<= 90 days per request):
- Supabase: `rpc/read_gotd` (`{ p_from, p_to }`). Re-run `supabase/schema.sql`; it is idempotent.
- Cloudflare: `GET /stats?from=YYYYMMDD&to=YYYYMMDD` (cached 120 s). Redeploy with `npx wrangler deploy`.
- Turso: one SQL statement (`TURSO_SQL.read` in `src/platform/leaderboard.js`) over the database's HTTP API; it needs no deploy, re-run `turso/schema.sql` when the schema changes.
The "Seed players" checkbox switches the seed players (listed in `seeds`) on and off in every chart: on = as stored, seeds drawn as hollow dots / grey bars; off = n, sum, bins and best of the real players only. Hover any point, bar or day column for its values. In days added up from several backends (not replicated days) each seed counts once per backend, because all backends hold them.
Reply: `{ days: [{ d, n, sum, bins: [[bin, n]], best: [ms] }] }`. Submitted times include +180 s per hint used. Serve the page over http (`python3 -m http.server`) or github.io; the difficulty scatter fetches `../demo/GameOfDay/YYYYMMDD.txt`.

## Turso (third type, `type: 'turso'`)
The browser calls the database's HTTP API directly (Hrana over HTTP, `POST <url>/v2/pipeline`; no Worker, because Cloudflare is blocked in China). `turso/schema.sql` is **validation only**: `submit` holds one row per solve `(uid, day, ms, bin)`, a trigger only checks the row (same rules as the Worker: real day, 15 days back / 1 ahead, 500 ms..1 h, `bin` = binOf(ms), uid 8..64 characters) and raises `invalid`, and the view `solve` (`submit` + the `seed` players) is what every aggregate is computed from, at read time. Why not a trigger that maintains `day` / `bin` / `best`: libSQL checks the statements a trigger runs against the token's table permissions, so the public token would need write rights on those tables (a test showed `SQLITE_AUTH` on the insert otherwise). So the public token stays `-p all:data_read -p submit:data_add`.
- **Database type:** create it without `--tursodb`. The experimental Turso Database engine did not enforce token permissions (a full-access token and one with a `-p` list could both `DROP TABLE`), and its fine-grained token creation failed with an internal server error. `smoke.sh` attacks only a token whose signed permission list is exactly the browser token's (anything else is reported and left alone), tries writes from harmless to destructive, and stops at the first one that is not denied.
- **Tokens:** browser (goes into `config.js`): `turso db tokens create <db> -e never -p all:data_read -p submit:data_add`; seeder (a secret): `... -p all:data_read -p seed:data_add`, passed as `node tools/gotd-seed.mjs --turso-token-file FILE` (the Cloudflare / Supabase secret stays `--token-file`).
- **Tests:** `node server/turso/schema.test.mjs` (part of `npm run test:server`) runs `schema.sql` on SQLite through the real client adapter and compares replies and stats with `worker.js` (600 solves, seeds, the day window, invalid rows, retries, index use, and that the trigger writes nothing). `turso/smoke.sh HTTP_URL TOKEN_FILE` checks a real database with the browser token: CORS, the page's own submit and stats requests, rejected input, denied writes, latency. It adds one 42 s solve to today; remove it with `turso db shell <db> "DELETE FROM submit WHERE uid LIKE 'smoke-%'"` (your own full-access login can).
- **Data:** `submit` is the only copy of the data: never delete from it. Reads are answered from the covering index `submit_day`, and one submit or stats read touches about as many index rows as the day has solves (fine for thousands per day; beyond that, add a cron that folds finished days into a summary table).
- **Retries:** the adapter makes a random uid per request, so a retry after a timeout that actually stored the solve counts it twice on that backend (the same accepted risk as the other types).

### Switching `always` from `supabase-asia` to `turso-asia`
Nothing changes for players until the last step; every step can be undone by reverting the config line.
1. **Code** (this build): `type: 'turso'` adapter, `turso-asia` entry in `config.js` (disabled while its `key` is empty), `--turso-token-file` in the seeder. `npm test && npm run test:server`.
2. **Database:** `turso db create zipgame --group china`, `turso db shell zipgame < server/turso/schema.sql`, create the two tokens above, `server/turso/smoke.sh "$(turso db show zipgame --http-url)" <browser token file>` (from the network that matters, e.g. China, for the latency line).
3. **Seeder first:** add the repository secret `TURSO_SEED_TOKEN` (the seeder token); `.github/workflows/gotd-seed.yml` passes it as `--turso-token-file` when it is set. Do this before step 4: once a Turso entry is enabled, the seeder dies without that flag, and it would stop seeding the other backends too. Check with `node tools/gotd-seed.mjs --dry-run`, then a real run with `--only turso-asia`.
4. **Shadow:** put the browser token in `config.js` as `key`. `turso-asia` is now a read-only backend: the stats page lists it with its latency and the seeder seeds it, but it receives no player solves.
5. **Canary (optional):** `order: ['cloudflare', 'supabase', 'turso-asia']`. Nothing changes, except that `?lb=turso-asia` moves it to the front of the backups for that page load: test solves go to `always` and to Turso. Compare `turso-asia` with `supabase-asia` on the stats page.
6. **Switch:** `always: 'turso-asia'`, `order: ['cloudflare', 'supabase']`; keep `replicatedFrom` as it is and do not add `replicatedTo` (two writes keep running). `supabase-asia` stays in `backends`, so its days are still read and added up; put it in `order` too if it should stay a backup. Cached old pages keep writing to `supabase-asia`, which only adds copies; unsent solves finish on the new backend because a retry writes to every backend not in the record's `done` list.
7. **Check:** the stats page shows no "always-written backend lags" note for new days, and `turso db shell <db> "SELECT day, COUNT(*) FROM submit GROUP BY day"` matches the stats page.
8. **Rollback:** `always: 'supabase-asia'` again. Turso keeps its rows and stays readable.

### Changing the histogram bins
Only `NB` (number of bins), `T0_MS` (the first boundary) and `RATIO` (bin width) of `src/core/hist.js` define the bins. A bin number is stored with every count, so a change reaches every backend. Steps, in this order:
1. **Code:** edit the constants; update the numbers that `test/tests.js` > `hist: binOf edges and clamping` pins (the only test that fails because of the new bins themselves).
2. **Turso schema:** `node tools/print-bin-edge.mjs --write` rewrites the block between the `-- bin_edge:begin` / `-- bin_edge:end` lines of `turso/schema.sql` (`--check` reports it stale; `npm run test:server` fails while it is). The block is `INSERT OR REPLACE` plus `DELETE ... WHERE bin >= NB`, so re-running the file replaces changed boundaries and removes bins that no longer exist, and `bin_edge` is never empty in between.
3. **Supabase schema:** set the two `>= 80` of `supabase/schema.sql` (`submit_gotd`, `seed_gotd`) to the new `NB`; `worker.test.mjs` fails otherwise. The Worker reads `NB` from `hist.js`.
4. **Deploy, close together:** the page; `turso db shell <db> < server/turso/schema.sql`; `supabase/schema.sql` in the SQL editor; `npx wrangler deploy`. Until a visitor's page reloads it sends the old bin numbers: Turso rejects them (the trigger checks `bin` against `bin_edge`; the page counts a rejection as final, so that solve is missing in Turso), Cloudflare and Supabase accept them with the wrong bin (they only check 0..NB-1). Replays of days inside the replay window (REPLAY_DAYS) mix old and new the same way.
5. **Turso history:** `turso db shell <db> "UPDATE submit SET bin = (SELECT bin FROM bin_edge WHERE submit.ms >= lo AND submit.ms < hi)"` with your own login (the browser token has no update right). Seed players need nothing: the view `solve` bins them when it is read.
6. **Cloudflare / Supabase history cannot be fixed:** they keep only counts per bin, not the times, so days stored before the change are read with the new boundaries. Their `n`, mean and fastest times stay exact; the quantiles (p10 / p50 / p90) and "You beat X%" of those days are off. Either accept it, or ignore the days before the change on the stats page.
Checked on a copy with `NB = 160`, `RATIO = 1.05`: after steps 1-3 the test suites pass, and step 5 gave every stored row `binOf(ms)` of the new bins.

### Which `always` / `order` combinations work
All of them (pinned by the `config combinations` tests in `test/tests.js`). A solve goes to `always` and, in parallel, to the first backup of `order` that answers (the next one only when it fails). `always` listed in `order` is ignored there; a backend in neither is read-only (stats page, seeder). Examples with `always: 'turso-asia'`: `order: ['supabase-asia', 'cloudflare', 'supabase']` = two writes per solve (Turso + Supabase Asia), Cloudflare / Supabase only when Supabase Asia fails; `order: []` = Turso alone (no backup, no failover). If `always` fails the solve is kept by a backup and retried (at most `MAX_ROUNDS` = 3 page loads), after that the stats page shows that Turso lags on that day. Two traps: an `always` entry without its `url` / `key` counts as not set, **silently** (writes then go to the backups only, while `replicatedFrom` still says two writes); and `replicatedFrom` / `replicatedTo` must describe what really ran.

## Behaviour rows (anonymous play data for the difficulty grading)
For each solved game the page may upload one row: the puzzle (local games; a Game of Day is identified by its day), the raw time, how many cells the player drew and took back (total and deepest), the player's speed bucket and the kind of game. **No identifier**, no per-player link between rows; like any request, the host (Turso, Cloudflare) sees the IP address. Never sent: a game with a hint, a game with more than `hiddenMaxMs` in a hidden tab, an abandoned game, a variant (Cutout), a local game outside `localSizes` (7 to 11), a local game opened from a share link, a Game of Day this device already solved. The code is `src/core/behaviour.js` (rules and format, shared by page, Worker, tools and tests) and `src/platform/behaviour.js` (queue and sending). Only Turso and Cloudflare receive rows, never Supabase: each row goes to `BEHAVIOUR.primary`, and to `BEHAVIOUR.backup` only when the primary does not answer.

**Switches**, from the page to the server: `BEHAVIOUR.enabled` in `src/config.js` (`false` = nothing is queued or sent, the toggle is hidden, a queue left on a device is thrown away; takes effect when the page is deployed); the player's toggle (hold V in the menu: "Anonymous play stats", `BEHAVIOUR.defaultOn` is its starting value); on the server `UPDATE play_cfg SET cap = 0` stops every page at once (Turso: `turso db shell <db> "UPDATE play_cfg SET cap = 0"`; D1: `npx wrangler d1 execute zip-gotd --remote --command "UPDATE play_cfg SET cap = 0"`); revoking the Turso token (`turso db tokens invalidate <db>` revokes all of them) or removing the Worker route also works.

**Setting it up** (servers first, the page after; the old page keeps working all the time):
1. Turso: `turso db shell <db> < server/turso/schema.sql` (idempotent: adds `play`, `play_cfg` and the trigger `play_ai`). A new browser token, which replaces `key` in `config.js`: `turso db tokens create <db> -e never -p all:data_read -p submit:data_add -p play:data_add` (`test/check-config.js` accepts this list and the old one). Until the token is replaced, Turso refuses the rows (`not authorized`), the page tries the backup, and a row nobody takes is dropped after 3 page loads.
2. Cloudflare: `npx wrangler d1 execute zip-gotd --remote --file=server/cloudflare/schema.sql` (idempotent), `npx wrangler secret put PLAY_ADMIN_SECRET < FILE` (a new random secret, not the seeder's), `npx wrangler deploy`.
3. Pruning token, when you need it (not in `config.js`; short-lived): `turso db tokens create <db> -e 7d -p all:data_read -p play:data_delete`.
4. Deploy the page. Check: `node tools/behaviour.mjs export --out rows.json --turso-token-file T --token-file S` after a few games.

**Size and quotas.** One row is about 20 bytes (Game of Day) or 45 bytes (local game, with its packed puzzle), measured on SQLite with no index; D1 and Turso count tables and indexes, so there is deliberately no index and no per-row id column (`rowid` is free). 600 rows a day are about 10 MB a year; the free plans are D1 5 GB (100,000 rows written a day) and Turso 5 GB (10 million rows written a month, **shared with the Game-of-Day submits**). The ceiling `play_cfg.cap` (default 3,000,000, tested against the highest row id, which is O(1)) bounds what a public token can write: about 135 MB and a fraction of one month's quota. The id of a deleted row is not reused below the highest one, so deleting some rows does not make room; export everything, then `DELETE FROM play` (ids restart at 1) or raise the cap.

**Reading and deleting** (`tools/behaviour.mjs`, the options are in its header):
- `export --out rows.json`: every row of both backends in one file, with the puzzle as plain text (`key`) so that the other tools can use it; `--gotd-dir demo/GameOfDay` adds the Game-of-Day puzzles. The same game stored twice (a retry after a timeout) is listed once.
- `delete --ids turso:12,cloudflare:3` | `--puzzle FILE` | `--gotd YYYYMMDD` | `--day YYYYMMDD`: removes the rows of a puzzle, of a Game of Day or of a day that the analysis found unuseful. Without `--yes` it only lists them. The page's token cannot delete (it has no `data_delete`); the Worker deletes only with `PLAY_ADMIN_SECRET`, and only by row id.
- Plain SQL works too: `turso db shell <db> "DELETE FROM play WHERE day = 20700"`.

**Changing what a row holds.** The columns are defined once, in `COLUMNS` of `src/core/behaviour.js`; `server/turso/schema.test.mjs` fails if either `schema.sql` disagrees with it.
- *More information*: fill `ev` (a blob, up to 64 bytes, null today) with its own format version in the first byte: no server change at all. Or add a column: (1) append it to `COLUMNS` (nullable, or `NOT NULL DEFAULT x`), (2) add it to both `schema.sql` files (and to the trigger's checks in the Turso one), (3) `node tools/behaviour.mjs migrate` (Turso is altered; for D1 it prints the `wrangler d1 execute` commands to run), (4) deploy the Worker, then the page. A page that sends a column an older server does not know is refused (`invalid`), so the servers come first; a page that sends fewer columns than the table has still works.
- *Less information*: stop sending it (the column reads null); delete the column later with `ALTER TABLE play DROP COLUMN` if it is not named in a trigger.
- *Changing what a column means* (the units of `ms`, the layout of `pz` or `s`): bump `ROW_VERSION` (`v`, 4 bits) in the same change. Rows keep their `v`, so the tools keep every old decoder and tell the generations apart.
- A table that was altered has the new column last; the code always names its columns, so the order does not matter.


## Device sync (the cloud copies of a player's devices)

Players who turn it on can keep their data the same on all their devices (`src/platform/sync`). Devices that are open together
meet directly (WebRTC); devices that are not use the servers below. What the servers hold is **ciphertext**: per device one slice
(statistics, records, streak, chances) sealed in the browser with a key made from the player's sync phrase (8 words), a random-looking
group id, a counter and a time. Unlike everything above this is player data: nobody can read it without the phrase, but a server sees
that a group exists, when it changes, how many devices write to it and their IP addresses (the card says so to the player). The feature is
off for everybody until a player turns it on.

**It is a scheme of its own, apart from the Game-of-Day averages and the behaviour rows above, which are unchanged (Turso first):**
`SYNC.cloud` in `src/config.js` has its own `backends` (urls and public keys), its own SQL files (`server/supabase/sync.sql`,
`server/turso/sync.sql`, which need nothing from `schema.sql`) and its own Turso token. It can live in the same Supabase project / Turso
database as the averages or in new ones; separate ones keep player data away from the aggregates (a Turso database of its own does not
separate the rows-written quota: on the free plan, as far as I know, it counts all databases of the account). **Supabase is primary here,
Turso second**: Supabase checks who writes, Turso cannot. A push goes to both, a pull asks both and merges what opens, so either may be
down, full or without permission. Every origin used in `SYNC.cloud.backends` must also be in `connect-src` of `index.html` (`npm run check`).

### Supabase (primary)

1. Run `server/supabase/sync.sql` in the SQL editor of the project named by `SYNC.cloud.backends['sync-supabase']` (idempotent; it needs
   no other file). It makes `sync_owner`, `sync_slice`, `sync_cfg`, `sync_secret` (RLS on, no policies: the anon key can only call the
   functions) and `sync_put`, `sync_get`, `sync_delete`, `sync_prune`. The group is claimed by its first write (the hash of an auth
   value derived from the phrase is stored); later writes and the delete must show the same value; reading needs only the id. At most 8
   devices per group, 16 KB per slice, one write per device per 5 seconds, 100,000 groups
   (`update sync_cfg set n = 0 where name = 'max_groups'` stops new groups).
2. Pruning (groups that wrote nothing for 180 days): insert the hash of a token of your choice once, then call `sync_prune` nightly:
   ```sql
   insert into sync_secret (name, hash) values ('prune', encode(sha256(convert_to('<token>', 'UTF8')), 'hex'));
   ```
   either with `tools/sync-prune.mjs` (below) or inside Supabase with pg_cron (Database > Extensions):
   `select cron.schedule('sync-prune', '17 3 * * *', $$delete from sync_owner where touched < now() - interval '180 days'$$);`
3. Check it on a scratch Postgres: `PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 server/supabase/sync_test.py` (not run when it was
   written: no Postgres was at hand). The page's tests run against a model of these functions (`test/sync/helpers.js`).
4. On the free plan the project pauses after a week without requests. In a project of its own the sync has no nightly seeder to keep it
   awake: the pruning call below does (it is a request every night).

### Turso (second)

1. `turso db shell <db> < server/turso/sync.sql` adds the `sync` table, `sync_cfg` and the trigger `sync_ai` (idempotent; own file, so
   `schema.sql` is not touched). Use the database of the averages or a new one.
2. The browser token of the sync is its own and may only read and insert into `sync`:
   `turso db tokens create <db> -e never -p all:data_read -p sync:data_add` — put it and the database url into
   `SYNC.cloud.backends['sync-turso']` (`npm run check` accepts nothing else). Until both are set the entry is not used and only Supabase
   keeps copies. The token of the averages (`LEADERBOARD`) is not changed.
3. The token cannot update or delete, so a device adds a row with `seq` = its highest + 1 and readers take the newest row that opens.
   Rows pile up: `tools/sync-prune.mjs` keeps the newest 3 per device and drops groups idle for 180 days. It needs a short-lived token that
   may delete: `turso db tokens create <db> -e 7d -p all:data_read -p sync:data_delete`.
4. **What this table cannot do:** SQLite has no hash function, and a secret a trigger could read the public token could read too, so
   nobody checks WHO writes. Anyone with the public token can add junk rows to any group id they can list. The page skips what does not open
   and the trigger bounds the damage (shape, 24 KB, a `seq` that jumps by at most 1000, 30 rows per device between prunes, the ceiling
   `sync_cfg.cap`: `UPDATE sync_cfg SET cap = 0` stops every page at once). Junk can fill a device's 30 rows until the next prune (the page
   then retries) or use up rows-written quota; it cannot make data unreadable or change it. This is why Supabase, which does check the
   writer, is primary. The player's data survives either way: every device keeps its own copy.
5. A player cannot delete their rows with this token: "Delete cloud copy" removes the Supabase group at once; the Turso rows become
   unreadable (the phrase is forgotten) and are removed by the prune. Check it: `node server/turso/sync.test.mjs`.

### Nightly pruning (`tools/sync-prune.mjs`)

Add to the workflow that runs `tools/gotd-seed.mjs` (secrets in the repository settings; the Supabase ones are those of the sync project):

```yaml
      - name: Prune the device sync
        run: node webapp/tools/sync-prune.mjs
        env:
          TURSO_URL: ${{ secrets.SYNC_TURSO_URL }}
          TURSO_PRUNE_TOKEN: ${{ secrets.SYNC_TURSO_PRUNE_TOKEN }}
          SUPABASE_URL: ${{ secrets.SYNC_SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SYNC_SUPABASE_KEY }}       # the anon key
          SYNC_PRUNE_TOKEN: ${{ secrets.SYNC_PRUNE_TOKEN }}
```

It cannot tell junk from real rows (it has no key), so it prunes by age and count only; a player whose devices are all gone for six months
loses the cloud copy, never anything on a device.
