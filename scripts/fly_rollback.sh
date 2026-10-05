#!/usr/bin/env bash
# Redeploy the previous release's image after a deploy fails its smoke check, then check it.
set -euo pipefail

app="${FLY_APP:-healthflow-demo}"
image="${1:-}"

if [[ -z "$image" ]]; then
  echo "No previous release image was recorded, so there is nothing safe to roll back to." >&2
  exit 1
fi

echo "Rolling $app back to $image"
flyctl deploy --app "$app" --image "$image" --strategy immediate
bash "$(dirname "$0")/smoke_deployed_routes.sh"
