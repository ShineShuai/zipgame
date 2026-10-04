#!/usr/bin/env bash
# Copies an explicit allowlist of runtime files into $1, then fails on anything that must not ship.
# Run from the repository root. Needs only bash and tar.
set -euo pipefail
out=${1:?usage: stage-site.sh OUT_DIR}

rm -rf "$out" && mkdir -p "$out"
tar -c index.html assets demo/*.html demo/GameOfDay/*.txt webapp/*.html webapp/css webapp/src \
  | tar -x -C "$out"

bad=$(find "$out" -mindepth 1 \( -name '.*' -o -name '*.py' -o -name '*.sh' -o -name '*.mjs' \
  -o -name '*.sql' -o -name '*.toml' -o -name 'package*.json' -o -name '*.test.*' \) -print)
[ -z "$bad" ] || { echo "Forbidden files staged:"; echo "$bad"; exit 1; }

if grep -rEl 'sb_secret_|service_role|BEGIN [A-Z ]*PRIVATE KEY' "$out"; then
  echo "Secret-looking string staged"; exit 1
fi
echo "Staged $(find "$out" -type f | wc -l | tr -d ' ') files, $(du -sh "$out" | cut -f1)"
