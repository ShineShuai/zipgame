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
already live, or live is ahead of it; a change in it was reverted on `main` since, or a newer
commit carries a `Fixes: <sha>` line for it (the revert or the fix ships with it, after its own
soak); live is a hotfix that is merged into `main` but not in that commit yet. It fails
(red run, e-mail) when live is not in `main`'s history at all (a hotfix not merged yet), when the
puzzles of `main` do not pass `check-puzzles.mjs` with that code, or when build.json cannot be read.
It does not care how many puzzles are ahead: that is the business of `gotd.yml`. On that commit it
first runs `npm run release:gate` (`check`, `test:all`, `test:themes`: every tier, so also a hotfix
or a rollback is tested). The gate belongs to the commit, so renaming its scripts never breaks a
deploy; a commit from before the entry gets `check`, `test:all` (else `npm test`) and `test:themes`,
as far as it has them. After the deploy it runs the smoke test; if that fails, the
previous code is deployed again (with the puzzles of `main`) and the run stays red.

Repository variables (Settings -> Secrets and variables -> Actions -> Variables):
`SOAK_DAYS` (7), `PROD_FREEZE` (`true` stops
everything), `DRY_RUN` (anything but `false` = check and stage only), `GOTD_DRY_RUN` (the same for
`gotd.yml`), `GOTD_AHEAD` (unset, see below), `MIN_PUZZLE_DAYS` (10), `CLOUDFLARE_ACCOUNT_ID`. GitHub stops scheduled runs after 60
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

### Puzzle window (`GOTD_AHEAD`, optional)
The whole queue of puzzles ships by default, up to 17 days ahead, so a player who reads the site
can solve tomorrow's puzzle today (and play it live for the champion rewards). With the repository
variable `GOTD_AHEAD` = K only the puzzles of today and of the next K days (UTC) ship
(`stage-prod.sh`, so `prod.yml` and `gotd.yml` both cut). The window moves on with each deploy:
`gotd.yml` then also releases when the puzzles of `main` are already live but the live build is
from an earlier UTC day, which makes its daily run (21:37 UTC) a daily release. The smoke test
checks that the puzzle after the window is neither staged nor served. K=1 is the least (the next
day's puzzle must exist at midnight); K=2 survives one failed daily release. If deploys stop
(expired token, `PROD_FREEZE`), the site runs out of puzzles after K days: the red runs are the
alarm. Unset = off, nothing changes. Delete the variable to roll back; the next release ships the
whole queue again. `MIN_PUZZLE_DAYS` still counts the puzzles of `main`, not the ones that ship.

## Manual
Actions -> Production deploy -> Run workflow (`ref`, `reason`). The `ref` must be on `main` or on
a `hotfix/*` branch. `dry_run` checks and stages only. Every deploy moves the tag `prod` and adds
`deploy/<UTC time>`; `git log prod..main` is what is not live yet.

Rollback: run it again with `ref` = the previous `deploy/...` tag.
Hotfix (the bug is live): branch `hotfix/x` from `prod`, fix, CI, run with `ref=hotfix/x` (choose
`main` under "Use workflow from": the `production` environment only accepts runs from `main`), then
merge it into main with `git merge --no-ff` (the automatic run refuses to go on while live is not in
main's history, and waits while the merge is still soaking).
Fix of a bug that is not live yet: commit the fix to `main` with a line `Fixes: <sha of the bug
commit>` (a revert is held the same way). The promote holds until the fix has soaked, so the bug
never ships alone; without the line, set `PROD_FREEZE` until then.

## One-time setup (not in git)
The GitHub environment `production` (deployment branch `main`, no required reviewers) with the
secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Account Settings: Read, this account only),
and the service binding `GAME_ZIGZAG` -> `zigzag-site` in the portal repo (the custom domain
`play.vintoshine.com` is on `play-portal`, not on this Worker). Renew the token before it expires
(the run fails with an authentication error).
