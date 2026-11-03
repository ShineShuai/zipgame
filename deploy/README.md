# Production (Cloudflare)

The play app is served at https://play.vintoshine.com/zigzag/ by the Worker `zigzag-site`
(static assets only, `deploy/cloudflare/wrangler.toml`). github.io stays the test site.
Both publish the same files from `.github/scripts/stage-site.sh`; production drops the
design and stats pages and the old demo pages (see `prod.yml`).

Deploy: Actions -> Production deploy -> Run workflow (`ref`, `reason`). The `ref` must be on
`main` or on a `hotfix/*` branch. `dry_run` checks and stages only. Every deploy moves the tag
`prod` and adds `deploy/<UTC time>`; `git log prod..main` is what is not live yet.

Rollback: run it again with `ref` = the previous `deploy/...` tag.
Hotfix: branch `hotfix/x` from `prod`, fix, CI, run with `ref=hotfix/x`, then merge it into main.

One-time setup (not in git): the GitHub environment `production` with the secret
`CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Account Settings: Read, this account only),
the variable `CLOUDFLARE_ACCOUNT_ID`, and the custom domain `play.vintoshine.com` on the
Worker. Renew the token before it expires (the run fails with an authentication error).
