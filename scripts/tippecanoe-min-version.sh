#!/usr/bin/env bash
# Fail unless the tippecanoe on PATH is at or above a minimum version.
# Usage:  bash scripts/tippecanoe-min-version.sh 2.52.0
set -euo pipefail

MIN="${1:?usage: tippecanoe-min-version.sh <minimum-version>}"

if ! command -v tippecanoe >/dev/null 2>&1; then
  echo "tippecanoe is not installed." >&2
  exit 127
fi

raw="$(tippecanoe --version 2>&1 | head -1)"
version="${raw#tippecanoe}"
version="${version# }"
version="${version#v}"

if [ -z "$version" ]; then
  echo "tippecanoe --version produced nothing; the binary is broken or not runnable." >&2
  exit 127
fi

# sort -V, not sort: as plain strings "2.100.0" sorts below "2.52.0".
if [ "$(printf '%s\n%s\n' "$MIN" "$version" | sort -V | head -1)" != "$MIN" ]; then
  cat >&2 <<EOF
tippecanoe $version is too old. This project requires >= $MIN.

Below $MIN, every feature carrying an explicit \`tippecanoe.minzoom\` is silently
dropped — the archive still builds, tippecanoe still exits 0, and every tile
serves exactly one feature. That is the entire density budget,
so this is a hard stop rather than a warning.

Ubuntu's apt ships 2.49.0, which is below the floor. Build from source:

  git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe
  cd tippecanoe && make -j4 && sudo make install
EOF
  exit 1
fi
