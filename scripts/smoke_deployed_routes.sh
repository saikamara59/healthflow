#!/usr/bin/env bash
# Check that direct browser-document requests reach the SPA after a Fly deploy.
set -euo pipefail

base_url="${HEALTHFLOW_BASE_URL:-https://healthflow.work}"
base_url="${base_url%/}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

check_path() {
  local path="$1" status content_type attempt accept
  accept="text/html"
  if [[ "$path" == /health ]]; then accept="application/json"; fi
  for attempt in {1..12}; do
    if status="$(curl --silent --show-error --max-time 10 --header "Accept: $accept" --dump-header "$tmp_dir/headers" --output "$tmp_dir/body" --write-out '%{http_code}' "$base_url$path")"; then
      content_type="$(tr -d '\r' < "$tmp_dir/headers" | awk 'BEGIN { IGNORECASE = 1 } tolower($1) == "content-type:" { print tolower($2) }' | tail -1)"
      if [[ "$path" == /health ]]; then
        if [[ "$status" == 200 && "$content_type" == application/json* ]] && grep -q '"status":"healthy"' "$tmp_dir/body"; then
          echo "OK $path: healthy JSON"
          return 0
        fi
      elif [[ "$status" == 200 && "$content_type" == text/html* ]] && grep -q '<div id="root"></div>' "$tmp_dir/body"; then
        echo "OK $path: SPA document"
        return 0
      fi
    else
      status="request failed"
      content_type="unavailable"
    fi
    echo "Attempt $attempt: $path returned $status ($content_type)" >&2
    if (( attempt < 12 )); then sleep 5; fi
  done
  echo "Deployed route failed: $base_url$path" >&2
  return 1
}

check_path /health
for path in / /today /overview /clients /enrollments /issues; do
  check_path "$path"
done
