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

## Visit counting (optional, `deploy/cloudflare/analytics.json`)
Cloudflare Web Analytics, a cookieless visit counter, installed by hand: `stage-prod.sh` runs
`add-beacon.mjs`, so only the two public pages (`/zigzag/` and `/zigzag/webapp/`) of a production
deploy carry it; the source pages, the GitHub Pages site and local runs never do. `token`:
- empty: off, nothing changes.
- the token of the snippet: the tag goes before `</body>`; the CSP meta of the app page gets the
  beacon script in `script-src` and `https://cloudflareinsights.com` in `connect-src`.

Get the token: dashboard -> Analytics & Logs -> Web Analytics -> the site `vintoshine.com` ->
"Enable with JS Snippet installation"; copy the value of `"token"` from the snippet. It is public
(it ships in every page), so it lives in git; the portal repo uses the same one. It takes effect
with the next deploy (Actions -> Production deploy -> Run workflow, `ref` main, applies it at once).
Keep the dashboard on "JS Snippet installation": with automatic injection on, a page would count
twice (the smoke test wants exactly one tag per page).

## Manual
Actions -> Production deploy -> Run workflow (`ref`, `reason`). The `ref` must be on `main` or on
a `hotfix/*` branch. `dry_run` checks and stages only. Every deploy moves the tag `prod` and adds
`deploy/<UTC time>`; `git log prod..main` is what is not live yet.

The `production` environment only accepts runs from `main`: always choose `main` under "Use
workflow from". Hotfixes, rollbacks and a fix for a bug that is still soaking: see the runbook.

## Hotfix runbook
X is the commit with the bug, F the fix. The commands use `gh` (logged in to this repository). In
the UI: Actions -> Production deploy -> Run workflow ("Use workflow from" = `main`), and
Settings -> Secrets and variables -> Actions -> Variables. Once per shell:

```bash
prod() { # REF REASON [true = dry run]: dispatch prod.yml, wait for its run
  local q=(--workflow=prod.yml --event=workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId') prev id
  prev=$(gh run list "${q[@]}")
  gh workflow run prod.yml --ref main -f ref="$1" -f reason="$2" -f dry_run="${3:-false}" || return
  while id=$(gh run list "${q[@]}"); [ "$id" = "$prev" ]; do sleep 3; done
  gh run watch "$id" --exit-status
}
```

### 0. Triage
```bash
git fetch --tags --force origin
curl -s https://play.vintoshine.com/zigzag/build.json   # live sha, the same as: git rev-parse prod
git log --oneline prod..origin/main                      # not live yet
git merge-base --is-ancestor <X> prod && echo live || echo "not live"
```
X not live: A. X live: B. A wrong puzzle: C. The workflow or a script is broken: D.

### Holding the promote
Two levers. `SOAK_DAYS` = 3650: no commit is old enough, so only the code promote stops
(`gotd.yml` goes on). `PROD_FREEZE` = true: `prod.yml` and `gotd.yml` both stop and no puzzles are
released meanwhile; use it only when that is wanted, and keep it short.
```bash
gh variable set SOAK_DAYS --body 3650    # hold the code promote
gh variable set SOAK_DAYS --body 7       # resume (your normal value)
gh variable set PROD_FREEZE --body true  # stop everything
gh variable delete PROD_FREEZE           # resume
```
What tonight's promote will do (full clone, Linux; not run on macOS). A held release prints
`Skipped: ...`:
```bash
EVENT=schedule SOAK_DAYS=7 GITHUB_OUTPUT=/dev/stdout bash .github/scripts/select-release.sh
```

### A. X is not live yet (goal: X never ships without F)
**A1. The fix is a new commit on `main`.**
```bash
git switch main && git pull --ff-only
# fix
git commit -am "fix(play): <what>

Fixes: <sha of X>"          # 7 to 40 hex digits; one line per bug commit
git push origin main
```
Run the check above: it must skip with "...reverted or is fixed on main since". X lands on day 0
and F on day k: the runs skip from day 7 and on day 7+k X, the commits between and F ship
together. The commits between are delayed by k days.

**A2. F landed without the `Fixes:` line.** A commit message cannot change on `main`: hold the
code promote until F has soaked.
```bash
git log -1 --format=%cI <F>             # F's date + SOAK_DAYS = the day to resume
gh variable set SOAK_DAYS --body 3650
gh variable set SOAK_DAYS --body 7      # on that day
```

**A3. X would be promoted tonight.** Hold first (`SOAK_DAYS` = 3650), then A1. When the `Fixes:`
commit is on `main`, resume (`SOAK_DAYS` = 7) and run the check: the hold now covers it.

**A4. Drop X instead.** `git revert <X>` (a merge: `-m 1`) writes "This reverts commit ...", which is
held the same way; `git push origin main`.

### B. X is live
**B1. Ship F alone on top of `prod` (preferred).**
```bash
git switch -c hotfix/menu prod                 # the name must match hotfix/*
# fix, minimal
git commit -am "fix(play): <what>"
git push -u origin hotfix/menu
(cd webapp && npm ci && npm run release:gate)  # the gate the deploy runs
prod hotfix/menu "menu overlap" true           # dry run: checks and stages
prod hotfix/menu "menu overlap"                # deploy and smoke test
curl -s https://play.vintoshine.com/zigzag/build.json   # sha = git rev-parse origin/hotfix/menu
git switch main && git pull --ff-only
git merge --no-ff origin/hotfix/menu -m "Merge hotfix/menu" && git push origin main
```
Merge the same day. In a PR choose "Create a merge commit": a squash or rebase merge makes a new
commit, live is then not in `main`'s history and the daily run fails; repair it with
`git merge --no-ff -s ours origin/hotfix/menu && git push origin main`. Until the merge commit is
`SOAK_DAYS` old the daily run skips ("live ... is a hotfix merged into main that ... does not
contain yet"): regular promotes pause meanwhile, then everything that soaked ships at once.

**B2. F is already on `main`, on top of newer commits.** On the branch use
`git cherry-pick -x <F>` instead of the fix and commit; the merge back is normally clean. A conflict
means F depends on the newer commits: write an independent fix (B1) or ship `main` (B3).

**B3. Ship all of `main` now, unsoaked commits included.**
```bash
git log --oneline prod..origin/main     # what ships
prod main "<why>"
```
No merge back is needed: live is then ahead of every candidate and the daily run skips.

**B4. Roll back (F is not ready).**
```bash
git tag -l 'deploy/*' --sort=-creatordate | head -3
gh variable set SOAK_DAYS --body 3650   # first, or tonight's run ships X again
prod deploy/<previous> "rollback: <why>"
```
Then A1 (F with `Fixes: <X>`), resume `SOAK_DAYS`, and run the check.

### C. A wrong puzzle
```bash
git commit -am "fix(gotd): <puzzle>" && git push origin main
```
The push starts `gotd.yml`: no soak, against the live code. A fix that needs newer code than what
is live: ship the code first (B1 or B3).

### D. The workflow or a script is broken
```bash
git commit -am "ci(prod): <what>" && git push origin main
```
Workflows and scripts always run from `main`, so the fix counts from the next run. Test it with
`prod main "<why>" true`.

## One-time setup (not in git)
The GitHub environment `production` (deployment branch `main`, no required reviewers) with the
secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Account Settings: Read, this account only),
and the service binding `GAME_ZIGZAG` -> `zigzag-site` in the portal repo (the custom domain
`play.vintoshine.com` is on `play-portal`, not on this Worker). Renew the token before it expires
(the run fails with an authentication error).
