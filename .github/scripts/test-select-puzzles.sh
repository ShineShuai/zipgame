#!/usr/bin/env bash
# Self-test of select-puzzles.sh and check-puzzles.mjs (needs git, curl, node, python3 and GNU
# date, so Linux): bash .github/scripts/test-select-puzzles.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
tmp=$(mktemp -d)
srv=
trap '[ -z "$srv" ] || kill "$srv" 2> /dev/null || true; rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fails=0

check() { # NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    fails=$((fails + 1))
  fi
}

# --- the scratch repository: code commit A, then a commit B with 12 puzzles from today on
git init -q --bare "$tmp/remote.git"
git clone -q "$tmp/remote.git" "$tmp/work" 2> /dev/null
cd "$tmp/work"
git checkout -q -b main
git commit -q --allow-empty -m A
A=$(git rev-parse HEAD)
mkdir -p demo/GameOfDay
puzzle_days() { # FIRST_OFFSET LAST_OFFSET: one file per day, relative to today (UTC)
  local n
  for n in $(seq "$1" "$2"); do
    echo "puzzle $n" > "demo/GameOfDay/$(date -u -d "+$n day" +%Y%m%d).txt"
  done
}
puzzle_days 0 11
git add -A
git commit -q -m B
git push -q origin main
git fetch -q origin
T1=$(git rev-parse HEAD:demo/GameOfDay)

mkdir -p "$tmp/site"
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp/site" > /dev/null 2>&1 &
srv=$!
sleep 1
export SITE="http://127.0.0.1:$port"
live() { # SHA [PUZZLES [BUILT]]
  printf '{"sha":"%s"%s%s}\n' "$1" "${2:+,\"puzzles\":\"$2\"}" "${3:+,\"built\":\"$3\"}" \
    > "$tmp/site/build.json"
}

# pick KEY=VALUE...: runs the script, leaves its outputs in $tmp/out, returns its status
pick() {
  : > "$tmp/out"
  env GITHUB_OUTPUT="$tmp/out" GITHUB_STEP_SUMMARY=/dev/null "$@" \
    bash "$here/select-puzzles.sh" > "$tmp/log" 2>&1
}
got() { sed -n "s/^$1=//p" "$tmp/out"; }

live "$A"
pick EVENT=schedule
check "scheduled: no puzzle id live yet -> release, dry run by default" \
  "true $A $T1 true false" "$(got run) $(got sha) $(got puzzles) $(got dry) $(got short)"
check "scheduled: nothing live yet -> live_puzzles is empty" "" "$(got live_puzzles)"
pick EVENT=schedule GOTD_DRY_RUN=false
check "scheduled: GOTD_DRY_RUN=false deploys" "true false" "$(got run) $(got dry)"
pick EVENT=push GOTD_DRY_RUN=false
check "push: same rule as scheduled" "true false" "$(got run) $(got dry)"

live "$A" "$T1"
pick EVENT=schedule GOTD_DRY_RUN=false
check "scheduled: puzzles already live -> skipped" "false" "$(got run)"
pick EVENT=workflow_dispatch REASON=x DRY_RUN_INPUT=true SMOKE_INPUT=false
check "manual: runs even when live, dry run, no smoke" "true true false x" \
  "$(got run) $(got dry) $(got smoke) $(got reason)"

pick EVENT=schedule PROD_FREEZE=true
check "scheduled: PROD_FREEZE stops it" "false" "$(got run)"
pick EVENT=workflow_dispatch REASON=x PROD_FREEZE=true
check "manual: ignores PROD_FREEZE" "true" "$(got run)"

# --- GOTD_AHEAD: only the next days ship, so the window is due once a UTC day
now=$(date -u +%FT%TZ)
yesterday=$(date -u -d '-1 day' +%FT%TZ)
live "$A" "$T1" "$yesterday"
pick EVENT=schedule GOTD_DRY_RUN=false
check "no GOTD_AHEAD: a build of yesterday changes nothing" "false" "$(got run)"
pick EVENT=schedule GOTD_DRY_RUN=false GOTD_AHEAD=2
check "GOTD_AHEAD: puzzles live, built yesterday -> the window moves on" "true false $T1" \
  "$(got run) $(got dry) $(got puzzles)"
