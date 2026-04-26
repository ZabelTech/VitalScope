#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}"

if [[ -z "$TARGET_BRANCH" ]]; then
  echo "No merge-request target branch found; skipping E2E-feature guard."
  exit 0
fi

git fetch origin "$TARGET_BRANCH" --depth=200 >/dev/null 2>&1 || true

CHANGED_FILES="$(git diff --name-only "origin/${TARGET_BRANCH}...HEAD")"

echo "Changed files vs origin/${TARGET_BRANCH}:"
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
