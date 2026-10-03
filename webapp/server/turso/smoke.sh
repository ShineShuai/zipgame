#!/usr/bin/env bash
# Smoke test of a Turso database set up with server/turso/schema.sql, using the browser (insert-only) token.
# It adds ONE solve (42 s) to today's aggregate: run it on a scratch database, not on the production one.
#   server/turso/smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]
#   HTTP_URL    https://<db>-<org>.<region>.turso.io      (turso db show <db> --http-url)
#   TOKEN_FILE  file holding the token                    (turso db tokens create ... > FILE)
#   ORIGIN      the page's origin for the CORS check      (default https://shineshuai.github.io)
set -u
url=${1:?usage: smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]}
token=$(tr -d '[:space:]' < "${2:?usage: smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]}")
origin=${3:-https://shineshuai.github.io}
url=${url%/}
day=$(date -u +%Y%m%d)
uid="smoke-$(date +%s)-$RANDOM"
failures=0

# sql STATEMENT -> raw reply of the pipeline that runs one statement
sql() {
  curl -s --max-time 15 "$url/v2/pipeline" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "{\"requests\":[{\"type\":\"execute\",\"stmt\":{\"sql\":\"$1\"}},{\"type\":\"close\"}]}"
}

# first_value REPLY -> first cell of the first row, empty when there is no row
first_value() {
  python3 -c 'import json, sys
rows = json.load(sys.stdin)["results"][0].get("response", {}).get("result", {}).get("rows", [])
print(rows[0][0]["value"] if rows else "")' <<<"$1" 2>/dev/null
}

# check NAME CONDITION_RESULT(0 = true) DETAIL
check() {
  if [ "$2" -eq 0 ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1"
    echo "      ${3:0:300}"
    failures=$((failures + 1))
  fi
}

# 1. CORS preflight from the page's origin
preflight=$(curl -si --max-time 15 -X OPTIONS "$url/v2/pipeline" \
  -H "Origin: $origin" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type')
grep -iq '^access-control-allow-origin: \(\*\|'"$origin"'\)' <<<"$preflight"
origin_ok=$?
grep -i '^access-control-allow-headers:' <<<"$preflight" | grep -iq 'authorization'
headers_ok=$?
check "CORS: origin allowed" "$origin_ok" "$preflight"
check "CORS: authorization header allowed" "$headers_ok" "$preflight"

# 2. the insert-only token can add a solve, and the trigger updates the aggregates
n0=$(first_value "$(sql "SELECT n FROM day WHERE day = $day")")
n0=${n0:-0}
reply=$(sql "INSERT OR IGNORE INTO submit (uid, day, ms) VALUES ('$uid', $day, 42000)")
grep -Eq '"affected_row_count": *1[,}]' <<<"$reply"
check "insert a solve with the browser token" $? "$reply"
n1=$(first_value "$(sql "SELECT n FROM day WHERE day = $day")")
[ "${n1:-0}" -eq $((n0 + 1)) ]
check "trigger wrote the aggregate (n $n0 -> ${n1:-0})  <-- the important one" $? "the token may not write through the trigger: see the reply of the insert above"

# 3. a repeated uid changes nothing
reply=$(sql "INSERT OR IGNORE INTO submit (uid, day, ms) VALUES ('$uid', $day, 42000)")
grep -Eq '"affected_row_count": *0[,}]' <<<"$reply"
check "same uid again: ignored" $? "$reply"

# 4. invalid input is rejected by the trigger
reply=$(sql "INSERT OR IGNORE INTO submit (uid, day, ms) VALUES ('$uid-low', $day, 100)")
grep -q 'invalid' <<<"$reply"
check "ms 100 rejected" $? "$reply"
reply=$(sql "INSERT OR IGNORE INTO submit (uid, day, ms) VALUES ('$uid-old', 20200101, 42000)")
grep -q 'invalid' <<<"$reply"
check "day 20200101 rejected" $? "$reply"

# 5. the token cannot write the aggregates directly
for stmt in \
  "UPDATE day SET n = 999 WHERE day = $day" \
  "INSERT INTO day (day, n, sum_ms) VALUES (19990101, 1, 1)" \
  "DELETE FROM best" \
  "DROP TABLE day"; do
  reply=$(sql "$stmt")
  grep -Eq '"type": *"error"' <<<"$reply"
  check "denied: $stmt" $? "$reply"
done
n2=$(first_value "$(sql "SELECT n FROM day WHERE day = $day")")
[ "${n2:-0}" -eq "${n1:-0}" ]
check "aggregate unchanged by the denied writes" $? "n was ${n1:-0}, now ${n2:-0}"

# 6. reading works, and how long one request takes from here
reply=$(sql "SELECT COUNT(*) FROM bin_edge")
[ "$(first_value "$reply")" = "80" ]
check "token can read (80 bins)" $? "$reply"
curl -s -o /dev/null --max-time 15 "$url/v2/pipeline" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT 1"}},{"type":"close"}]}' \
  -w 'timing: dns %{time_namelookup}s, tcp %{time_connect}s, tls %{time_appconnect}s, first byte %{time_starttransfer}s, total %{time_total}s\n'

echo
if [ "$failures" -eq 0 ]; then
  echo "all checks passed"
else
  echo "$failures check(s) failed"
fi
exit "$failures"
