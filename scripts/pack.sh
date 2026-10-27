#!/bin/sh
# Builds dist/robot-nodered.tar.gz: flows, settings, UI, MP3s + Termux installer + Valetudo runbook.
# Runtime state (data/context, .config.*) is NOT shipped; data/site.json is the empty seed (the demo is site.demo.json, web only).
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
COPYFILE_DISABLE=1 tar --no-xattrs -czf dist/robot-nodered.tar.gz \
  data/flows.json data/settings.js data/site.json data/lib data/public termux/install.sh scripts docs/valetudo-setup.md
ls -lh dist/robot-nodered.tar.gz
