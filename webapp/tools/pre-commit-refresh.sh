#!/usr/bin/env bash
# Regenerate derived files from their sources and stage them (pre-commit hooks).
#   pre-commit-refresh.sh labels        ratings.json / pairs.json -> check, fit-trap, gotd-fit, version bump, tests
#   pre-commit-refresh.sh bin-edge      src/core/hist.js          -> server/turso/schema.sql
#   pre-commit-refresh.sh bench-report  bench/report.template.html -> bench/report.html
# Env: FORCE=1 treat ratings.json as changed (catch-up run), SKIP_TESTS=1 skip `npm test`.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root/webapp"

changed() { ! git diff --cached --quiet -- "$@"; }   # staged change under these paths
step() { echo "• $*"; }

run() {  # run CMD...: last lines on success, full output on failure
  local log rc=0
  log=$(mktemp)
  "$@" >"$log" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then tail -n 3 "$log"; else cat "$log"; fi
  rm -f "$log"
  return "$rc"
}

labels() {
  step "check-ratings"
  run node tools/check-ratings.mjs
  if [ -z "${FORCE:-}" ] && ! changed tools/ratings.json; then
    echo "pairs.json only: nothing to refit"
    return
  fi

  step "fit-trap --write"
  run node tools/fit-trap.mjs --write
  local trap_changed=0
  git diff --quiet -- src/core/trap.js || trap_changed=1

  if [ "$trap_changed" = 1 ] || ! node tools/gotd-fit.mjs --check >/dev/null 2>&1; then
    step "gotd-fit"
    run node tools/gotd-fit.mjs
  fi
  git add src/core/trap.js tools/gotd-models.json

  # The trap model changes the grades the app shows: bump unless the bump hook already did.
  if [ "$trap_changed" = 1 ] && ! changed src/version.js; then
    step "bump webapp VERSION"
    (cd "$root" && ./auto_bump_version.sh webapp webapp/src/version.js VERSION)
    git add src/version.js
  fi

  if [ -z "${SKIP_TESTS:-}" ]; then
    step "npm test"
    run npm test --silent
  fi
}

bin_edge() {
  step "print-bin-edge --write"
  run node tools/print-bin-edge.mjs --write
  git add server/turso/schema.sql
}

bench_report() {
  step "report.mjs build"
  run node bench/report.mjs build
  git add bench/report.html
}

case "${1:-}" in
  labels) labels ;;
  bin-edge) bin_edge ;;
  bench-report) bench_report ;;
  *) echo "usage: $0 labels|bin-edge|bench-report" >&2; exit 2 ;;
esac
