#!/usr/bin/env bash
# Print the image of the newest completed Fly release, so a failed deploy can roll back to it.
set -euo pipefail

app="${FLY_APP:-healthflow-demo}"

# Releases are newest first; a failed release never served traffic, so skip it.
flyctl releases --app "$app" --image --json \
  | jq -r '[.[] | select(.Status == "complete")][0].ImageRef // empty'
