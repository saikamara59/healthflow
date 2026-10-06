#!/usr/bin/env bash
# Print "true" when the target commit must deploy, "false" when nothing shipped changed.
# Compares with the commit live on Fly (its git-<commit> image label), not the
# previous push: GitHub replaces a queued release with a newer one, so the
# previous push may never have deployed.
set -euo pipefail

deployed_image="${1:-}"
target="${2:?Usage: release_needs_deploy.sh <deployed image> <target commit>}"
not_shipped='(\.md$|^docs/|^frontend/tests/|^healthflow/tests/|^healthflow/forensics/tests/|^healthflow/agents/temporal_awareness/tests/|^tests/ci/)'

# An unknown live commit (first deploy, unlabeled release, missing history) deploys.
if [[ ! "$deployed_image" =~ :git-([0-9a-f]{40})$ ]] \
  || ! changed="$(git diff --name-only "${BASH_REMATCH[1]}" "$target" 2>/dev/null)"; then
  echo true
  exit 0
fi

if [[ -n "$changed" ]] && grep -qvE "$not_shipped" <<< "$changed"; then
  echo true
else
  echo false
fi
