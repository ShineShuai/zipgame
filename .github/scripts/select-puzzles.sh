#!/usr/bin/env bash
# Decides whether the Game of Day puzzles of main (demo/GameOfDay) are released now, on their own:
# the code that is live plus the puzzles of main, without the code release (prod.yml).
# Run from a full clone (fetch-depth 0). Writes run, sha, live_puzzles, puzzles, dry, smoke, short,
# reason to $GITHUB_OUTPUT and lines to $GITHUB_STEP_SUMMARY.
#   EVENT                  push | schedule | workflow_dispatch
#   manual: REASON DRY_RUN_INPUT SMOKE_INPUT
#   automatic: PROD_FREEZE GOTD_DRY_RUN
#   GOTD_AHEAD (optional)  only the puzzles of the next GOTD_AHEAD days ship (stage-prod.sh), so the
#                          window is due once a UTC day: with the puzzles of main already live, an
#                          automatic run still releases when the live build is from an earlier day.
#   MIN                    puzzles that must be ahead in a row (MIN_PUZZLE_DAYS, default 10)
#   SITE                   live site, default https://play.vintoshine.com/zigzag
# sha is the live code, puzzles the tree id of demo/GameOfDay on main, live_puzzles the one that is
# live (empty before the first puzzle release). short is true when a scheduled run finds fewer
# than MIN puzzles ahead: the alarm of the workflow.
set -euo pipefail

site=${SITE:-https://play.vintoshine.com/zigzag}
min=${MIN:-10}
out() {
  echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/stdout}"
}
note() {
  echo "$*"
  echo "- $*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}
skip() {
  note "Skipped: $*"
  out run false
  exit 0
}
die() {
  echo "::error::$*"
  exit 1
}

[ "${EVENT:?}" = workflow_dispatch ] || [ "${PROD_FREEZE:-false}" != true ] ||
  skip "PROD_FREEZE is set"

# What is live: the code (sha) and the puzzles (a tree id) in build.json.
live=
livep=
built=
json=$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 \
  "$site/build.json?cb=$(date +%s)" 2> /dev/null || true)
read -r live livep built < <(node -e '
  try {
    const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log((j.sha || "") + " " + (j.puzzles || "-") + " " + (j.built || ""));
  } catch {
    console.log("");
  }' <<< "$json") || true
[ "$livep" != - ] || livep=
[ -n "$live" ] || die "cannot read $site/build.json (site down, or never deployed)"
git cat-file -e "$live^{commit}" 2> /dev/null ||
  die "live commit $live is not in this clone (a deleted hotfix branch?)"

puzzles=$(git rev-parse --verify --quiet origin/main:demo/GameOfDay) ||
  die "demo/GameOfDay is not on origin/main"

# Puzzles ahead in a row, counted from today (UTC); a gap stops the count.
names=$(git ls-tree --name-only "$puzzles")
ahead=0
while grep -qx "$(date -u -d "+$ahead day" +%Y%m%d).txt" <<< "$names"; do
  ahead=$((ahead + 1))
done
missing=$(date -u -d "+$ahead day" +%Y%m%d)
last=$(grep -E '^[0-9]{8}\.txt$' <<< "$names" | sort | tail -1 || true)
last=${last%.txt}
note "Game of Day puzzles ahead in a row from today (UTC): $ahead (MIN_PUZZLE_DAYS=$min)"
if [ -n "$last" ] && [[ "$last" > "$missing" ]]; then
  echo "::warning::demo/GameOfDay has no puzzle for $missing, but later days exist (last: $last)"
fi
short=false
if [ "$ahead" -lt "$min" ]; then
  echo "::warning::only $ahead puzzles ahead, fewer than MIN_PUZZLE_DAYS=$min: add puzzles"
  [ "$EVENT" != schedule ] || short=true
fi
out short "$short"

out sha "$live"
out puzzles "$puzzles"
out live_puzzles "$livep"

if [ "$EVENT" = workflow_dispatch ]; then
  out run true
  out dry "${DRY_RUN_INPUT:-false}"
  out smoke "${SMOKE_INPUT:-true}"
  out reason "$(printf '%s' "${REASON:-}" | tr '\n' ' ')"
  exit 0
fi

# The window of GOTD_AHEAD is due when the live build is from an earlier UTC day.
due=false
[ -z "${GOTD_AHEAD:-}" ] || [ "${built%%T*}" = "$(date -u +%F)" ] || due=true
[ "$puzzles" != "$livep" ] || [ "$due" = true ] ||
  skip "the puzzles of main (${puzzles:0:7}) are already live"
dry=true
[ "${GOTD_DRY_RUN:-true}" != false ] || dry=false
note "Release the puzzles ${puzzles:0:7} (live: ${livep:0:7}) with the live code ${live:0:7};" \
  "dry run: $dry"
out run true
out dry "$dry"
out smoke true
if [ "$puzzles" = "$livep" ]; then
  out reason "$EVENT release: the puzzle window (GOTD_AHEAD=$GOTD_AHEAD) moves on"
else
  out reason "$EVENT release of the puzzles ${puzzles:0:7}"
fi
