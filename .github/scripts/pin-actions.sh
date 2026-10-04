#!/usr/bin/env bash
# Pins every `uses: owner/repo@vN` in the workflow to a full commit SHA, with the exact release as a comment.
set -euo pipefail
f=${1:-.github/workflows/webapp-ci.yml}
grep -oE 'uses: [^@ ]+@v[0-9]+$' "$f" | sort -u | while read -r _ ref; do
  repo=${ref%@*} major=${ref#*@}
  tag=$(gh api "repos/$repo/git/matching-refs/tags/$major." --jq '.[].ref' \
        | sed 's|refs/tags/||' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
  sha=$(gh api "repos/$repo/commits/$tag" --jq .sha)
  perl -pi -e "s{uses: \Q$repo\E\@\Q$major\E\$}{uses: $repo\@$sha # $tag}" "$f"
done
grep -n 'uses:' "$f"
