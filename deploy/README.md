# Production (Cloudflare)

The play app is served at https://play.vintoshine.com/zigzag/ by the Worker `zigzag-site`
(static assets only, `deploy/cloudflare/wrangler.toml`). The host itself belongs to the portal
Worker `play-portal` (repo `play`): it serves the page at `/` and reaches this Worker through a
service binding, so this Worker has no domain of its own. github.io stays the test site.
Both publish the same files from `.github/scripts/stage-site.sh`; production drops the
design and stats pages and the old demo pages (`.github/scripts/stage-prod.sh`).

Two workflows deploy to the same Worker, and they share one lock (`prod-deploy`): `prod.yml`
releases the code, `gotd.yml` the Game of Day puzzles. A deploy is always the whole site, so each of
them carries the other's part: `prod.yml` stages the soaked commit with the puzzles of `main` as they
are now, `gotd.yml` stages the code that is live (the sha in build.json) with the puzzles of `main`.
build.json records both: `sha` is the code, `puzzles` the git tree id of `demo/GameOfDay`.

## Automatic (`prod.yml`, every day 04:17 UTC)
Promotes the newest commit of `main` that has been there for `SOAK_DAYS`, every day. It skips when: `PROD_FREEZE` is true; that commit is
already live, or live is ahead of it; a change in it was reverted on `main` since. It fails
(red run, e-mail) when live is not in `main`'s history (a hotfix not merged yet), when the
puzzles of `main` do not pass `check-puzzles.mjs` with that code, or when build.json cannot be read.
It does not care how many puzzles are ahead: that is the business of `gotd.yml`. On that commit it
first runs `npm run check`, `npm run test:all` (every tier, so also a hotfix or a rollback is
tested) and `npm run test:themes`. After the deploy it runs the smoke test; if that fails, the
previous code is deployed again (with the puzzles of `main`) and the run stays red.

Repository variables (Settings -> Secrets and variables -> Actions -> Variables):
`SOAK_DAYS` (7), `PROD_FREEZE` (`true` stops
everything), `DRY_RUN` (anything but `false` = check and stage only), `GOTD_DRY_RUN` (the same for
`gotd.yml`), `MIN_PUZZLE_DAYS` (10), `CLOUDFLARE_ACCOUNT_ID`. GitHub stops scheduled runs after 60
days without repository activity.

## Game of Day puzzles (`gotd.yml`)
The puzzles of `main` (`demo/GameOfDay`) go live on their own, without the soak and the code
tests: a puzzle is data that is reviewed before it is committed. It runs after a push to `main`
that touches `demo/GameOfDay`, and every day at 21:37 UTC as a safety net. It skips when
`PROD_FREEZE` is true or when the puzzles of `main` are already live (build.json `puzzles`). It
deploys only with `GOTD_DRY_RUN=false`; otherwise it checks and stages, nothing more (until then
every code release still carries the puzzles of `main`). It fails (red run, e-mail) when live
cannot be read, when the live commit is not in the clone, or when a puzzle from today on is not
named `YYYYMMDD.txt` or is not accepted by `parse` and `validate` of the live code
(`.github/scripts/check-puzzles.mjs`): the live code has to be able to play what is published. The
smoke test then waits for the new `puzzles` id in build.json and compares the puzzles of today and
tomorrow with the staged files; if it fails, the previous puzzles are deployed again.

The daily run is also the alarm: it fails when fewer than `MIN_PUZZLE_DAYS` puzzles are ahead in a
row, counted from today (UTC), and a gap stops the count. A gap further ahead is a warning. The
alarm does not hold back the release. A push or a manual run only warns. The tags `prod` and
`deploy/...` belong to the code and are not moved. Manual: Actions -> Game of Day release -> Run
workflow (`reason`, `dry_run`, `smoke`); it releases the puzzles of `main` again even if they are
live. A wrong puzzle is fixed by a commit to `main`: the push releases the fix.

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
