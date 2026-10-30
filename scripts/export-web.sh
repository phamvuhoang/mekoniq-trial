#!/bin/sh
# Copies the demo UI + core logic into ../web/demo (static Vercel site).
# web/demo keeps its own transport.js (in-browser engine) and index.html (demo launcher).
set -e
cd "$(dirname "$0")/.."
OUT=../web/demo
mkdir -p "$OUT/lib"
rsync -a --delete --exclude transport.js --exclude index.html --exclude showcase.html --exclude lib --exclude site.json data/public/ "$OUT/"
cp data/lib/orchestrator.js data/lib/simulator.js data/lib/route.js data/lib/site.js data/lib/feature-policy.js data/lib/billing.js "$OUT/lib/"
cp data/site.demo.json "$OUT/site.json"
echo "exported to $(cd "$OUT" && pwd)"
