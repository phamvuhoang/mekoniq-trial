'use strict';
const dgram = require('dgram');
// MEKONIQ Serve S1 — System health for setup.html tab "Hệ thống" (GET /api/health). Called by the Health function
// node in flows.json on the tick: localIp() (cached 10 s there) + build() -> global 'health'.
// Server IP via a UDP socket "connected" to a non-routed address: connect() only asks the routing table which local
// address it would use, no packet is sent. Not os.networkInterfaces(): Android 11+ blocks netlink for non-root
// processes, so under Termux it returns nothing (termux/install.sh needs a fallback for the same reason).
// Never carries the MQTT password (setup.html has no login; anyone on the Wi-Fi can open it).
const MQTT_USER = process.env.MQTT_USER || 'valetudo';
const PORT = Number(process.env.PORT) || 1880;
const STARTED = Date.now();

function localIp(cb) {
  let done = false;
  const s = dgram.createSocket('udp4');
  const end = (ip) => { if (done) return; done = true; try { s.close(); } catch (e) {} cb(ip); };
  s.on('error', () => end(null));
  // No route: connect() hands the error to its callback, and the implicitly bound socket then reads 0.0.0.0.
  const addr = () => { try { const a = s.address().address; return a && a !== '0.0.0.0' ? a : null; } catch (e) { return null; } };
  try { s.connect(9, '10.255.255.255', err => end(err ? null : addr())); } catch (e) { end(null); }
}

function build({ ip, lastIp, link, clients, robots, now, started = STARTED }) {
  ip = ip || null; lastIp = lastIp || null;
  const n = Number(clients);
  return {
    t: now,
    server: { ip, port: PORT, lastIp, ipChanged: ip && lastIp && ip !== lastIp ? { from: lastIp, to: ip } : null,
      firstRun: !!ip && !lastIp, uptimeSec: Math.round((now - started) / 1000) },
    mqtt: { link: !!link, clients: clients == null || !Number.isFinite(n) ? null : n, host: ip, port: 1883, user: MQTT_USER },
    robots: robots || {},
  };
}

// Health node: adapter events for the station's 'ip-changed' alert, from the previous report (undefined after a restart)
// to this one. A restart resolves (the alert saved on disk may be stale; a resolve with no alert is a no-op); a second
// change before the ack re-raises it, so the station never shows an old IP.
const ipKey = h => (h && h.server.ipChanged ? h.server.ipChanged.from + '>' + h.server.ipChanged.to : '');
function ipEvents(prev, h) {
  const c = h.server.ipChanged, was = prev ? ipKey(prev) : null;
  if (was === ipKey(h)) return [];
  const out = was === '' ? [] : [{ event: 'resolve', key: 'ip-changed' }];
  if (c) out.push({ event: 'alert', key: 'ip-changed', level: 'error', text: `IP điện thoại đã đổi từ ${c.from} sang ${c.to} — robot và mã QR vẫn trỏ về ${c.from}. Trang Cấu hình → Hệ thống` });
  return out;
}

module.exports = { localIp, build, ipEvents, MQTT_USER, PORT };
