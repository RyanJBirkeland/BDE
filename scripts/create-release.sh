#!/usr/bin/env bash
# create-release.sh — bump version, tag, and push to trigger the CI release pipeline.
#
# Usage:
#   ./scripts/create-release.sh patch   # 0.2.0 → 0.2.1
#   ./scripts/create-release.sh minor   # 0.2.0 → 0.3.0
#   ./scripts/create-release.sh major   # 0.2.0 → 1.0.0
#   ./scripts/create-release.sh 1.2.3   # explicit version
#
# What this does:
#   1. Verifies the working tree is clean and on main
#   2. Bumps package.json version (via npm version or explicit)
#   3. Commits the version bump to main and pushes
#   4. Tags the commit and pushes the tag
#
# What CI does after the tag push (release.yml):
#   - Builds the macOS arm64 DMG
#   - Signs with Developer ID certificate
#   - Notarizes with Apple notary service
#   - Creates a draft GitHub release and publishes it with all assets

set -euo pipefail

BUMP="${1:-}"

# ── Guards ────────────────────────────────────────────────────────────────────

if [[ -z "$BUMP" ]]; then
  echo "Usage: $0 patch|minor|major|<version>" >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Must be on main (currently on $BRANCH)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty — commit or stash changes first" >&2
  exit 1
fi

git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "Local main is behind origin/main — run: git pull" >&2
  exit 1
fi

# ── Version bump ──────────────────────────────────────────────────────────────

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # Explicit version — set directly with npm
  npm version "$BUMP" --no-git-tag-version
  NEW_VERSION="$BUMP"
else
  # patch / minor / major
  npm version "$BUMP" --no-git-tag-version
  NEW_VERSION=$(node -p "require('./package.json').version")
fi

echo "Releasing v${NEW_VERSION}"

# ── Commit, tag, push ─────────────────────────────────────────────────────────

git add package.json package-lock.json
git commit -m "chore: bump version to ${NEW_VERSION}"
git push origin main

git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"

echo ""
echo "Tag v${NEW_VERSION} pushed — CI is now building, signing, and notarizing."
echo "Watch progress: https://github.com/RyanJBirkeland/FLEET/actions/workflows/release.yml"
echo "Release (once CI finishes): https://github.com/RyanJBirkeland/FLEET/releases/tag/v${NEW_VERSION}"