check "GOTD_AHEAD: the reason says why" \
  "schedule release: the puzzle window (GOTD_AHEAD=2) moves on" "$(got reason)"
pick EVENT=push GOTD_DRY_RUN=false GOTD_AHEAD=2
check "GOTD_AHEAD: a push counts the same" "true" "$(got run)"
live "$A" "$T1" "$now"
pick EVENT=schedule GOTD_DRY_RUN=false GOTD_AHEAD=2
check "GOTD_AHEAD: built today -> nothing to do" "false" "$(got run)"
live "$A" "$T1"
pick EVENT=schedule GOTD_DRY_RUN=false GOTD_AHEAD=2
check "GOTD_AHEAD: no build time in build.json -> the window is due" "true" "$(got run)"
live "$A" "$T1" "$yesterday"
pick EVENT=schedule GOTD_DRY_RUN=false GOTD_AHEAD=2 PROD_FREEZE=true
check "GOTD_AHEAD: PROD_FREEZE still stops it" "false" "$(got run)"

# --- the buffer: 12 puzzles ahead in a row
pick EVENT=schedule MIN=10
check "buffer 12 >= 10: no alarm" "false" "$(got short)"
pick EVENT=schedule MIN=13
check "buffer 12 < 13: scheduled run raises the alarm" "true" "$(got short)"
pick EVENT=push MIN=13
check "buffer 12 < 13: a push only warns" "false" "$(got short)"
check "buffer: the warning is printed" "1" "$(grep -c 'only 12 puzzles ahead' "$tmp/log")"

# --- a gap stops the count, even though later puzzles exist
rm "demo/GameOfDay/$(date -u -d '+5 day' +%Y%m%d).txt"
git add -A
git commit -q -m gap
git push -q origin main
git fetch -q origin
T2=$(git rev-parse HEAD:demo/GameOfDay)
pick EVENT=schedule MIN=10
check "gap at +5: 5 in a row -> alarm, new puzzles are released" \
  "true true $T2" "$(got short) $(got run) $(got puzzles)"
check "gap at +5: the gap is named" "1" \
  "$(grep -c "no puzzle for $(date -u -d '+5 day' +%Y%m%d)" "$tmp/log")"

# --- what cannot be decided
live 0000000000000000000000000000000000000000 "$T1"
if pick EVENT=schedule; then
  check "live commit not in the clone is an error" fail ok
else
  check "live commit not in the clone is an error" fail fail
fi
rm "$tmp/site/build.json"
if pick EVENT=schedule; then
  check "unreadable build.json is an error" fail ok
else
  check "unreadable build.json is an error" fail fail
fi

# --- check-puzzles.mjs, with the code of this repository
cd "$root"
good=$(ls demo/GameOfDay/*.txt | tail -1)
mkdir "$tmp/good" "$tmp/bad"
cp "$good" "$tmp/good/"
cp "$good" "$tmp/bad/"
echo garbage > "$tmp/bad/29990101.txt"
node "$here/check-puzzles.mjs" "$tmp/good" 20000101 > "$tmp/log" 2>&1 && status=0 || status=$?
check "check-puzzles: a valid puzzle passes" "0" "$status"
node "$here/check-puzzles.mjs" "$tmp/bad" 20000101 > "$tmp/log" 2>&1 && status=0 || status=$?
check "check-puzzles: a file that does not parse fails" "1" "$status"
node "$here/check-puzzles.mjs" "$tmp/bad" 29990102 > "$tmp/log" 2>&1 && status=0 || status=$?
check "check-puzzles: a day before FROM is not checked" "0" "$status"
echo x > "$tmp/good/notes.txt"
node "$here/check-puzzles.mjs" "$tmp/good" 29990102 > "$tmp/log" 2>&1 && status=0 || status=$?
check "check-puzzles: a name that is no date fails" "1" "$status"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
