#!/usr/bin/env bash
#
# Phase 2: build the hand-made PMTiles archive from fixtures/fake-stories.geojson.
#
# HANDOFF.md §6 decision 8 — tippecanoe has no native Windows build, so on Windows
# this shells into WSL. Everywhere else (including GitHub Actions) it calls
# tippecanoe directly. The flags are the ones §3.1 locks for production, used here
# on eight fake points so Phase 2 exercises the real toolchain rather than a
# stand-in.
#
# Usage:  npm run tiles:fake
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT="$REPO_ROOT/fixtures/fake-stories.geojson"
OUTPUT="$REPO_ROOT/public/stories.pmtiles"

# §3.1: -Z0 -z12 -r1 --drop-densest-as-needed. Rank thinning is done by per-feature
# minzoom in Phase 3, so -r1 disables tippecanoe's own radial dropping.
TIPPECANOE_ARGS=(
  -o "$OUTPUT"
  --force
  --layer=stories
  --name="sonder-stories-fake"
  -Z0 -z12 -r1
  --drop-densest-as-needed
)

mkdir -p "$REPO_ROOT/public"

# /c/Users/x  ->  /mnt/c/Users/x
# C:/Users/x  ->  /mnt/c/Users/x
# C:\Users\x  ->  /mnt/c/Users/x
to_wsl_path() {
  printf '%s' "$1" \
    | tr '\\' '/' \
    | sed -E 's|^([a-zA-Z]):|/\1|' \
    | sed -E 's|^/([a-zA-Z])/|/mnt/\1/|' \
    | sed -E 's|^/mnt/([A-Z])/|/mnt/\l\1/|'
}

run_tippecanoe() {
  if command -v tippecanoe >/dev/null 2>&1; then
    tippecanoe "${TIPPECANOE_ARGS[@]}" "$INPUT"
    return
  fi

  # Windows: no native build. Hand off to WSL, translating the paths.
  #
  # Do NOT route this through `wslpath` — passing a Windows path through wsl.exe
  # strips the backslashes before wslpath ever sees it, silently producing
  # "C:Usersmatth...". Convert /c/... (or C:/...) to /mnt/c/... here instead.
  if command -v wsl.exe >/dev/null 2>&1; then
    local wsl_in wsl_out
    wsl_in="$(to_wsl_path "$INPUT")"
    wsl_out="$(to_wsl_path "$OUTPUT")"
    wsl.exe -d Ubuntu -- bash -lc "command -v tippecanoe >/dev/null || { echo 'tippecanoe is not installed in WSL. Run:  wsl -d Ubuntu -- sudo apt-get install -y tippecanoe' >&2; exit 127; }; tippecanoe -o '$wsl_out' --force --layer=stories --name=sonder-stories-fake -Z0 -z12 -r1 --drop-densest-as-needed '$wsl_in'"
    return
  fi

  echo "tippecanoe not found, and no WSL to fall back to. See HANDOFF.md §6 decision 8." >&2
  exit 127
}

run_tippecanoe

echo "built $OUTPUT"
ls -la "$OUTPUT"
