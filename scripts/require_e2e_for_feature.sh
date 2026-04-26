#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${GITHUB_BASE_REF:-}}"

if [[ -z "$TARGET_BRANCH" ]]; then
  echo "No merge target branch found; skipping E2E-feature guard."
  exit 0
fi

git fetch origin "$TARGET_BRANCH" --depth=200 >/dev/null 2>&1 || true

BASE_REF="origin/${TARGET_BRANCH}"
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  if git rev-parse --verify --quiet "$TARGET_BRANCH" >/dev/null; then
    BASE_REF="$TARGET_BRANCH"
  else
    echo "Base ref for ${TARGET_BRANCH} not found; skipping E2E-feature guard."
    exit 0
  fi
fi

CHANGED_FILES="$(git diff --name-only "${BASE_REF}...HEAD")"

echo "Changed files vs ${BASE_REF}:"
printf '%s\n' "$CHANGED_FILES"

if [[ -z "$CHANGED_FILES" ]]; then
  echo "No changed files detected."
  exit 0
fi

if printf '%s\n' "$CHANGED_FILES" | rg -q '^(frontend/e2e/.*\.spec\.ts)$'; then
  echo "E2E spec change detected."
  exit 0
fi

if printf '%s\n' "$CHANGED_FILES" | rg -q '^(frontend/src/|backend/|sync_.*\.py$)'; then
  echo "Feature-area files changed but no E2E spec was updated."
  echo "Add or update at least one frontend/e2e/*.spec.ts test for this feature."
  exit 1
fi

echo "No feature-area files changed; E2E update not required."
