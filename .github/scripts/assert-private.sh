#!/usr/bin/env bash
# Checks that nothing of a deployed site that must stay private is served.
#   assert-private.sh BASE_URL PATH...     (BASE_URL without a trailing slash)
# Every PATH must answer 404. A 5xx or no answer at all is a hiccup of the host, not a verdict
# (right after a deploy the edge may answer 503 for a moment): curl retries it, and a path that
# is still not 404 afterwards fails, as "public" for a 2xx or 3xx, as "could not be checked" for
# the rest. A query string bypasses caches (RUN_ID, else the time).
set -uo pipefail
base=${1:?usage: assert-private.sh BASE_URL PATH...}
shift
cb=${RUN_ID:-$(date +%s)}
failed=0
for p in "$@"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --retry 5 --retry-all-errors --retry-delay 3 \
    "$base/$p?cb=$cb")
  case $code in
    404) ;;
    2* | 3*) echo "::error::$p is public (HTTP $code)"; failed=1 ;;
    *) echo "::error::$p could not be checked (HTTP $code)"; failed=1 ;;
  esac
done
exit "$failed"
