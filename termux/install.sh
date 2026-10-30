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
pkill -f "node-red" 2>/dev/null || true
pkill -x mosquitto 2>/dev/null || true   # restarted by the boot script with the new mosquitto.conf
# An old copy that survives (different cmdline) keeps :1880 and would answer the health check below with the OLD flows.
P=${PORT:-1880}; [ -f "$APP/.env" ] && P=$(sed -n "s/^export PORT=//p" "$APP/.env"); P=${P:-1880}
for i in $(seq 10); do curl -s -o /dev/null "http://127.0.0.1:$P/" || break; sleep 1; done
if curl -s -o /dev/null "http://127.0.0.1:$P/"; then echo "⚠️ Cổng $P vẫn bận — dừng mọi tiến trình node"; pkill -x node 2>/dev/null || true; sleep 3; fi

if ! command -v node-red >/dev/null || ! node -v >/dev/null 2>&1; then
  # Full upgrade, not just `pkg update`: a fresh nodejs on an old libc++ fails with "CANNOT LINK EXECUTABLE node".
  export DEBIAN_FRONTEND=noninteractive
  pkg upgrade -y -o Dpkg::Options::=--force-confnew
  pkg install -y -o Dpkg::Options::=--force-confnew nodejs-lts termux-api
  npm install -g --unsafe-perm node-red@5.0.8
fi
# MQTT broker for the Valetudo robot (devices installed before it was added).
command -v mosquitto >/dev/null || pkg install -y -o Dpkg::Options::=--force-confnew mosquitto

mkdir -p "$APP"
# Preserve the effective old seed if setup.html was never saved. Run only after Node-RED exits;
# a closed HTTP port alone does not mean its final context flush has finished.
for i in $(seq 30); do pgrep -f 'node-red|start-nodered' >/dev/null || break; sleep 1; done
if pgrep -f 'node-red|start-nodered' >/dev/null; then
  echo "Node-RED chưa thoát hẳn — dừng tiến trình trước khi cài lại." >&2
  exit 1
fi
node "$HERE/scripts/preserve-site.js" "$APP"
cp -r "$HERE/data/." "$APP/"
# MQTT: the robot connects over the Wi-Fi on :1883 with a password (anyone on the Wi-Fi could drive it otherwise);
# Node-RED uses an on-device-only listener on :1884 without login. Password made once, kept across reinstalls.
MQTT_USER=valetudo
[ -s "$APP/.mqtt-pass" ] || { head -c 64 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 16 > "$APP/.mqtt-pass"; chmod 600 "$APP/.mqtt-pass"; }
MQTT_PW=$(cat "$APP/.mqtt-pass")
rm -f "$APP/mosquitto.passwd"   # newer mosquitto_passwd refuses -c on an existing file; the secret lives in .mqtt-pass
mosquitto_passwd -b -c "$APP/mosquitto.passwd" "$MQTT_USER" "$MQTT_PW"
chmod 600 "$APP/mosquitto.passwd"
# per_listener_settings: deprecated in Mosquitto 2.1 (warning only), still what 2.0.x needs.
cat > "$APP/mosquitto.conf" <<CONF
per_listener_settings true
listener 1884 127.0.0.1
allow_anonymous true
listener 1883 0.0.0.0
allow_anonymous false
password_file $APP/mosquitto.passwd
log_dest file $APP/mosquitto.log
CONF

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
# MQTT broker watchdog (Android may kill background processes).
( while true; do pgrep -x mosquitto >/dev/null || mosquitto -c "$HOME/robot/mosquitto.conf" -d; sleep 15; done ) &
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
# /api/map exists only in this version: proves the NEW flows answer, not a leftover process.
OK=; for i in $(seq 60); do curl -s "http://127.0.0.1:$P/api/map/_" | grep -q '^{' && OK=1 && break; sleep 2; done
if [ -n "$OK" ]; then echo "✅ Node-RED đang chạy."; else echo "⚠️ Chưa chạy sau 2 phút — xem: tail -50 ~/robot/node-red.log"; fi
cat <<MSG
Mở trên các tablet cùng Wi-Fi (Chrome):
  Trang chọn màn hình : http://$IP:$P/
  Cấu hình (quản lý)  : http://$IP:$P/setup.html
  Màn hình bếp        : http://$IP:$P/station.html?role=bep
  Màn hình robot R1   : http://$IP:$P/robot.html?robot=R1
  Trình soạn (admin)  : http://$IP:$P/admin
MQTT broker cho Valetudo : $IP:1883  user: $MQTT_USER  pass: $MQTT_PW  (xem lại: cat ~/robot/.mqtt-pass)
Đặt IP cố định cho máy này trên router (DHCP reservation) trước khi khai vào Valetudo.
Cấu hình robot Valetudo: ~/bundle/docs/valetudo-setup.md
MSG
true
