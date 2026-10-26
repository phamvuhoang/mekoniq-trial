#!/data/data/com.termux/files/usr/bin/bash
# Run inside Termux, from the unpacked bundle dir:  bash termux/install.sh
# Needs Termux + Termux:Boot installed from F-Droid (not Play Store).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/robot"

pkg update -y
pkg install -y nodejs-lts termux-api
npm install -g --unsafe-perm node-red@5.0.8

mkdir -p "$APP"
# Keep persisted robot/order state (context/) if re-installing.
cp -r "$HERE/data/." "$APP/"

# Autostart on boot (Termux:Boot) + keep CPU awake.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-nodered" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/robot"
# Restart Node-RED if it crashes.
while true; do
  HOST=127.0.0.1 node-red -u "$HOME/robot" -s "$HOME/robot/settings.js" >> "$HOME/robot/node-red.log" 2>&1
  sleep 5
done
BOOT
chmod +x "$HOME/.termux/boot/start-nodered"

echo "Done. Start now: sh ~/.termux/boot/start-nodered &"
echo "Then open http://127.0.0.1:1880/ in Chrome (kitchen.html / robot.html?robot=R1)."
