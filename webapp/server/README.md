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

## Stats page (`stats.html`)
Reads every configured backend in parallel (no failover) and merges them: n, sum and bins add, best-10 = the ten fastest of the union.
Both backends expose the same public, read-only aggregate API (<= 90 days per request):
- Supabase: `rpc/read_gotd` (`{ p_from, p_to }`). Re-run `supabase/schema.sql`; it is idempotent.
- Cloudflare: `GET /stats?from=YYYYMMDD&to=YYYYMMDD` (cached 120 s). Redeploy with `npx wrangler deploy`.
Reply: `{ days: [{ d, n, sum, bins: [[bin, n]], best: [ms] }] }`. Submitted times include +180 s per hint used. Serve the page over http (`python3 -m http.server`) or github.io; the difficulty scatter fetches `../demo/GameOfDay/YYYYMMDD.txt`.
