#!/bin/sh
# Cross-platform pre-commit hook (Linux / macOS / Git for Windows)
# auto_bump_version.sh — bump a version constant on commit.
#
# Usage: auto_bump_version.sh WATCH_DIR TARGET_FILE VAR_NAME
#
#   WATCH_DIR    Trigger directory. The bump only runs if at least one staged
#                file lives under this directory. Use "." to trigger on any
#                staged file at all.
#   TARGET_FILE  File that holds the version constant. It must be tracked;
#                it will be `git add`ed after the bump so the new value is
#                part of the current commit.
#   VAR_NAME     Name of the constant, e.g. VERSION or GAME_VERSION.
#                The value must be a single-quoted simple major.minor.patch
#                string on the same line as the name.
#
# Works both as a raw .git/hooks/pre-commit and from the pre-commit
# framework (see .pre-commit-config.yaml in the README snippet).

set -u

if [ "$#" -lt 3 ]; then
  echo "usage: $0 WATCH_DIR TARGET_FILE VAR_NAME" >&2
  exit 2
fi

WATCH_DIR=$1
TARGET_FILE=$2
VAR_NAME=$3

# --- 1. Is anything under WATCH_DIR staged? ----------------------------------
if [ "$WATCH_DIR" = "." ]; then
  # Trigger on any staged change.
  git diff --cached --name-only | grep -q . || exit 0
else
  # Normalise: accept "webapp" or "webapp/" and match "webapp/…".
  case "$WATCH_DIR" in
    */) prefix="$WATCH_DIR" ;;
    *)  prefix="$WATCH_DIR/" ;;
  esac
  # Escape regex metacharacters so a directory name like "my.dir" doesn't
  # over-match ("myXdir"). Only . [ * ^ $ ( ) + ? { | need escaping to stay
  # within POSIX BRE, which is all we rely on here.
  escaped_prefix=$(printf '%s' "$prefix" | sed 's/[.[\*^$()+?{|]/\\&/g')
  if ! git diff --cached --name-only | grep -q "^${escaped_prefix}"; then
    exit 0
  fi
fi

# --- 2. Read the current version ---------------------------------------------
# This matches const VERSION = '…', export const VERSION = '…', and GAME_VERSION = '…',
# but not import { VERSION } from '…' or // VERSION bumped by hook.
current_line=$(grep -m1 -E "(^|[[:space:]])${VAR_NAME}[[:space:]]*=" "$TARGET_FILE" || true)

if [ -z "$current_line" ]; then
  echo "[auto-bump] Could not find $VAR_NAME in $TARGET_FILE" >&2
  exit 1
fi

# Extract text between the first pair of single quotes.
current_version=$(printf '%s\n' "$current_line" | sed -n "s/[^']*'\([^']*\)'.*/\1/p")

if [ -z "$current_version" ]; then
  echo "[auto-bump] Could not parse $VAR_NAME value in $TARGET_FILE" >&2
  exit 1
fi

# --- 3. Compute next version --------------------------------------------------
case "$current_version" in
  *[!0-9.]*|.*|*..*|*.)
    echo "[auto-bump] $VAR_NAME in $TARGET_FILE has value '$current_version'," >&2
    echo "[auto-bump] which is not simple major.minor.patch. Aborting." >&2
    exit 1
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
tmp="$(mktemp 2>/dev/null || mktemp -t autobump)"

# Literal replacement of 'old' with 'new' on the first line that has both
# VAR_NAME and the old quoted version. No regex, no nested-quote hell.
awk -v var="$VAR_NAME" -v old="'$current_version'" -v new="'$new_version'" '
  BEGIN { done = 0 }
  !done && index($0, var) > 0 && index($0, old) > 0 {
    n = index($0, old)
    $0 = substr($0, 1, n-1) new substr($0, n + length(old))
    done = 1
  }
  { print }
' "$TARGET_FILE" > "$tmp" || { rm -f "$tmp"; exit 1; }

if ! grep -q "'$new_version'" "$tmp"; then
  echo "[auto-bump] Failed to write new version; aborting." >&2
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$TARGET_FILE"

# --- 5. Re-stage the modified file so the bump is part of this commit ---------
git add "$TARGET_FILE"

echo "[auto-bump] $VAR_NAME in $TARGET_FILE bumped ${current_version} -> ${new_version}"
exit 0