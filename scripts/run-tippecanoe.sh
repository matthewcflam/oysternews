#!/usr/bin/env bash
#
# Run tippecanoe with whatever arguments it is given, natively where a native
# build exists and through WSL on Windows (HANDOFF.md §6 decision 8).
#
# This is the single place that knows about the Windows -> WSL path translation.
# worker/tiles.ts and scripts/build-tiles.sh both go through it, so CI (Linux,
# native tippecanoe) and this machine (Windows, WSL) take the same code path.
#
# Usage:  bash scripts/run-tippecanoe.sh -o out.pmtiles -L layer:in.geojson ...
set -euo pipefail

# /c/Users/x  ->  /mnt/c/Users/x
# C:/Users/x  ->  /mnt/c/Users/x
# C:\Users\x  ->  /mnt/c/Users/x
#
# Applied to the whole argument rather than to arguments that "look like" paths,
# because tippecanoe's -L takes `layer:/path/to/file` and the path is not the
# start of the token.
#
# Do NOT route this through `wslpath`: passing a Windows path through wsl.exe
# strips the backslashes before wslpath ever sees them, silently producing
# "C:Usersmatth...". That cost twenty minutes once already.
# Both spellings have to be handled, and only one of them was at first: Node on
# Windows hands over "C:/Users/x", while bash hands over "/c/Users/x". A rule for
# the drive-letter form alone leaves the bash form untouched and tippecanoe fails
# with "unable to open database file".
#
# The (^|:) anchor is what keeps the /c/ rule from eating path interiors — it
# only fires at the start of an argument or straight after tippecanoe's
# `layer:path` colon, never mid-path.
to_wsl_arg() {
  printf '%s' "$1" \
    | tr '\\' '/' \
    | sed -E 's|(^\|:)([a-zA-Z]):/|\1/mnt/\2/|g' \
    | sed -E 's|(^\|:)/([a-zA-Z])/|\1/mnt/\2/|g' \
    | sed -E 's|/mnt/([A-Z])/|/mnt/\l\1/|g'
}

if command -v tippecanoe >/dev/null 2>&1; then
  exec tippecanoe "$@"
fi

if command -v wsl.exe >/dev/null 2>&1; then
  translated=()
  for arg in "$@"; do
    translated+=("$(to_wsl_arg "$arg")")
  done

  # Quote every argument for the remote shell, so paths with spaces survive.
  quoted=""
  for arg in "${translated[@]}"; do
    quoted+="'${arg//\'/\'\\\'\'}' "
  done

  exec wsl.exe -d Ubuntu -- bash -lc \
    "command -v tippecanoe >/dev/null || { echo 'tippecanoe is not installed in WSL. Run:  wsl -d Ubuntu -- sudo apt-get install -y tippecanoe' >&2; exit 127; }; tippecanoe $quoted"
fi

echo "tippecanoe not found, and no WSL to fall back to. See HANDOFF.md §6 decision 8." >&2
exit 127
