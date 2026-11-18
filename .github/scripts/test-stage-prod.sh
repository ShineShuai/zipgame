#!/usr/bin/env bash
# Self-test of the GOTD_AHEAD window of stage-prod.sh in a scratch repository (needs git and GNU
# date, so Linux): bash .github/scripts/test-stage-prod.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fails=0

# A repository with a stand-in for stage-site.sh, whose site has 30 puzzles (5 days ago .. +24),
# and a commit with a tree of 12 other puzzles (2 days ago .. +9), as gotd.yml lays them over.
mkdir -p "$tmp/repo/.github/scripts" "$tmp/repo/deploy/cloudflare" "$tmp/repo/webapp/src"
cd "$tmp/repo"
git init -q
cp "$here/stage-prod.sh" .github/scripts/
cat > .github/scripts/stage-site.sh <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$1/demo/GameOfDay" "$1/webapp"
for i in $(seq -5 24); do
  : > "$1/demo/GameOfDay/$(date -u -d "$i day" +%Y%m%d).txt"
done
: > "$1/webapp/design.html"
STUB
: > deploy/cloudflare/_headers
echo "export const VERSION = '1.2.3';" > webapp/src/version.js
mkdir -p demo/GameOfDay
for i in $(seq -2 9); do
  echo "puzzle $i" > "demo/GameOfDay/$(date -u -d "$i day" +%Y%m%d).txt"
done
git add -A
git commit -q -m puzzles
tree=$(git rev-parse HEAD:demo/GameOfDay)

staged() { find "$1/zigzag/demo/GameOfDay" -name '2*.txt' | wc -l | tr -d ' '; }
newest() { find "$1/zigzag/demo/GameOfDay" -name '2*.txt' | sort | tail -1 | xargs basename; }
check() { # NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    fails=$((fails + 1))
  fi
}
stage() { # OUT_DIR [PUZZLES]: with the variables of the caller
  bash .github/scripts/stage-prod.sh "$1" abc ${2:+"$2"} > /dev/null
}

stage "$tmp/all"
check "unset: every puzzle of the site ships" 30 "$(staged "$tmp/all")"
stage "$tmp/allp" "$tree"
check "unset: every puzzle of the tree ships" 12 "$(staged "$tmp/allp")"

GOTD_AHEAD=2 stage "$tmp/k2"
check "GOTD_AHEAD=2: the newest is today + 2" "$(date -u -d '+2 day' +%Y%m%d).txt" \
  "$(newest "$tmp/k2")"
check "GOTD_AHEAD=2: 5 past days, today and 2 ahead stay" 8 "$(staged "$tmp/k2")"

GOTD_AHEAD=2 stage "$tmp/k2p" "$tree"
check "GOTD_AHEAD=2 with puzzles: the newest is today + 2" \
  "$(date -u -d '+2 day' +%Y%m%d).txt" "$(newest "$tmp/k2p")"
check "GOTD_AHEAD=2 with puzzles: 2 past days, today and 2 ahead stay" 5 "$(staged "$tmp/k2p")"
check "GOTD_AHEAD=2 with puzzles: they are the puzzles of the tree" "puzzle 2" \
  "$(cat "$tmp/k2p/zigzag/demo/GameOfDay/$(date -u -d '+2 day' +%Y%m%d).txt")"

GOTD_AHEAD=0 stage "$tmp/k0" "$tree"
check "GOTD_AHEAD=0: nothing after today" "$(date -u +%Y%m%d).txt" "$(newest "$tmp/k0")"

if GOTD_AHEAD=two stage "$tmp/bad" 2> /dev/null; then
  check "a GOTD_AHEAD that is no number fails" fail ok
else
  check "a GOTD_AHEAD that is no number fails" fail fail
fi

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
