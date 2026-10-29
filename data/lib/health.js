'use strict';
const dgram = require('dgram');
// MEKONIQ Serve S1 — System health for setup.html tab "Hệ thống" (GET /api/health). Called by the Health function
// node in flows.json on the tick: localIp() (cached 10 s there) + build() -> global 'health'.
// Server IP via a UDP socket "connected" to a non-routed address: connect() only asks the routing table which local
// address it would use, no packet is sent. Not os.networkInterfaces(): Android 11+ blocks netlink for non-root
// processes, so under Termux it returns nothing (termux/install.sh needs a fallback for the same reason).
// Only a private LAN address counts (10/8, 172.16/12, 192.168/16): Valetudo reaches the broker over the LAN, and a phone
// whose default network is mobile data would otherwise report the carrier address (100.64/10 CGNAT included).
// Never carries the MQTT password (setup.html has no login; anyone on the Wi-Fi can open it).
const MQTT_USER = process.env.MQTT_USER || 'valetudo';
const PORT = Number(process.env.PORT) || 1880;
const STARTED = Date.now();
const LAN = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/;

function localIp(cb) {
  let done = false;
  const s = dgram.createSocket('udp4');
  const end = (ip) => { if (done) return; done = true; try { s.close(); } catch (e) {} cb(ip); };
  s.on('error', () => end(null));
  // No route: connect() hands the error to its callback, and the implicitly bound socket then reads 0.0.0.0.
  const addr = () => { try { const a = s.address().address; return LAN.test(a) ? a : null; } catch (e) { return null; } };
  try { s.connect(9, '10.255.255.255', err => end(err ? null : addr())); } catch (e) { end(null); }
}

// firstRun: true from the caller keeps it after lastIp was stored (until restart: one IP seen, not yet known to be fixed).
function build({ ip, lastIp, link, clients, robots, now, started = STARTED, firstRun = false }) {
  ip = ip || null; lastIp = lastIp || null;
  const n = Number(clients);
  return {
    t: now,
    server: { ip, port: PORT, lastIp, ipChanged: ip && lastIp && ip !== lastIp ? { from: lastIp, to: ip } : null,
      firstRun: !!ip && (!lastIp || firstRun), uptimeSec: Math.round((now - started) / 1000) },
    mqtt: { link: !!link, clients: clients == null || !Number.isFinite(n) ? null : n, host: ip, port: 1883, user: MQTT_USER },
    robots: robots || {},
  };
}

// Health node: adapter events for the station's 'ip-changed' alert, from the previous report (undefined after a restart)
// to this one. A restart resolves (the alert saved on disk may be stale; a resolve with no alert is a no-op); a second
// change before the ack re-raises it, so the station never shows an old IP. No IP (Wi-Fi lost): nothing, and the caller
// keeps comparing against the last report that had one.
const ipKey = h => (h && h.server.ipChanged ? h.server.ipChanged.from + '>' + h.server.ipChanged.to : '');
function ipEvents(prev, h) {
  if (!h.server.ip) return [];
  const c = h.server.ipChanged, was = prev ? ipKey(prev) : null;
  if (was === ipKey(h)) return [];
  const out = was === '' ? [] : [{ event: 'resolve', key: 'ip-changed' }];
  if (c) out.push({ event: 'alert', key: 'ip-changed', level: 'error', text: `IP điện thoại đã đổi từ ${c.from} sang ${c.to} — robot và mã QR vẫn trỏ về ${c.from}. Trang Cấu hình → Hệ thống` });
  return out;
}

module.exports = { localIp, build, ipEvents, MQTT_USER, PORT };
