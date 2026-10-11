#!/usr/bin/env bash
# Smoke test of a Turso database set up with server/turso/schema.sql, using the browser token. It sends the SAME requests the page sends (they are built
# and decoded by tursoBackend of src/platform/leaderboard.js, so this needs node), then tries writes the token must not be able to do.
# It adds ONE solve (42 s) to today's stats and TWO behaviour rows (ms 41999: one Game-of-Day style, one local with its puzzle as a blob): run it on a scratch
# database, not on the production one. Remove the rows with your own login: DELETE FROM play WHERE ms = 41999.
#   server/turso/smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]
#   HTTP_URL    https://<db>-<org>.<region>.turso.io      (turso db show <db> --http-url)
#   TOKEN_FILE  file holding the browser token            (turso db tokens create <db> -e never -p all:data_read -p submit:data_add -p play:data_add > FILE)
#   ORIGIN      the page's origin for the CORS check      (default https://shineshuai.github.io)
# The write checks run only for a token whose signed permission list is exactly the browser token's, and they stop at the first write that is NOT denied.
set -u
url=${1:?usage: smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]}
token=$(tr -d '[:space:]' < "${2:?usage: smoke.sh HTTP_URL TOKEN_FILE [ORIGIN]}")
origin=${3:-https://shineshuai.github.io}
url=${url%/}
root=$(cd "$(dirname "$0")/../.." && pwd)
day=$(date -u +%Y%m%d)
uid="smoke-$(date +%s)-$RANDOM"
failures=0

# client MODE ARGS... : the page's code. submit-body UID DAY MS [BIN] / read-body FROM TO print a request body; decode-submit / decode-read read a reply on stdin.
read -r -d '' CLIENT_JS <<'JS'
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const [root, mode, a, b, c, d] = process.argv.slice(1);
const { tursoBackend } = await import(pathToFileURL(root + '/src/platform/leaderboard.js'));
const { binOf } = await import(pathToFileURL(root + '/src/core/hist.js'));
const be = tursoBackend({ url: 'https://unused.example', key: 'unused' });
if (mode === 'submit-body') process.stdout.write(be.request({ u: a, d: +b, t: +c, b: d === undefined ? binOf(+c) : +d }).init.body);
else if (mode === 'read-body') process.stdout.write(be.read({ from: +a, to: +b }).init.body);
else if (mode === 'play-body' || mode === 'decode-play') { // the behaviour row (src/platform/behaviour.js): play-body DAYNUMBER MS WITH_PUZZLE / decode-play
  const { SINKS } = await import(pathToFileURL(root + '/src/platform/behaviour.js')), { packPuzzle, packS } = await import(pathToFileURL(root + '/src/core/behaviour.js'));
  const { parse } = await import(pathToFileURL(root + '/src/core/format.js')), sink = SINKS.turso({ url: 'https://unused.example', key: 'unused' });
  if (mode === 'play-body') process.stdout.write(sink.request({ day: +a, ms: +b, u: 1, deep: 1, s: packS(c === '1' ? 'local' : 'gotd', 15), pz: c === '1' ? packPuzzle(parse('size 5\ncheckpoints 0,0=1 4,4=2\nwalls')) : null, ev: null, v: 0 }).init.body);
  else { try { console.log(sink.decode(200, JSON.parse(readFileSync(0, 'utf8')))); } catch (e) { console.log('ERROR ' + e.message); } }
}
else {
  try { console.log(JSON.stringify(be.decode(mode === 'decode-read' ? 'read' : 'submit', JSON.parse(readFileSync(0, 'utf8'))))); } catch (e) { console.log('ERROR ' + e.message); }
}
JS
client() { node --input-type=module -e "$CLIENT_JS" "$root" "$@"; }

# post BODY -> raw reply of the pipeline;  sql STATEMENT -> the same for one statement
post() {
  curl -s --max-time 15 "$url/v2/pipeline" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$1"
}
sql() { post "{\"requests\":[{\"type\":\"execute\",\"stmt\":{\"sql\":\"$1\"}},{\"type\":\"close\"}]}"; }

# first_value REPLY -> first cell of the first row, empty when there is no row
first_value() {
  python3 -c 'import json, sys
rows = json.load(sys.stdin)["results"][0].get("response", {}).get("result", {}).get("rows", [])
print(rows[0][0]["value"] if rows else "")' <<<"$1" 2>/dev/null
}
# field NAME JSON -> that field of a decoded reply, empty when missing
field() { python3 -c 'import json, sys; print(json.loads(sys.argv[2]).get(sys.argv[1], ""))' "$1" "$2" 2>/dev/null; }

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

# 2. the page's own submit request: the INSERT goes through (the trigger validates) and the summary SELECT answers
n0=$(first_value "$(sql "SELECT COUNT(*) FROM solve WHERE day = $day")")
n0=${n0:-0}
reply=$(post "$(client submit-body "$uid" "$day" 42000)")
decoded=$(client decode-submit <<<"$reply")
n1=$(field n "$decoded")
[ "${n1:-0}" -eq $((n0 + 1)) ]
check "insert + summary with the browser token (n $n0 -> ${n1:-0})  <-- the important one" $? "$decoded  $reply"

# 2b. the page's own behaviour rows (src/platform/behaviour.js): one without a puzzle, one with its puzzle as a BLOB (the encoding that matters), the cap row readable
daynum=$(( $(date -u +%s) / 86400 ))
p0=$(first_value "$(sql "SELECT COUNT(*) FROM play WHERE ms = 41999")"); p0=${p0:-0}
for with in 0 1; do
  decoded=$(client decode-play <<<"$(post "$(client play-body "$daynum" 41999 "$with")")")
  [ "$decoded" = "ok" ]
  check "behaviour row (puzzle blob: $with) stored with the browser token  <-- needs play:data_add" $? "$decoded"
done
p1=$(first_value "$(sql "SELECT COUNT(*) FROM play WHERE ms = 41999")")
[ "${p1:-0}" -eq $((p0 + 2)) ]
check "both behaviour rows are in the table (${p0} -> ${p1:-0})" $? ""
reply=$(sql "SELECT cap FROM play_cfg WHERE id = 1")
[ -n "$(first_value "$reply")" ] && [ "$(first_value "$reply")" -ge 0 ]
check "play_cfg readable (the ceiling: $(first_value "$reply"))" $? "$reply"
decoded=$(client decode-play <<<"$(post "$(client play-body "$daynum" 100 0)")")
[ "$decoded" = "rejected" ]
check "behaviour row with ms 100 rejected by the trigger" $? "$decoded"

# 3. a repeated uid changes nothing and still answers
decoded=$(client decode-submit <<<"$(post "$(client submit-body "$uid" "$day" 42000)")")
[ "$(field n "$decoded")" = "${n1:-x}" ]
check "same uid again: ignored, same answer" $? "$decoded"

# 4. invalid input is rejected by the trigger (the page counts it as rejected)
for case in "ms 100:$uid-low:$day:100:0" "day 20200101:$uid-old:20200101:42000" "bin of another time:$uid-bin:$day:42000:3"; do
  IFS=: read -r name u d ms b <<<"$case"
  decoded=$(client decode-submit <<<"$(post "$(client submit-body "$u" "$d" "$ms" $b)")")
  [ "$decoded" = '{"rejected":true}' ]
  check "$name rejected" $? "$decoded"
done

# 5. the token cannot write anything but `submit`. The statements go from harmless to destructive and stop at the first one that is NOT denied.
# The signed token carries its permission list; the write attempts below run only for the documented browser token (read everything, add to submit).
# Anything else (no list = full access, or more rights, e.g. the seeder token) is reported and not attacked: a token that may write would let the attempts succeed.
extra=$(python3 -c 'import base64, json, sys
p = sys.argv[1].split(".")[1]
perm = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("perm")
if not perm:
    print("no permission list (full access)")
else:
    have = {(",".join(e["t"]) if e.get("t") else "all", a) for e in perm for a in e["a"]}
    print(", ".join(f"{t}:{a}" for t, a in sorted(have - {("all", "data_read"), ("submit", "data_add"), ("play", "data_add")})))' "$token" 2>/dev/null)
if [ -n "$extra" ]; then
  check "token is the browser token (-p all:data_read -p submit:data_add -p play:data_add)" 1 "not it: $extra. Write attempts skipped; a token like this must not go into config.js"
else
  check "token is the browser token (-p all:data_read -p submit:data_add -p play:data_add)" 0 ""
  # from harmless to destructive; stops at the first statement that is NOT denied (the database would not enforce the permissions)
  for stmt in \
    "CREATE TABLE smoke_denied (x)" \
    "INSERT INTO seed (day, ms) VALUES (19990101, '[1000]')" \
    "UPDATE submit SET ms = 1 WHERE uid = '$uid'" \
    "DELETE FROM submit WHERE uid = '$uid'" \
    "UPDATE play SET ms = ms WHERE ms = 41999" \
    "UPDATE play_cfg SET cap = cap" \
    "DELETE FROM play WHERE ms = 41999" \
    "DROP TABLE play_cfg" \
    "DROP TABLE seed"; do
    reply=$(sql "$stmt")
    grep -Eq '"type": *"error"' <<<"$reply"
    denied=$?
    check "denied: $stmt" $denied "$reply"
    if [ "$denied" -ne 0 ]; then
      echo "      stopped: the database does not enforce the permissions (the page would not be safe)"
      sql "DROP TABLE IF EXISTS smoke_denied" > /dev/null; sql "DELETE FROM seed WHERE day = 19990101" > /dev/null # clean up what the check just wrote
      break
    fi
  done
  n2=$(first_value "$(sql "SELECT COUNT(*) FROM solve WHERE day = $day")")
  [ "${n2:-0}" -eq "${n1:-0}" ]
  check "stats unchanged by the denied writes" $? "n was ${n1:-0}, now ${n2:-0}"
fi

# 6. reading works: the page's stats request, and the bin table
decoded=$(client decode-read <<<"$(post "$(client read-body "$day" "$day")")")
python3 -c 'import json, sys
days = json.loads(sys.argv[1])["days"]
sys.exit(0 if days and days[0]["d"] == int(sys.argv[2]) and days[0]["n"] >= int(sys.argv[3]) else 1)' "$decoded" "$day" "${n1:-1}" 2>/dev/null
check "stats request answers today (n >= ${n1:-1})" $? "$decoded"
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
