#!/usr/bin/env bash
# Run tippecanoe natively where it exists, otherwise through WSL on Windows.
# Usage:  bash scripts/run-tippecanoe.sh -o out.pmtiles -L layer:in.geojson ...
set -euo pipefail

# A correctness floor, not a preference: below 2.52.0 tippecanoe silently drops every
# feature with an explicit minzoom (every feature this project publishes) and exits 0.
MIN_TIPPECANOE=2.52.0

# A sibling script, not inlined: a multi-line fragment does not survive `wsl.exe -- bash -lc`.
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tippecanoe-min-version.sh"

# Rewrites C:/x, C:\x and /c/x to /mnt/c/x at the start of an argument or after -L's
# `layer:` colon. Not wslpath: wsl.exe strips backslashes before wslpath sees them.
to_wsl_arg() {
  printf '%s' "$1" \
    | tr '\\' '/' \
    | sed -E 's|(^\|:)([a-zA-Z]):/|\1/mnt/\2/|g' \
    | sed -E 's|(^\|:)/([a-zA-Z])/|\1/mnt/\2/|g' \
    | sed -E 's|/mnt/([A-Z])/|/mnt/\l\1/|g'
}

# Translate for every branch: on Windows, `bash` may already be WSL's, so the native
# branch can run with Windows paths. A no-op on Linux.
translated=()
for arg in "$@"; do
  translated+=("$(to_wsl_arg "$arg")")
done

if command -v tippecanoe >/dev/null 2>&1; then
  bash "$GUARD" "$MIN_TIPPECANOE"
  exec tippecanoe "${translated[@]}"
fi

if command -v wsl.exe >/dev/null 2>&1; then

  quoted=""
  for arg in "${translated[@]}"; do
    quoted+="'${arg//\'/\'\\\'\'}' "
  done

  # The guard runs inside WSL, against the tippecanoe about to be used.
  guard_wsl="$(to_wsl_arg "$GUARD")"

  exec wsl.exe -d Ubuntu -- bash -lc \
    "bash '$guard_wsl' '$MIN_TIPPECANOE' && tippecanoe $quoted"
fi

echo "tippecanoe not found, and no WSL to fall back to." >&2
exit 127
