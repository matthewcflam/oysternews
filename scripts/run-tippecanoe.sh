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

# The minimum tippecanoe this project can be built with. Not a preference — a
# correctness floor, and the one number in this file that must not be relaxed.
#
# tippecanoe 2.49.0 (which is what `apt-get install tippecanoe` gives you on
# Ubuntu 24.04, and what CI installed until 2026-08-14) silently discards every
# feature that carries an explicit `tippecanoe.minzoom` — which is every feature
# this project publishes, because that directive is how §2.4's density budget is
# expressed. In `tile.cpp` the block that assigns `sf.dropped` is guarded by
# `if (sf.tippecanoe_minzoom == -1)` with no `else`, so a feature with a declared
# minzoom keeps the struct default `dropped = FEATURE_DROPPED` and is discarded
# by rate. The sole survivor is the "first feature of the tile is always kept"
# guard, which is why the symptom is **exactly one feature per layer per tile at
# every zoom** rather than an empty archive.
#
# Upstream fixed it in felt/tippecanoe bd48ba8, "Fix accidental loss (at all
# zooms) of features with an explicit minzoom", first released in 2.52.0.
#
# This is checked rather than documented because both failure modes on this code
# path are silent: tippecanoe exits 0, the archive publishes, and every unit test
# and §8 invariant passes whether the budget ran or ate the map. The only place
# it was ever visible was a decoded tile. A wrong tippecanoe now fails the run.
MIN_TIPPECANOE=2.52.0

# The check itself is a sibling script, so that the native branch and the WSL
# branch run identical code. It cannot be inlined here: a multi-line shell
# fragment does not survive `wsl.exe -- bash -lc`, which is documented where it
# was measured, in tippecanoe-min-version.sh.
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tippecanoe-min-version.sh"

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

# Translate FIRST, for every branch.
#
# The obvious shape — translate only when shelling into wsl.exe, on the grounds
# that native tippecanoe implies native paths — is wrong, and cost a run to find
# on 2026-08-13. On Windows, `bash` resolves to C:\WINDOWS\system32\bash.exe,
# which is **WSL's bash, not Git Bash**. So this script is already executing
# inside Linux, `command -v tippecanoe` succeeds, and the native branch runs with
# the Windows paths Node built — `unable to open database file` on a path that
# looks perfectly reasonable in the error message.
#
# Translating unconditionally is a no-op where there is nothing to translate: a
# Linux CI runner never produces an argument that looks like `C:/…`.
translated=()
for arg in "$@"; do
  translated+=("$(to_wsl_arg "$arg")")
done

if command -v tippecanoe >/dev/null 2>&1; then
  bash "$GUARD" "$MIN_TIPPECANOE"
  exec tippecanoe "${translated[@]}"
fi

if command -v wsl.exe >/dev/null 2>&1; then

  # Quote every argument for the remote shell, so paths with spaces survive.
  quoted=""
  for arg in "${translated[@]}"; do
    quoted+="'${arg//\'/\'\\\'\'}' "
  done

  # The guard runs inside WSL, against the tippecanoe that is about to be used —
  # checking the Windows side would prove nothing, since there is no tippecanoe
  # there at all. Its path goes through the same translation as every other
  # argument, and it crosses as one quoted token, which is the only shape that
  # survives (see tippecanoe-min-version.sh).
  guard_wsl="$(to_wsl_arg "$GUARD")"

  exec wsl.exe -d Ubuntu -- bash -lc \
    "bash '$guard_wsl' '$MIN_TIPPECANOE' && tippecanoe $quoted"
fi

echo "tippecanoe not found, and no WSL to fall back to. See HANDOFF.md §6 decision 8." >&2
exit 127
