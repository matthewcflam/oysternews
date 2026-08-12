#!/usr/bin/env bash
#
# Build public/stories.pmtiles from a single GeoJSON file.
#
# This is the Phase 2/2.5 path: one layer, no budget, no country floor. The
# Phase 3 worker builds its own two-layer archive through worker/tiles.ts, which
# shares scripts/run-tippecanoe.sh with this script.
#
# Kept because it rebuilds the map from eight known points with no network,
# which is how you tell a rendering bug from a data bug (HANDOFF.md START HERE).
#
# Usage:  npm run tiles:fake     eight fake points, fixtures/fake-stories.geojson
#         npm run tiles:real     one real GKG bundle, build/stories.geojson
#         bash scripts/build-tiles.sh <input.geojson> <archive-name>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT="${1:?usage: build-tiles.sh <input.geojson> <archive-name>}"
NAME="${2:?usage: build-tiles.sh <input.geojson> <archive-name>}"
OUTPUT="$REPO_ROOT/public/stories.pmtiles"

case "$INPUT" in
  /*) ;;
  *) INPUT="$REPO_ROOT/$INPUT" ;;
esac

if [ ! -f "$INPUT" ]; then
  echo "no such input: $INPUT" >&2
  echo "for tiles:real, run 'npm run gkg' first." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/public"

# §3.1: -Z0 -z12 -r1 --drop-densest-as-needed. -r1 disables tippecanoe's own
# radial dropping, because rank thinning is per-feature minzoom in Phase 3.
bash "$REPO_ROOT/scripts/run-tippecanoe.sh" \
  -o "$OUTPUT" \
  --force \
  --layer=stories \
  --name="$NAME" \
  -Z0 -z12 -r1 \
  --drop-densest-as-needed \
  "$INPUT"

echo "built $OUTPUT"
ls -la "$OUTPUT"
