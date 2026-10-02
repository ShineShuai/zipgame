# Game-of-Day averages backends

Stores per-day aggregates only (day totals, ~80 histogram bins, the 10 fastest times); no player data. Deploy one or both, then fill `src/config.js`
(`order` = failover order, first entry is tried first; `?lb=supabase` in the page URL moves that backend first for one load).

## Cloudflare (Worker + D1)
    cd server/cloudflare
    npx wrangler d1 create zip-gotd                       # put database_id into wrangler.toml
    npx wrangler d1 execute zip-gotd --remote --file=schema.sql
    # set ALLOWED_ORIGIN in wrangler.toml to https://<user>.github.io
    npx wrangler deploy                                   # -> config.js cloudflare.url
Test (also covers `GET /stats`): `npm run test:server` (real worker code on SQLite, Node >= 22.5).

## Supabase
Run `supabase/schema.sql` in the SQL editor; put the project URL and the anon/publishable key into `config.js`.
Test (also covers `read_gotd`): `PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 server/supabase/test.py` on a scratch Postgres (psql required).

Failover happens on timeout (3 s), network error, non-2xx except 400/422, or a malformed reply. After a failover the two databases hold different subsets of players.

## Seed players (cold start)
`tools/gotd-seed.mjs` (nightly, `.github/workflows/gotd-seed.yml`) adds 3..8 synthetic players to a day on both backends; they count in `n`, `sum`, `bins` and `best` like real players, and are listed in `seeds: [ms]` of both read APIs so the stats page and the calibration can subtract them. A day is seeded once per backend: a retry answers `exists` (Worker: HTTP 409) and changes nothing. A seeding cannot be undone, so look at a dry run first (workflow input `dry_run`, or `npm run gotd:seed`).
One-time setup, one shared secret `SEED_PLAYERS_SECRET` for GitHub, the Worker and Supabase. Keep it in a file outside the repo and never type it on a command line or in an environment variable; every consumer below reads the file (surrounding whitespace is ignored, so a trailing newline does no harm):
```
umask 077; openssl rand -hex 24 > ~/.zip-seed-secret
```
1. GitHub: `gh secret set SEED_PLAYERS_SECRET < ~/.zip-seed-secret` (or paste the value in Settings > Secrets and variables > Actions). The workflow writes it to a temporary file for the script.
2. Cloudflare: `npx wrangler d1 execute zip-gotd --remote --file=schema.sql` (adds the `seed` table), `npx wrangler secret put SEED_PLAYERS_SECRET < ~/.zip-seed-secret`, `npx wrangler deploy`. `wrangler secret put NAME` takes the value from stdin: it prompts (hidden input) in a terminal and reads the redirected file otherwise; the secret is never an argument. A Worker without the table still answers `/stats` (with `seeds: []`).
3. Supabase keeps only the SHA-256 of the secret, so that the database never holds the secret itself. Re-run `supabase/schema.sql`, then `node tools/gotd-seed.mjs --token-file ~/.zip-seed-secret --print-supabase-sql` and paste the one statement it prints (`insert into gotd_secret ... on conflict ...`) into the SQL editor. It contains the hash, not the secret.
Tests: `npm run test:server` (seeding on the real worker code) and `server/supabase/test.py` (`seed_gotd`).

## Stats page (`stats.html`)
Reads every configured backend in parallel (no failover) and merges them: n, sum and bins add, best-10 = the ten fastest of the union.
Both backends expose the same public, read-only aggregate API (<= 90 days per request):
- Supabase: `rpc/read_gotd` (`{ p_from, p_to }`). Re-run `supabase/schema.sql`; it is idempotent.
- Cloudflare: `GET /stats?from=YYYYMMDD&to=YYYYMMDD` (cached 120 s). Redeploy with `npx wrangler deploy`.
Reply: `{ days: [{ d, n, sum, bins: [[bin, n]], best: [ms] }] }`. Submitted times include +180 s per hint used. Serve the page over http (`python3 -m http.server`) or github.io; the difficulty scatter fetches `../demo/GameOfDay/YYYYMMDD.txt`.
