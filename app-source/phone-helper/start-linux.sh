#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Instalá Node.js 20 o posterior.'; read -r -p 'Presioná Enter para cerrar'; exit 1; }
command -v adb >/dev/null || { echo 'Instalá Android Platform Tools (ADB) y agregá adb al PATH.'; read -r -p 'Presioná Enter para cerrar'; exit 1; }
if [ ! -d node_modules ]; then npm install --omit=dev; fi
npm start
