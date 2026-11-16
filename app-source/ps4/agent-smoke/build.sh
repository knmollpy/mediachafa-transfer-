#!/usr/bin/env bash
set -euo pipefail
echo "Running the OpenOrbis PKG smoke test with ld.lld alias"
make
mkdir -p dist
find . -maxdepth 1 -type f -iname '*.pkg' -size +0c -exec cp {} dist/ \;
if ! find dist -maxdepth 1 -type f -iname '*.pkg' -size +0c | grep -q .; then
  echo "No non-empty PS4 PKG was produced" >&2
  exit 1
fi
