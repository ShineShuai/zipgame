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
cat > "$1/index.html" <<'HTML'
<html><body>home</body></html>
HTML
cat > "$1/webapp/index.html" <<'HTML'
<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'"></head><body>app</body></html>
HTML
for i in $(seq -5 24); do
  : > "$1/demo/GameOfDay/$(date -u -d "$i day" +%Y%m%d).txt"
done
: > "$1/webapp/design.html"
STUB
: > deploy/cloudflare/_headers
cp "$here/../../deploy/cloudflare/add-beacon.mjs" deploy/cloudflare/
echo '{ "token": "" }' > deploy/cloudflare/analytics.json
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

# Web Analytics: the tag only with a token, on the two public pages; the app CSP lets it in.
tags() { grep -o '<script[^>]*beacon\.min\.js' "$1" | wc -l | tr -d ' '; }
stage "$tmp/wa0"
check "no token: no Web Analytics tag" 00 \
  "$(tags "$tmp/wa0/zigzag/index.html")$(tags "$tmp/wa0/zigzag/webapp/index.html")"
echo '{ "token": "0123456789abcdef0123456789abcdef" }' > deploy/cloudflare/analytics.json
stage "$tmp/wa1"
check "token: one tag on the home page" 1 "$(tags "$tmp/wa1/zigzag/index.html")"
check "token: one tag on the app page" 1 "$(tags "$tmp/wa1/zigzag/webapp/index.html")"
csp="script-src 'self' https://static.cloudflareinsights.com/beacon.min.js;"
csp="$csp connect-src 'self' https://cloudflareinsights.com"
check "token: the app CSP lets the script and its report in" 1 \
  "$(grep -c "$csp" "$tmp/wa1/zigzag/webapp/index.html")"
echo '{ "token": "bad token" }' > deploy/cloudflare/analytics.json
if stage "$tmp/wa2" 2> /dev/null; then
  check "a malformed token fails" fail ok
else
  check "a malformed token fails" fail fail
fi

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
