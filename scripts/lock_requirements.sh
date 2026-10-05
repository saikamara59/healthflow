#!/usr/bin/env bash
# Regenerate requirements.lock from requirements.txt for the Python version the
# Docker image and CI use (3.12), inside a clean python:3.12-slim container.
#
# Usage: HEALTHFLOW_AGENTS_TOKEN=... scripts/lock_requirements.sh
#        (falls back to the GitHub CLI login when the variable is unset)
#
# The token only reaches the container's git credential helper; it is never
# printed or written to the lockfile.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
token="${HEALTHFLOW_AGENTS_TOKEN:-}"
if [[ -z "$token" ]] && command -v gh >/dev/null 2>&1; then
  token="$(gh auth token 2>/dev/null || true)"
fi
if [[ -z "$token" ]]; then
  echo "Set HEALTHFLOW_AGENTS_TOKEN or log in with 'gh auth login' to read healthflow-agents." >&2
  exit 1
fi

HEALTHFLOW_AGENTS_TOKEN="$token" docker run --rm \
  -e HEALTHFLOW_AGENTS_TOKEN \
  -v "$repo_root/requirements.txt:/in/requirements.txt:ro" \
  -v "$repo_root:/out" \
  python:3.12-slim sh -c '
    set -e
    cd /tmp && cp /in/requirements.txt .
    apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null
    pip install -q uv >/dev/null
    git config --global credential.helper "!f() { echo username=x-access-token; echo password=\$HEALTHFLOW_AGENTS_TOKEN; }; f"
    uv pip compile requirements.txt --python-version 3.12 --no-header --annotation-style line -o requirements.lock
    cp requirements.lock /out/requirements.lock
  '
echo "Wrote requirements.lock"
