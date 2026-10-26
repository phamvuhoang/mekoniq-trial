#!/bin/sh
# Builds dist/robot-nodered.tar.gz: flows, settings, UI, MP3s + Termux installer.
# Runtime state (data/context, .config.*) is NOT shipped.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
tar -czf dist/robot-nodered.tar.gz \
  data/flows.json data/settings.js data/site.json data/lib data/public termux/install.sh scripts
ls -lh dist/robot-nodered.tar.gz
