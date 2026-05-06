#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

BUMP="${1:-patch}"

case "$BUMP" in
  patch|minor|major) ;;
  *)
    echo "Usage: ./publish.sh [patch|minor|major]" >&2
    exit 1
    ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash changes before publishing." >&2
  exit 1
fi

NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
echo "Bumped to $NEW_VERSION"

git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "release: $NEW_VERSION"
git push

npm login
npm publish
