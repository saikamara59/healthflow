#!/usr/bin/env bash
# Redeploy the previous release after a deploy fails its smoke check, then check it.
# Releases are tagged git-<commit>, so the rollback also restores that commit's
# fly.toml: redeploying an image alone would keep a broken configuration.
set -euo pipefail

app="${FLY_APP:-healthflow-demo}"
image="${1:-}"

if [[ -z "$image" ]]; then
  echo "No previous release image was recorded, so there is nothing safe to roll back to." >&2
  exit 1
fi

config_args=()
if [[ "$image" =~ :git-([0-9a-f]{40})$ ]] && config_dir="$(mktemp -d)" \
  && git show "${BASH_REMATCH[1]}:fly.toml" > "$config_dir/fly.toml" 2>/dev/null; then
  echo "Restoring fly.toml from ${BASH_REMATCH[1]}"
  config_args=(--config "$config_dir/fly.toml")
else
  # Releases from before commit labels, or a commit missing from history.
  echo "Warning: $image has no commit label in this history; redeploying it with this commit's fly.toml." >&2
fi

echo "Rolling $app back to $image"
flyctl deploy --app "$app" --image "$image" --strategy immediate ${config_args[@]+"${config_args[@]}"}
bash "$(dirname "$0")/smoke_deployed_routes.sh"
