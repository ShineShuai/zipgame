#!/usr/bin/env bash
# Self-test of select-release.sh in a scratch repository (needs git, curl, node, python3
# and GNU date, so Linux): bash .github/scripts/test-select-release.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
srv=
trap '[ -z "$srv" ] || kill "$srv" 2>/dev/null || true; rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fails=0

commit() { # DAYS_AGO MESSAGE
  local d; d=$(date -u -d "$1 days ago" +%FT%TZ)
  GIT_AUTHOR_DATE=$d GIT_COMMITTER_DATE=$d git commit -q --allow-empty -m "$2"
  git rev-parse HEAD
}

git init -q --bare "$tmp/remote.git"
git clone -q "$tmp/remote.git" "$tmp/work" 2> /dev/null
cd "$tmp/work"
git checkout -q -b main
A=$(commit 20 A); B=$(commit 12 B); C=$(commit 9 C); D=$(commit 3 D); E=$(commit 1 E)
git push -q origin main
git checkout -q -b hotfix/x "$A"
H=$(commit 0 hotfix)
git push -q origin hotfix/x
git checkout -q -b scratch/y "$A"
commit 0 scratch > /dev/null
git push -q origin scratch/y
git checkout -q main
git fetch -q origin

mkdir -p "$tmp/site"
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp/site" \
  > /dev/null 2>&1 &
srv=$!
sleep 1
export SITE="http://127.0.0.1:$port"
live() { # SHA DAYS_AGO_BUILT
  printf '{"sha":"%s","built":"%s"}\n' "$1" "$(date -u -d "$2 days ago" +%FT%TZ)" \
    > "$tmp/site/build.json"
}
today=$(date -u +%a)

# pick KEY=VALUE...: runs the script, leaves its outputs in $tmp/out, returns its status
pick() {
  : > "$tmp/out"
  env GITHUB_OUTPUT="$tmp/out" GITHUB_STEP_SUMMARY=/dev/null "$@" \
    bash "$here/select-release.sh" > "$tmp/log" 2>&1
}
got() { sed -n "s/^$1=//p" "$tmp/out"; }
check() { # NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    fails=$((fails + 1))
  fi
}
sched=(EVENT=schedule SOAK_DAYS=7 "RELEASE_DAYS=$today")

live "$A" 2; pick "${sched[@]}"
check "promotes the newest commit that soaked 7 days" "run=true sha=$C dry=true" \
  "run=$(got run) sha=$(got sha) dry=$(got dry)"
pick "${sched[@]}" DRY_RUN_VAR=false
check "DRY_RUN=false deploys for real" false "$(got dry)"
live "$C" 2; pick "${sched[@]}"
check "already live: nothing to do" false "$(got run)"
live "$E" 2; pick "${sched[@]}"
check "live is ahead of the soaked commit: nothing to do" false "$(got run)"
live "$A" 2; pick EVENT=schedule SOAK_DAYS=7 RELEASE_DAYS=Xyz
check "not a release day" false "$(got run)"
live "$A" 9; pick EVENT=schedule SOAK_DAYS=7 RELEASE_DAYS=Xyz
check "a missed release day is made up after 8 days" "true" "$(got run)"
live "$A" 2; pick "${sched[@]}" PROD_FREEZE=true
check "PROD_FREEZE" false "$(got run)"
live "$A" 2; pick "${sched[@]}" SOAK_DAYS=100
check "no commit is old enough" false "$(got run)"
live "$H" 2
if pick "${sched[@]}"; then check "live not in main's history (hotfix) fails the run" fail ok
else check "live not in main's history (hotfix) fails the run" fail fail; fi
rm "$tmp/site/build.json"
if pick "${sched[@]}"; then check "no build.json fails the run" fail ok
else check "no build.json fails the run" fail fail; fi

# a revert of a soaked change, made on main after the candidate
git checkout -q main
commit 0 "Revert B

This reverts commit $B." > /dev/null
git push -q origin main
git fetch -q origin
live "$A" 2; pick "${sched[@]}"
check "a change reverted during the soak period is not shipped" false "$(got run)"

live "$A" 2
pick EVENT=workflow_dispatch REF=main REASON=x
check "manual: main" "run=true sha=$(git rev-parse origin/main)" "run=$(got run) sha=$(got sha)"
pick EVENT=workflow_dispatch REF=hotfix/x REASON=x DRY_RUN_INPUT=true SMOKE_INPUT=false
check "manual: hotfix branch, dry run, no smoke" "$H true false" \
  "$(got sha) $(got dry) $(got smoke)"
if pick EVENT=workflow_dispatch REF=scratch/y REASON=x; then
  check "manual: other branch is refused" fail ok
else
  check "manual: other branch is refused" fail fail
fi
if pick EVENT=workflow_dispatch REF=nope REASON=x; then
  check "manual: unknown ref is refused" fail ok
else
  check "manual: unknown ref is refused" fail fail
fi

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
