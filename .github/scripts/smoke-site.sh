#!/usr/bin/env bash
# Smoke test of a deployed site, run from the repo root of the deployed commit (curl, node).
#   smoke-site.sh BASE_URL SITE_DIR SHA [PUZZLES]
#   BASE_URL  https://play.vintoshine.com/zigzag   (no trailing slash)
#   SITE_DIR  the staged folder that was deployed (dist/zigzag)
#   SHA       the commit the deploy was built from (build.json must show it)
#   PUZZLES   the tree id of the Game of Day puzzles of the deploy (build.json must show it, and
#             the puzzles of today and tomorrow must be served as staged)
# A query string bypasses caches. Pretty-URL redirects of the host are followed (-L).
# The host root is the portal's (repo play); this site lives below BASE_URL only.
set -euo pipefail
base=${1:?usage: smoke-site.sh BASE_URL SITE_DIR SHA [PUZZLES]}
dir=${2:?usage: smoke-site.sh BASE_URL SITE_DIR SHA [PUZZLES]}
sha=${3:?usage: smoke-site.sh BASE_URL SITE_DIR SHA [PUZZLES]}
puzzles=${4:-}
cb=${RUN_ID:-$(date +%s)}

fail() { echo "::error::$*"; exit 1; }
fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 "$1?cb=$cb"; }
json_ids() {   # "sha puzzles" of build.json (puzzles may be empty)
  node -e 'let s = ""; process.stdin.on("data", d => s += d)
    .on("end", () => { const j = JSON.parse(s); console.log(j.sha + " " + (j.puzzles || "")); })'
}

live=
livep=
for _ in $(seq 1 12); do   # a new version may need a moment at the edge
  ids=$(fetch "$base/build.json" 2> /dev/null | json_ids 2> /dev/null || true)
  read -r live livep <<< "$ids" || true
  if [ "$live" = "$sha" ] && { [ -z "$puzzles" ] || [ "$livep" = "$puzzles" ]; }; then
    break
  fi
  sleep 5
done
[ "$live" = "$sha" ] || fail "build.json shows '${live:-nothing}', expected $sha"
[ -z "$puzzles" ] || [ "$livep" = "$puzzles" ] ||
  fail "build.json shows puzzles '${livep:-nothing}', expected $puzzles"

themes=$(node themes/tools/build-site.mjs --dir)
for p in index.html webapp/index.html webapp/src/config.js webapp/css/play.css \
  $(cd "$dir" && find "$themes" -type f); do
  fetch "$base/$p" > /dev/null || fail "$p is not served"
done

# The puzzles of today and tomorrow (UTC) are what the players need next: served as staged.
if [ -n "$puzzles" ]; then
  for n in 0 1; do
    d=$(date -u -d "+$n day" +%Y%m%d)
    f="$dir/demo/GameOfDay/$d.txt"
    [ -f "$f" ] || continue
    served=$(fetch "$base/demo/GameOfDay/$d.txt" | sha256sum | cut -d' ' -f1) ||
      fail "demo/GameOfDay/$d.txt is not served"
    [ "$served" = "$(sha256sum "$f" | cut -d' ' -f1)" ] ||
      fail "demo/GameOfDay/$d.txt differs from the staged file"
  done
fi

# What must not be public: sources, tooling, and the pages that are not part of production.
RUN_ID=$cb "$(dirname "$0")/assert-private.sh" "$base" \
  webapp/package.json webapp/server/README.md webapp/tools/ratings.json \
  themes/candy/theme.json webapp/design.html webapp/stats.html demo/index.html \
  demo/design.html _headers _redirects || exit 1

# The page's CSP hashes its inline script: any rewrite of the HTML on the way breaks the app.
for p in index.html webapp/index.html; do
  served=$(fetch "$base/$p" | sha256sum | cut -d' ' -f1)
  staged=$(sha256sum "$dir/$p" | cut -d' ' -f1)
  [ "$served" = "$staged" ] || fail "$p differs from the staged file (edge rewrite?)"
done

headers=$(curl -sSIL --retry 5 --retry-delay 3 "$base/webapp/index.html?cb=$cb")
grep -qi '^x-content-type-options: *nosniff' <<< "$headers" || fail "nosniff header missing"
grep -qi '^content-security-policy: *frame-ancestors' <<< "$headers" ||
  fail "frame-ancestors header missing"

echo "Smoke test passed: $base is $sha${puzzles:+, puzzles ${puzzles:0:7}}"
