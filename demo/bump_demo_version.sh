#!/bin/sh
# Cross-platform pre-commit hook (Linux / macOS / Git for Windows)
# Bumps GAME_VERSION in demo/index.html by +1 patch, but only if that file
# is part of the staged changes for this commit.

set -u

TARGET="demo/index.html"

# --- 1. Is the target file staged? -------------------------------------------
if ! git diff --cached --name-only | grep -qx "$TARGET"; then
  exit 0
fi

# --- 2. Read the current version ---------------------------------------------
current_line=$(grep -m1 'GAME_VERSION' "$TARGET" || true)

if [ -z "$current_line" ]; then
  echo "[pre-commit] Could not find GAME_VERSION in $TARGET" >&2
  exit 1
fi

# Extract text between the first pair of single quotes.
current_version=$(printf '%s\n' "$current_line" | sed -n "s/[^']*'\([^']*\)'.*/\1/p")

if [ -z "$current_version" ]; then
  echo "[pre-commit] Could not parse GAME_VERSION value in $TARGET" >&2
  exit 1
fi

# --- 3. Compute next version --------------------------------------------------
# Reject anything that isn't simple digits-and-dots (no pre-release tags, etc.).
case "$current_version" in
  *[!0-9.]*|.*|*..*|*.)
    echo "[pre-commit] GAME_VERSION '$current_version' is not simple major.minor.patch; skipping bump." >&2
    exit 0
    ;;
esac

major=$(printf '%s' "$current_version" | cut -d. -f1)
minor=$(printf '%s' "$current_version" | cut -d. -f2)
patch=$(printf '%s' "$current_version" | cut -d. -f3)

[ -n "$major" ] || major=0
[ -n "$minor" ] || minor=0
[ -n "$patch" ] || patch=0

new_patch=$((patch + 1))
new_version="${major}.${minor}.${new_patch}"

# --- 4. Write the new version back --------------------------------------------
tmp="$(mktemp 2>/dev/null || mktemp -t zipver)"

# Literal replacement of 'old' with 'new' on the first line that has both
# GAME_VERSION and the old quoted version. No regex, no nested-quote hell.
awk -v old="'$current_version'" -v new="'$new_version'" '
  BEGIN { done = 0 }
  !done && index($0, "GAME_VERSION") > 0 && index($0, old) > 0 {
    n = index($0, old)
    $0 = substr($0, 1, n-1) new substr($0, n + length(old))
    done = 1
  }
  { print }
' "$TARGET" > "$tmp" || { rm -f "$tmp"; exit 1; }

# Sanity check before overwriting.
if ! grep -q "'$new_version'" "$tmp"; then
  echo "[pre-commit] Failed to write new version; aborting." >&2
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$TARGET"

# --- 5. Re-stage the modified file so the bump is part of this commit ---------
git add "$TARGET"

echo "[pre-commit] Version bumped from ${current_version} to ${new_version}"
exit 0
