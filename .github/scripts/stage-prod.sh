#!/usr/bin/env bash
# Builds the production folder from the checked-out commit: the site of stage-site.sh without the
# pages that are not part of production, below DIST/zigzag/, plus the Cloudflare _headers and
# build.json. The host root belongs to the portal Worker (repo play), not to this site. Run from the repo root; deploy/cloudflare/ must be there.
#   stage-prod.sh DIST SHA
set -euo pipefail
dist=${1:?usage: stage-prod.sh DIST SHA}
sha=${2:?usage: stage-prod.sh DIST SHA}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bash .github/scripts/stage-site.sh "$tmp/site"
# Play app only: no design or stats page, no old demo pages (nothing links to them).
rm -f "$tmp/site/webapp/design.html" "$tmp/site/webapp/stats.html" \
  "$tmp/site/demo/index.html" "$tmp/site/demo/design.html"
rm -rf "$dist"
mkdir -p "$dist/zigzag"
cp -a "$tmp/site/." "$dist/zigzag/"
cp deploy/cloudflare/_headers "$dist/"
printf '_headers\n' > "$dist/.assetsignore"
version=$(sed -n "s/.*VERSION = '\([^']*\)'.*/\1/p" webapp/src/version.js)
printf '{"sha":"%s","version":"%s","built":"%s"}\n' \
  "$sha" "$version" "$(date -u +%FT%TZ)" > "$dist/zigzag/build.json"
echo "Staged $(find "$dist" -type f | wc -l) files, version $version"
