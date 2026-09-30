# Game-of-Day averages backends

Stores per-day aggregates only (day totals, ~80 histogram bins, the 10 fastest times); no player data. Deploy one or both, then fill `src/config.js`
(`order` = failover order, first entry is tried first; `?lb=supabase` in the page URL moves that backend first for one load).

## Cloudflare (Worker + D1)
    cd server/cloudflare
    npx wrangler d1 create zip-gotd                       # put database_id into wrangler.toml
    npx wrangler d1 execute zip-gotd --remote --file=schema.sql
    # set ALLOWED_ORIGIN in wrangler.toml to https://<user>.github.io
    npx wrangler deploy                                   # -> config.js cloudflare.url
Test: `npm run test:server` (real worker code on SQLite, Node >= 22.5).

## Supabase
Run `supabase/schema.sql` in the SQL editor; put the project URL and the anon/publishable key into `config.js`.
Test: `PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 server/supabase/test.py` on a scratch Postgres (psql required).

Failover happens on timeout (3 s), network error, non-2xx except 400/422, or a malformed reply. After a failover the two databases hold different subsets of players.
