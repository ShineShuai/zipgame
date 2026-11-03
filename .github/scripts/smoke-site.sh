#!/usr/bin/env bash
# Smoke test of a deployed site, run from the repo root of the deployed commit (curl, node).
#   smoke-site.sh BASE_URL SITE_DIR SHA
#   BASE_URL  https://play.vintoshine.com/zigzag   (no trailing slash)
#   SITE_DIR  the staged folder that was deployed (dist/zigzag)
#   SHA       the commit the deploy was built from (build.json must show it)
# A query string bypasses caches. Pretty-URL redirects of the host are followed (-L).
set -euo pipefail
base=${1:?usage: smoke-site.sh BASE_URL SITE_DIR SHA}
dir=${2:?usage: smoke-site.sh BASE_URL SITE_DIR SHA}
sha=${3:?usage: smoke-site.sh BASE_URL SITE_DIR SHA}
origin=${base%/*}
cb=${RUN_ID:-$(date +%s)}

fail() { echo "::error::$*"; exit 1; }
fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 "$1?cb=$cb"; }
json_sha() {
  node -e 'let s = ""; process.stdin.on("data", d => s += d)
    .on("end", () => console.log(JSON.parse(s).sha))'
}

live=
for _ in $(seq 1 12); do   # a new version may need a moment at the edge
  live=$(fetch "$base/build.json" 2>/dev/null | json_sha 2>/dev/null || true)
  [ "$live" = "$sha" ] && break
  sleep 5
done
[ "$live" = "$sha" ] || fail "build.json shows '${live:-nothing}', expected $sha"

themes=$(node themes/tools/build-site.mjs --dir)
for p in index.html webapp/index.html webapp/src/config.js webapp/css/play.css \
  $(cd "$dir" && find "$themes" -type f); do
  fetch "$base/$p" > /dev/null || fail "$p is not served"
done

# What must not be public: sources, tooling, and the pages that are not part of production.
for p in webapp/package.json webapp/server/README.md webapp/tools/ratings.json \
  themes/candy/theme.json webapp/design.html webapp/stats.html demo/index.html \
  demo/design.html _headers _redirects; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/$p?cb=$cb")
  [ "$code" = 404 ] || fail "$p is public (HTTP $code)"
done

# The page's CSP hashes its inline script: any rewrite of the HTML on the way breaks the app.
for p in index.html webapp/index.html; do
  served=$(fetch "$base/$p" | sha256sum | cut -d' ' -f1)
  staged=$(sha256sum "$dir/$p" | cut -d' ' -f1)
  [ "$served" = "$staged" ] || fail "$p differs from the staged file (edge rewrite?)"
done

headers=$(curl -sSIL "$base/webapp/index.html?cb=$cb")
grep -qi '^x-content-type-options: *nosniff' <<< "$headers" || fail "nosniff header missing"
grep -qi '^content-security-policy: *frame-ancestors' <<< "$headers" ||
  fail "frame-ancestors header missing"

to=$(curl -sS -o /dev/null -w '%{redirect_url}' "$origin/")
[ "$to" = "$base/" ] || fail "$origin/ redirects to '${to:-nowhere}', expected $base/"
echo "Smoke test passed: $base is $sha"
