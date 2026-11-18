#!/usr/bin/env bash
# Builds the production folder from the checked-out commit: the site of stage-site.sh without the
# pages that are not part of production, below DIST/zigzag/, plus the Cloudflare _headers and
# build.json. The host root belongs to the portal Worker (repo play), not to this site. Run from the repo root; deploy/cloudflare/ must be there.
#   stage-prod.sh DIST SHA [PUZZLES]
#   GOTD_AHEAD  (optional, the repository variable of the same name; unset = off) K: only the
#            puzzles of today and of the next K days (UTC) ship, so nobody can read tomorrow's
#            puzzle in advance. The window moves on with every deploy: gotd.yml deploys once a UTC
#            day for that (select-puzzles.sh). K=1 is the least, the next day's puzzle must be
#            there at midnight; K=2 survives one failed daily release.
#   PUZZLES  tree id of demo/GameOfDay (git rev-parse REF:demo/GameOfDay). Its puzzles replace
#            the ones of the checked-out commit, so the Game of Day is released on its own, not
#            with the code (see gotd.yml). build.json records the id as "puzzles".
set -euo pipefail
dist=${1:?usage: stage-prod.sh DIST SHA [PUZZLES]}
sha=${2:?usage: stage-prod.sh DIST SHA [PUZZLES]}
puzzles=${3:-}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
die() {
  echo "::error::$*"
  exit 1
}

bash .github/scripts/stage-site.sh "$tmp/site"
# Play app only: no design or stats page, no old demo pages (nothing links to them).
rm -f "$tmp/site/webapp/design.html" "$tmp/site/webapp/stats.html" \
  "$tmp/site/demo/index.html" "$tmp/site/demo/design.html"
rm -rf "$dist"
mkdir -p "$dist/zigzag"
cp -a "$tmp/site/." "$dist/zigzag/"

if [ -n "$puzzles" ]; then
  git cat-file -e "$puzzles^{tree}" 2> /dev/null || die "$puzzles is not a tree of this clone"
  mkdir "$tmp/puzzles"
  git archive "$puzzles" | tar -x -C "$tmp/puzzles"
  shopt -s nullglob
  files=("$tmp/puzzles"/*.txt)
  [ "${#files[@]}" -gt 0 ] || die "tree $puzzles holds no puzzle (*.txt)"
  mkdir -p "$dist/zigzag/demo/GameOfDay"
  rm -f "$dist/zigzag/demo/GameOfDay"/*.txt
  cp "${files[@]}" "$dist/zigzag/demo/GameOfDay/"
fi

if [ -n "${GOTD_AHEAD:-}" ]; then
  [[ "$GOTD_AHEAD" =~ ^[0-9]+$ ]] || die "GOTD_AHEAD='$GOTD_AHEAD' is not a number of days"
  last=$(date -u -d "+$GOTD_AHEAD day" +%Y%m%d)
  dropped=0
  for file in "$dist/zigzag/demo/GameOfDay"/*.txt; do
    [ -e "$file" ] || continue
    day=$(basename "$file" .txt)
    if [[ "$day" =~ ^[0-9]{8}$ ]] && [ "$day" -gt "$last" ]; then
      rm -f "$file"
      dropped=$((dropped + 1))
    fi
  done
  echo "GOTD_AHEAD=$GOTD_AHEAD: $dropped puzzle(s) after $last left out"
fi

cp deploy/cloudflare/_headers "$dist/"
printf '_headers\n' > "$dist/.assetsignore"
version=$(sed -n "s/.*VERSION = '\([^']*\)'.*/\1/p" webapp/src/version.js)
extra=
[ -z "$puzzles" ] || extra=$(printf ',"puzzles":"%s"' "$puzzles")
printf '{"sha":"%s","version":"%s","built":"%s"%s}\n' \
  "$sha" "$version" "$(date -u +%FT%TZ)" "$extra" > "$dist/zigzag/build.json"
files_staged=$(find "$dist" -type f | wc -l)
echo "Staged $files_staged files, version $version${puzzles:+, puzzles ${puzzles:0:7}}"
