#!/usr/bin/env bash
#
# Fail unless the tippecanoe on PATH is at or above a minimum version.
#
# Usage:  bash scripts/tippecanoe-min-version.sh 2.52.0
#
# This is a file rather than a few lines inside run-tippecanoe.sh because that
# script runs tippecanoe two ways — natively, and through `wsl.exe -- bash -lc`
# on Windows — and **a multi-line shell fragment does not survive the wsl.exe
# argv boundary**. Passing one through comes back word-split: the assignment
# `v=$(tippecanoe --version)` arrives as the command `v2.49.0` with `v=tippecanoe`
# in front of it, and the guard reports an empty version instead of the real one.
# Same family as the `wslpath` and `path.join` notes next door — a shell string
# crossing into WSL is the recurring hazard on this path, so nothing but simple
# quoted arguments crosses it now.
#
# Why there is a floor at all is in run-tippecanoe.sh, next to the constant.
set -euo pipefail

MIN="${1:?usage: tippecanoe-min-version.sh <minimum-version>}"

if ! command -v tippecanoe >/dev/null 2>&1; then
  echo "tippecanoe is not installed." >&2
  exit 127
fi

# "tippecanoe v2.49.0" -> "2.49.0"
raw="$(tippecanoe --version 2>&1 | head -1)"
version="${raw#tippecanoe}"
version="${version# }"
version="${version#v}"

if [ -z "$version" ]; then
  echo "tippecanoe --version produced nothing; the binary is broken or not runnable." >&2
  exit 127
fi

# `sort -V` orders version strings. If the lower of the two is the minimum, the
# installed version is at or above it.
if [ "$(printf '%s\n%s\n' "$MIN" "$version" | sort -V | head -1)" != "$MIN" ]; then
  cat >&2 <<EOF
tippecanoe $version is too old. This project requires >= $MIN.

Below $MIN, every feature carrying an explicit \`tippecanoe.minzoom\` is silently
dropped — the archive still builds, tippecanoe still exits 0, and every tile
serves exactly one feature. That is the entire density budget (HANDOFF.md §2.4),
so this is a hard stop rather than a warning.

Ubuntu's apt ships 2.49.0, which is below the floor. Build from source:

  git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe
  cd tippecanoe && make -j4 && sudo make install
EOF
  exit 1
fi
