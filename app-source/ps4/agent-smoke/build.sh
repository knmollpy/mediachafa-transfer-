#!/usr/bin/env bash
set -euo pipefail
make
mkdir -p dist
find . -maxdepth 1 -type f -iname '*.pkg' -size +0c -exec cp {} dist/ \;
test -s dist/IV0000-AGSMK0001_00-AGENTSMOKE000000.pkg
