#!/usr/bin/env bash
# Decides what the production workflow deploys. Run from a full clone (fetch-depth 0).
# Writes sha, live, run, dry, smoke, strict, reason to $GITHUB_OUTPUT and a line to
# $GITHUB_STEP_SUMMARY.
#   EVENT                   workflow_dispatch | schedule
#   manual: REF REASON DRY_RUN_INPUT SMOKE_INPUT
#   scheduled: PROD_FREEZE SOAK_DAYS RELEASE_DAYS DRY_RUN_VAR
#   SITE                    live site, default https://play.vintoshine.com/zigzag
set -euo pipefail

site=${SITE:-https://play.vintoshine.com/zigzag}
out() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
note() { echo "$*"; echo "- $*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
skip() { note "Skipped: $*"; out run false; exit 0; }
die() { echo "::error::$*"; exit 1; }
on_main_or_hotfix() {
  local n
  n=$(git branch -r --contains "$1" | grep -cE '^\s*origin/(main|hotfix/.+)$' || true)
  [ "$n" -gt 0 ]
}

# What is live: the sha and build time in build.json (empty before the first deploy).
live=
built=
json=$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 \
  "$site/build.json?cb=$(date +%s)" 2>/dev/null || true)
read -r live built < <(node -e '
  try { const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
        console.log((j.sha || "") + " " + (j.built || "")); }
  catch { console.log(""); }' <<< "$json") || true

if [ "${EVENT:?}" = workflow_dispatch ]; then
  ref=${REF:?}
  sha=$(git rev-parse --verify --quiet "origin/$ref^{commit}" ||
        git rev-parse --verify --quiet "$ref^{commit}") || die "cannot resolve '$ref'"
  on_main_or_hotfix "$sha" || die "$sha is on neither main nor a hotfix/* branch"
  out sha "$sha"
  out live "$live"
  out run true
  out dry "${DRY_RUN_INPUT:-false}"
  out smoke "${SMOKE_INPUT:-true}"
  out strict false
  out reason "$(tr '\n' ' ' <<< "${REASON:-}")"
  exit 0
fi

[ "${PROD_FREEZE:-false}" != true ] || skip "PROD_FREEZE is set"
soak=${SOAK_DAYS:-7}
days=${RELEASE_DAYS:-Tue}
[ -n "$live" ] || die "cannot read $site/build.json (site down, or never deployed)"

# A release day, or a missed one: the live version is more than a week old.
today=$(date -u +%a)
age=0
[ -z "$built" ] || age=$(( ($(date -u +%s) - $(date -u -d "$built" +%s)) / 86400 ))
case ",$days," in
  *",$today,"*) ;;
  *) [ "$age" -ge 8 ] || skip "$today is not a release day ($days)" ;;
esac

# The newest commit of main that has been there for the soak period.
cand=$(git rev-list -1 --first-parent --before="$soak days ago" origin/main)
[ -n "$cand" ] || skip "no commit of main is $soak days old yet"
git cat-file -e "$live^{commit}" 2>/dev/null ||
  die "live commit $live is not in this clone (a deleted hotfix branch?)"
[ "$cand" != "$live" ] || skip "main@${cand:0:7} is already live"
if git merge-base --is-ancestor "$cand" "$live"; then
  skip "live ${live:0:7} is ahead of the soaked main@${cand:0:7}"
fi
git merge-base --is-ancestor "$live" "$cand" ||
  die "live ${live:0:7} is not in the history of main@${cand:0:7}: a hotfix not merged" \
      "into main? Merge it with a merge commit, or deploy main by hand."

# A change that was reverted on main during the soak period is not shipped.
reverted=$(git log --format=%B "$cand..origin/main" |
  grep -oE 'This reverts commit [0-9a-f]{40}' | awk '{print $4}' || true)
pending=$(git rev-list "$live..$cand")
for r in $reverted; do
  if grep -qx "$r" <<< "$pending"; then
    skip "main@${cand:0:7} contains ${r:0:7}, which was reverted on main since"
  fi
done

dry=true
[ "${DRY_RUN_VAR:-true}" != false ] || dry=false
note "Promote main@${cand:0:7} (soaked $soak days) over live ${live:0:7}; dry run: $dry"
out sha "$cand"
out live "$live"
out run true
out dry "$dry"
out smoke true
out strict true
out reason "scheduled promote of main@${cand:0:7}"
