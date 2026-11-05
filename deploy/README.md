# Production (Cloudflare)

The play app is served at https://play.vintoshine.com/zigzag/ by the Worker `zigzag-site`
(static assets only, `deploy/cloudflare/wrangler.toml`). The host itself belongs to the portal
Worker `play-portal` (repo `play`): it serves the page at `/` and reaches this Worker through a
service binding, so this Worker has no domain of its own. github.io stays the test site.
Both publish the same files from `.github/scripts/stage-site.sh`; production drops the
design and stats pages and the old demo pages (`.github/scripts/stage-prod.sh`).

## Automatic (`prod.yml`, every day 04:17 UTC)
Promotes the newest commit of `main` that has been there for `SOAK_DAYS`, on `RELEASE_DAYS`
(or after 8 days without a release). It skips when: `PROD_FREEZE` is true; that commit is
already live, or live is ahead of it; a change in it was reverted on `main` since. It fails
(red run, e-mail) when live is not in `main`'s history (a hotfix not merged yet), when too few
puzzles are ahead (`MIN_PUZZLE_DAYS`), or when build.json cannot be read. After the deploy it
runs the smoke test; if that fails, the previous version is deployed again and the run stays red.

Repository variables (Settings -> Secrets and variables -> Actions -> Variables):
`SOAK_DAYS` (7), `RELEASE_DAYS` (comma list, `Tue` or `Tue,Fri`; spaces and case are ignored), `PROD_FREEZE` (`true` stops
everything), `DRY_RUN` (anything but `false` = check and stage only), `MIN_PUZZLE_DAYS` (10),
`CLOUDFLARE_ACCOUNT_ID`. GitHub stops scheduled runs after 60 days without repository activity.

## Manual
Actions -> Production deploy -> Run workflow (`ref`, `reason`). The `ref` must be on `main` or on
a `hotfix/*` branch. `dry_run` checks and stages only. Every deploy moves the tag `prod` and adds
`deploy/<UTC time>`; `git log prod..main` is what is not live yet.

Rollback: run it again with `ref` = the previous `deploy/...` tag.
Hotfix: branch `hotfix/x` from `prod`, fix, CI, run with `ref=hotfix/x` (choose `main` under "Use
workflow from": the `production` environment only accepts runs from `main`), then merge it into main
with a merge commit (the automatic run refuses to go on while live is not in main's history).

## One-time setup (not in git)
The GitHub environment `production` (deployment branch `main`, no required reviewers) with the
secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Account Settings: Read, this account only),
and the service binding `GAME_ZIGZAG` -> `zigzag-site` in the portal repo (the custom domain
`play.vintoshine.com` is on `play-portal`, not on this Worker). Renew the token before it expires
(the run fails with an authentication error).
