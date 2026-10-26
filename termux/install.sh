#!/data/data/com.termux/files/usr/bin/bash
# Run inside Termux, from the unpacked bundle dir:  bash termux/install.sh
# Needs Termux + Termux:Boot installed from F-Droid (not Play Store).
# Re-running it updates the app in place (robot/order state in context/ and the editor password are kept).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/robot"
ENV="$APP/.env"

# Stop a running copy first so the update is picked up.
pkill -f "start-nodered" 2>/dev/null || true
pkill -f "node-red -u $APP" 2>/dev/null || true

if ! command -v node-red >/dev/null || ! node -v >/dev/null 2>&1; then
  # Full upgrade, not just `pkg update`: a fresh nodejs on an old libc++ fails with "CANNOT LINK EXECUTABLE node".
  export DEBIAN_FRONTEND=noninteractive
  pkg upgrade -y -o Dpkg::Options::=--force-confnew
  pkg install -y -o Dpkg::Options::=--force-confnew nodejs-lts termux-api
  npm install -g --unsafe-perm node-red@5.0.8
fi

mkdir -p "$APP"
cp -r "$HERE/data/." "$APP/"

# Editor (/admin) password: asked once, stored as a bcrypt hash. UI pages stay open to tablets on the Wi-Fi.
if [ ! -f "$ENV" ]; then
  while :; do
    read -rsp "Đặt mật khẩu trình soạn Node-RED (user: admin, ≥8 ký tự): " PW; echo
    [ ${#PW} -ge 8 ] && break
    echo "Mật khẩu quá ngắn."
  done
  NR="$(npm root -g)/node-red"
  HASH=$(node -e "console.log(require(require.resolve('bcryptjs',{paths:[process.argv[1]]})).hashSync(process.argv[2],8))" "$NR" "$PW")
  # PORT=1881 bash termux/install.sh  -> run beside another Node-RED that already uses 1880.
  printf "export HOST=0.0.0.0\nexport PORT=%s\nexport NODE_RED_ADMIN_HASH='%s'\n" "${PORT:-1880}" "$HASH" > "$ENV"
  chmod 600 "$ENV"
fi

# Autostart on boot (Termux:Boot) + keep CPU awake; restart Node-RED if it crashes.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-nodered" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/robot"
. "$HOME/robot/.env"
while true; do
  node-red -u "$HOME/robot" -s "$HOME/robot/settings.js" >> "$HOME/robot/node-red.log" 2>&1
  sleep 5
done
BOOT
chmod +x "$HOME/.termux/boot/start-nodered"

. "$ENV"; P=${PORT:-1880}
nohup sh "$HOME/.termux/boot/start-nodered" >/dev/null 2>&1 &
IP=$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')
IP=${IP:-<IP-Wi-Fi-của-máy>}
# Slow phones need well over 10 s for the first start.
OK=; for i in $(seq 60); do curl -s -o /dev/null http://127.0.0.1:$P/ && OK=1 && break; sleep 2; done
if [ -n "$OK" ]; then echo "✅ Node-RED đang chạy."; else echo "⚠️ Chưa chạy sau 2 phút — xem: tail -50 ~/robot/node-red.log"; fi
cat <<MSG
Mở trên các tablet cùng Wi-Fi (Chrome):
  Trang chọn màn hình : http://$IP:$P/
  Màn hình bếp        : http://$IP:$P/station.html?role=bep
  Màn hình robot R1   : http://$IP:$P/robot.html?robot=R1
  Trình soạn (admin)  : http://$IP:$P/admin
MSG
