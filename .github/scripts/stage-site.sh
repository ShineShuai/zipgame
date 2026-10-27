#!/usr/bin/env bash
# Copies an explicit allowlist of runtime files into $1, builds the theme files into it (themes/tools/build-site.mjs: packed bundles and
# their manifest, never a theme's sources), then fails on anything that must not ship.
# Run from the repository root. Needs bash, tar and node.
set -euo pipefail
out=${1:?usage: stage-site.sh OUT_DIR}

rm -rf "$out" && mkdir -p "$out"
# assets/ holds the design pages and their icon sheets and generators next to the logos: they are sources of themes, not part of the site
tar -c --exclude='assets/design' --exclude='assets/images/logo/proto/gen' --exclude='*-variants.svg' \
  index.html assets demo/*.html demo/GameOfDay/*.txt webapp/*.html webapp/css webapp/src \
  | tar -x -C "$out"
node themes/tools/build-site.mjs "$out"
node themes/tools/build-site.mjs --check "$out"

bad=$(find "$out" -mindepth 1 \( -name '.*' -o -name '*.py' -o -name '*.sh' -o -name '*.mjs' \
  -o -name '*.sql' -o -name '*.toml' -o -name 'package*.json' -o -name '*.test.*' \
  -o -name 'theme.json' -o -name 'art.json' -o -name '*.bundle.json' \) -print)
[ -z "$bad" ] || { echo "Forbidden files staged:"; echo "$bad"; exit 1; }

if grep -rEl 'sb_secret_|service_role|BEGIN [A-Z ]*PRIVATE KEY' "$out"; then
  echo "Secret-looking string staged"; exit 1
fi
echo "Staged $(find "$out" -type f | wc -l | tr -d ' ') files, $(du -sh "$out" | cut -f1)"
