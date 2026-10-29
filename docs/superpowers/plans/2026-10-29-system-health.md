# System Health Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Hệ thống" tab in setup.html that reports the phone's IP, MQTT broker state and each real robot's connectivity, with a checklist that names the real cause of a network problem, plus two station alerts (broker down, IP changed).

**Architecture:** Pure logic in `data/lib/health.js` (new) and small additions to `data/lib/valetudo.js` and `data/lib/orchestrator.js`, all unit-tested with fake clocks. `flows.json` gains one Health function node on the tick, one `$SYS` MQTT subscription and two HTTP endpoints (`GET /api/health`, `POST /api/health/ack`). The orchestrator learns two generic adapter events, `alert` and `resolve`; it never sees MQTT or IP. setup.html polls `/api/health` every 3 s and renders the tab from that plus `App.site` / `App.state`.

**Tech Stack:** Node-RED 3 on Termux, plain CommonJS, vanilla HTML/JS, `node:assert` tests, Mosquitto `$SYS` topics.

**Spec:** `trial/docs/superpowers/specs/2026-10-29-system-health-design.md`

## Global Constraints

- No new npm dependencies; `dgram` and `zlib` from Node core only.
- `grep -o "type: *'[a-zA-Z]*'" data/public/*.html | sort -u` is identical before and after: no new WebSocket message types.
- Never return or render the MQTT password anywhere (spec §4, §7.4).
- Server IP via UDP connect, never `os.networkInterfaces()` (spec §7.3).
- Orchestrator accepts adapter `alert` only with `typeof key === 'string'`; level is `'error'` or else `'warn'`; text sliced to 200 chars (spec §3.3).
- All Vietnamese copy in the checklist is taken verbatim from spec §5 table.
- Existing tests stay green: `npm test`. Commit after every task; repo is `trial/`, branch `main`.
- Web demo (`web/`) must still load setup.html with the new tab; `/api/health` failing there shows the fallback strip (spec §4).

## Review Focus

1. Phone has no network route (`localIp` → `null`): `build()` must report `ip: null`, `ipChanged: null`, never compare against `lastIp`. → Task 1 test `ip null`.
2. First boot with no stored `lastIp`: no alert, `firstRun: true`, caller stores the IP. → Task 1 test `first run`.
3. Broker link flapping: the adapter must emit `alert mqtt-down` exactly once per down transition and `resolve` once per up transition, not on every `link` message with the same value. → Task 2 test `link alert once`.
4. Garbage Wi-Fi payloads (`signal` = `''` or `'abc'`, `ips` not JSON): ignored, previous `wifi` kept, no throw. → Task 2 test `wifi garbage`.
5. Adapter `alert` without `key` or with non-string `text`: orchestrator ignores or coerces, never throws, and `ack` from a station removes it like any alert. → Task 3 test `adapter alert`.

---

### Task 1: `lib/health.js` — pure health builder + local IP probe

**Files:**
- Create: `data/lib/health.js`
- Create: `scripts/test-health.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces:
  ```js
  // data/lib/health.js
  const MQTT_USER = process.env.MQTT_USER || 'valetudo';
  const PORT = Number(process.env.PORT) || 1880;
  const STARTED = Date.now();
  function localIp(cb)   // cb(ip: string|null). dgram udp4 socket, connect('10.255.255.255', 9), read socket.address().address, close. Any error → cb(null). Never sends a packet.
  function build({ ip, lastIp, link, clients, robots, now, started = STARTED })
    // → { t: now,
    //     server: { ip, port: PORT, lastIp, ipChanged: {from,to}|null, firstRun: boolean, uptimeSec },
    //     mqtt:   { link: !!link, clients: Number|null, host: ip, port: 1883, user: MQTT_USER },
    //     robots }                                  // passed through from valetudo.health()
    // ipChanged = (ip && lastIp && ip !== lastIp) ? { from: lastIp, to: ip } : null
    // firstRun  = !!ip && !lastIp
  module.exports = { localIp, build, MQTT_USER, PORT };
  ```

- [ ] **Step 1: Write the failing tests** in `scripts/test-health.js`

```js
const assert = require('assert');
const H = require('../data/lib/health');
const base = { link: true, clients: 2, robots: {}, now: 1e12 + 60000, started: 1e12 };
let h = H.build({ ...base, ip: '192.168.1.23', lastIp: '192.168.1.23' });
assert.deepStrictEqual(h.server, { ip: '192.168.1.23', port: H.PORT, lastIp: '192.168.1.23', ipChanged: null, firstRun: false, uptimeSec: 60 });
assert.deepStrictEqual(h.mqtt, { link: true, clients: 2, host: '192.168.1.23', port: 1883, user: H.MQTT_USER });
assert.strictEqual(h.t, base.now);
console.log('✓ steady state');
h = H.build({ ...base, ip: '192.168.1.50', lastIp: '192.168.1.23' });
assert.deepStrictEqual(h.server.ipChanged, { from: '192.168.1.23', to: '192.168.1.50' });
console.log('✓ ip changed');
h = H.build({ ...base, ip: null, lastIp: '192.168.1.23' });
assert.strictEqual(h.server.ipChanged, null); assert.strictEqual(h.server.firstRun, false); assert.strictEqual(h.mqtt.host, null);
console.log('✓ ip null');
h = H.build({ ...base, ip: '192.168.1.23', lastIp: undefined });
assert.strictEqual(h.server.ipChanged, null); assert.strictEqual(h.server.firstRun, true);
console.log('✓ first run');
h = H.build({ ...base, clients: undefined, link: undefined });
assert.strictEqual(h.mqtt.clients, null); assert.strictEqual(h.mqtt.link, false);
console.log('✓ missing broker facts');
assert.ok(!JSON.stringify(h).toLowerCase().includes('pass'));
console.log('✓ no password field');
H.localIp(ip => { assert.ok(ip === null || /^\d+\.\d+\.\d+\.\d+$/.test(ip)); console.log('✓ localIp', ip); console.log('OK — health'); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-health.js`
Expected: `Cannot find module '../data/lib/health'`

- [ ] **Step 3: Implement `data/lib/health.js`** per the Interfaces block. Header comment in the file style of `lib/valetudo.js` (what it is, who calls it, why UDP not `os.networkInterfaces`).

- [ ] **Step 4: Run tests**

Run: `node scripts/test-health.js`
Expected: all ✓ lines and `OK — health`.

- [ ] **Step 5: Add to npm test**

`package.json` → `"test": "node scripts/test.js && node scripts/test-valetudo.js && node scripts/test-site.js && node scripts/test-health.js"`. Run `npm test`, expected green.

- [ ] **Step 6: Commit**

```bash
git add data/lib/health.js scripts/test-health.js package.json
git commit -m "feat(health): health builder + UDP local-ip probe"
```

---

### Task 2: Valetudo adapter — Wi-Fi facts, seen/map timestamps, link alerts, `health()`

**Files:**
- Modify: `data/lib/valetudo.js` (INGESTED list ~line 93, `init` ~95, `ingest` ~269, `handle` case `'link'` ~236, exports ~end)
- Test: `scripts/test-valetudo.js` (append a new block before the final line)

**Interfaces:**
- Consumes: existing `V.init(site)`, `V.handle(st, site, input, now)`.
- Produces:
  ```js
  // per robot in st.robots[id]: seenAt: number|0, mapAt: number|0, wifi: { ips: string[], ssid: string|null, signal: number|null }|null
  // st.link: boolean (default true until a 'link' message says otherwise)
  // handle() events on {cmd:'link'} transitions only:
  //   { event: 'alert', key: 'mqtt-down', level: 'error', text: 'Broker MQTT trong máy không chạy — robot thật không điều khiển được. Mở Termux, chạy lại install hoặc mosquitto -c ~/robot/mosquitto.conf -d' }
  //   { event: 'resolve', key: 'mqtt-down' }
  function health(st, site, now)
    // → { link: st.link, robots: { [id]: { topic, online, status, battery, seenAt, mapAt, wifi } } }   // ours only
  module.exports = { ..., health };
  ```
- MQTT keys ingested: `WifiConfigurationCapability/ips` (JSON array of strings; also accept a bare comma-separated string), `WifiConfigurationCapability/ssid` (string), `WifiConfigurationCapability/signal` (number, dBm). `seenAt = now` on any message under the robot's topic. `mapAt = now` when `parseMapData` returns a `map`.

- [ ] **Step 1: Write the failing tests** (append to `scripts/test-valetudo.js`, before `console.log('OK …')` if present, else at end)

```js
{
  const st = V.init(SITE); let now = 1e12;
  const H = (i) => V.handle(st, SITE, i, now);
  // link alert once per transition
  let ev = H({ cmd: 'link', up: false }).events.filter(e => e.event !== 'telemetry');
  assert.deepStrictEqual(ev.map(e => [e.event, e.key, e.level]), [['alert', 'mqtt-down', 'error']]);
  assert.ok(ev[0].text.startsWith('Broker MQTT trong máy không chạy'));
  assert.deepStrictEqual(H({ cmd: 'link', up: false }).events.filter(e => e.event === 'alert'), []);
  assert.deepStrictEqual(H({ cmd: 'link', up: true }).events.filter(e => e.event !== 'telemetry'), [{ event: 'resolve', key: 'mqtt-down' }]);
  assert.deepStrictEqual(H({ cmd: 'link', up: true }).events.filter(e => e.event === 'resolve'), []);
  assert.strictEqual(V.health(st, SITE, now).link, true);
  // wifi + seenAt + mapAt
  now += 1000; H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '87' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/WifiConfigurationCapability/ips', payload: '["192.168.1.40","fe80::1"]' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/WifiConfigurationCapability/ssid', payload: 'MeKoniq' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/WifiConfigurationCapability/signal', payload: '-58' });
  let h = V.health(st, SITE, now);
  assert.deepStrictEqual(h.robots.R1, { topic: 'valetudo/Bot', online: true, status: 'docked', battery: 87, seenAt: now, mapAt: 0, wifi: { ips: ['192.168.1.40', 'fe80::1'], ssid: 'MeKoniq', signal: -58 } });
  assert.deepStrictEqual(Object.keys(h.robots), ['R1']);
  // wifi garbage ignored
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/WifiConfigurationCapability/signal', payload: 'abc' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/WifiConfigurationCapability/ips', payload: '{not json' });
  assert.deepStrictEqual(V.health(st, SITE, now).robots.R1.wifi, { ips: ['192.168.1.40', 'fe80::1'], ssid: 'MeKoniq', signal: -58 });
  // survives a rebuild (knob edit)
  const st2 = V.init({ ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, arriveCm: 50 } }, SITE.robots[1]] }, st);
  assert.deepStrictEqual(V.health(st2, SITE, now).robots.R1.wifi.ssid, 'MeKoniq');
  assert.strictEqual(V.health(st2, SITE, now).robots.R1.seenAt, now);
  console.log('✓ health: link alerts once, wifi facts, garbage ignored, kept across rebuild');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-valetudo.js`
Expected: FAIL at the link-alert assertion (no `alert` event today) or `V.health is not a function`.

- [ ] **Step 3: Implement** in `data/lib/valetudo.js`
  - `init`: `st.link = old && old.link !== undefined ? old.link : true`; per robot add `seenAt: 0, mapAt: 0, wifi: null`; add `'seenAt', 'mapAt', 'wifi'` to `INGESTED`.
  - `ingest`: set `b.seenAt = now` right after the topic match; in the `MapData/map-data` branch set `b.mapAt = now` when `map`; add the three Wi-Fi keys with the parsing rules from the Interfaces block (`ips`: `JSON.parse` → array of strings, fallback split on `,` and trim, skip empties; `signal`: `Number(v)` must be finite; on any failure leave `b.wifi` untouched; initialise `b.wifi = { ips: [], ssid: null, signal: null }` on the first valid key).
  - `handle` case `'link'`: `const up = !!input.up; if (up !== st.link) events.push(up ? { event: 'resolve', key: 'mqtt-down' } : { event: 'alert', key: 'mqtt-down', level: 'error', text: MQTT_DOWN_TEXT }); st.link = up;` then the existing offline loop when `!up`.
  - `health(st, site, now)` per the Interfaces block; export it.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: green, new ✓ line printed.

- [ ] **Step 5: Commit**

```bash
git add data/lib/valetudo.js scripts/test-valetudo.js
git commit -m "feat(valetudo): wifi facts, seen/map timestamps, mqtt-down alert, health()"
```

---

### Task 3: Orchestrator — generic adapter `alert` / `resolve` events

**Files:**
- Modify: `data/lib/orchestrator.js:447-450` (adapter event dispatch in `handle`)
- Test: `scripts/test.js` (append a block before the final `console.log('OK …')`)

**Interfaces:**
- Consumes: `alert(c, key, level, text, robot)` and `resolve(c, key)` already in the file.
- Produces: adapter input `{ event: 'alert', key: string, level?: 'error'|'warn', text: string }` adds `{ key, level, text, robot: undefined }` to `st.alerts` (deduped by key); `{ event: 'resolve', key }` removes it. Logged nothing. Station `ack` works unchanged.

- [ ] **Step 1: Write the failing test** in `scripts/test.js`

```js
{
  pump({ source: 'adapter', data: { event: 'alert', key: 'mqtt-down', level: 'error', text: 'Broker MQTT trong máy không chạy' } });
  let a = st.alerts.find(a => a.key === 'mqtt-down');
  assert.ok(a && a.level === 'error' && a.robot === undefined && a.text === 'Broker MQTT trong máy không chạy');
  pump({ source: 'adapter', data: { event: 'alert', key: 'mqtt-down', level: 'error', text: 'again' } });
  assert.strictEqual(st.alerts.filter(a => a.key === 'mqtt-down').length, 1);           // dedup by key
  pump({ source: 'adapter', data: { event: 'alert', key: 'ip-changed', level: 'bogus', text: 'x'.repeat(300) } });
  a = st.alerts.find(a => a.key === 'ip-changed'); assert.strictEqual(a.level, 'warn'); assert.strictEqual(a.text.length, 200);
  pump({ source: 'adapter', data: { event: 'alert', text: 'no key' } });                 // ignored
  pump({ source: 'adapter', data: { event: 'alert', key: 'k2', text: 42 } });            // coerced
  assert.strictEqual(st.alerts.find(a => a.key === 'k2').text, '42');
  pump({ source: 'adapter', data: { event: 'resolve', key: 'mqtt-down' } });
  assert.ok(!st.alerts.some(a => a.key === 'mqtt-down'));
  send({ type: 'ack', alert: st.alerts.find(a => a.key === 'ip-changed').id });
  assert.ok(!st.alerts.some(a => a.key === 'ip-changed'));
  pump({ source: 'adapter', data: { event: 'resolve', key: 'k2' } });
  console.log('✓ adapter alert / resolve events');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test.js`
Expected: FAIL `a && a.level === 'error'` (alert not created).

- [ ] **Step 3: Implement** the two `else if` lines from spec §3.3 in `handle()` after the `'log'` branch.

- [ ] **Step 4: Run tests**

Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add data/lib/orchestrator.js scripts/test.js
git commit -m "feat(orchestrator): generic adapter alert/resolve events"
```

---

### Task 4: Flows + settings — Health node, `$SYS` subscription, HTTP endpoints

**Files:**
- Modify: `data/flows.json` (add nodes; wire `tick` → `health_fn`; `health_fn` → `orch`)
- Modify: `data/settings.js:12` (`functionGlobalContext.mekoniq.health = require("./lib/health")`)
- Modify: `docs/valetudo-setup.md` (§5 table rows for the two new alerts; §6 checklist line "Trang Cấu hình → Hệ thống: Mọi thứ bình thường")

**Interfaces:**
- Consumes: `health.localIp`, `health.build` (Task 1); `valetudo.health` (Task 2) via `flow.get('val')`; orchestrator adapter events (Task 3).
- Produces: `global 'health'` (default store) = `build()` output; `global 'lastIp'` (default store); `global 'mqttClients'` (memory store); `GET /api/health` → JSON, `Cache-Control: no-store`, 503 `{ error: 'not ready' }` before the first tick; `POST /api/health/ack` → `{ ok: true }` and `lastIp := health.server.ip` (400 `{ error: 'no ip' }` if `ip` is null).

New nodes (ids are the contract; implementer picks x/y):

| id | type | detail |
|---|---|---|
| `health_fn` | function "Health" | input from `tick`; output 1 → `orch`. Body: read `flow.get('val')`, `global.get('lastIp')`, `global.get('mqttClients', 'memory')`; IP cached in `flow 'ip'` + `flow 'ipAt'`, refreshed via `H.localIp` when older than 10 s (async: `node.send` + `node.done`, `return null`); `h = H.build({...})`; if `h.server.firstRun` → `global.set('lastIp', h.server.ip)`; `global.set('health', h)`; compare `!!h.server.ipChanged` with previous `global health` and emit `{topic:'adapter', payload:{event:'alert', key:'ip-changed', level:'error', text: 'IP điện thoại đã đổi từ <from> sang <to> — robot và mã QR vẫn trỏ về <from>. Trang Cấu hình → Hệ thống'}}` or `{event:'resolve', key:'ip-changed'}` on transitions only. |
| `sys_in` | mqtt in | broker `mqtt_broker`, topic `$SYS/broker/clients/connected`, datatype utf8 → `sys_fn` |
| `sys_fn` | function | `global.set('mqttClients', Number(msg.payload), 'memory'); return null;` |
| `health_in` | http in | GET `/api/health` → `health_out_fn` → `health_res` (http response) |
| `health_out_fn` | function | as Interfaces; mirror `map_fn` style |
| `ack_in` | http in | POST `/api/health/ack` → `ack_fn` → `health_res` |
| `ack_fn` | function | as Interfaces |

- [ ] **Step 1: Edit `settings.js`** to expose `health`.
- [ ] **Step 2: Add the nodes to `flows.json`** with a small Python script (load → append → dump with `indent=1`, keep existing node order), and add `'health_fn'` to the `tick` node's wires.
- [ ] **Step 3: Verify JSON + tests**

Run: `python3 -c "import json;json.load(open('data/flows.json'))" && npm test` → no error, green.

- [ ] **Step 4: Live check (Mac)**

```bash
mosquitto -p 1884 -d; npm start &   # or the project's usual start
sleep 6; curl -s localhost:1880/api/health | python3 -m json.tool
```
Expected: `server.ip` is the Mac's LAN IP, `server.firstRun` false on the second call, `mqtt.link` true, `mqtt.clients` ≥ 1 within 10 s (Mosquitto `$SYS` interval), `robots` `{}` with the demo site. Then `pkill mosquitto`; within 10 s `curl …/api/health` shows `"link": false` and `curl -s localhost:1880/ws` is not needed: open `station.html` and see the red strip "Broker MQTT trong máy không chạy…". Restart mosquitto → strip disappears without Đã biết.
Then simulate IP change: in the Node-RED editor's context sidebar set global `lastIp` to `1.2.3.4` (or `curl -X POST …/api/health/ack` after editing); expect `ipChanged` and the `ip-changed` alert; `curl -X POST localhost:1880/api/health/ack` → `{"ok":true}` → alert gone.

- [ ] **Step 5: Docs** rows in `docs/valetudo-setup.md` §5 and §6 as listed in Files.

- [ ] **Step 6: Commit**

```bash
git add data/flows.json data/settings.js docs/valetudo-setup.md
git commit -m "feat(flows): health node, \$SYS clients, GET /api/health, POST /api/health/ack"
```

---

### Task 5: setup.html — tab "Hệ thống"

**Files:**
- Modify: `data/public/setup.html` (`TABS` line 185; new `<section id="tab-system" class="tab" hidden>` after `#tab-backup`; `render()` dispatch line 212-216; `connect` handler line 454; CSS block for the tab)
- Modify: `web/` via `npm run web` (export) — verify, no hand edits except re-export
- Test: manual checklist below (no unit test; all logic is rendering)

**Interfaces:**
- Consumes: `GET /api/health` (Task 4 shape = spec §4), `App.site`, `App.state.robots[].offline`, `dirty`, existing helpers `APPBAR`, `setHTML`, `esc`, `toast`, `clock`, `pname`.
- Produces in setup.html:
  ```js
  let health = null, healthErr = false, healthTimer = null;
  async function pollHealth()      // fetch('/api/health', {cache:'no-store'}); on ok → health = json, healthErr = false; on error/!ok → healthErr = true; then if (tab === 'system') renderSystem()
  function checks()                // → [{ level: 'error'|'warn'|'info'|'ok', text, hint }] using spec §5 table rows 1–9 in that order; empty → [{level:'ok', text:'Mọi thứ bình thường'}]
  function renderSystem()          // blocks (a) checks, (b) server, (c) "Điền vào Valetudo", (d) real robots — spec §5
  ```
  Polling starts when the tab is first shown and keeps running every 3 s for the page lifetime (one `setInterval`). Ack button → `fetch('/api/health/ack', {method:'POST'})` then `pollHealth()`. Copy button → select the `<pre id="mqttCfg">` contents, `document.execCommand('copy')`, toast `'Đã chép'` or `'Chọn chữ rồi chép tay'`.

Markup contract (ids the manual test looks for): `#sysChecks`, `#sysServer`, `#mqttCfg`, `#copyMqtt`, `#ackIp` (hidden unless `ipChanged`), `#sysRobots`, `#sysOffline` (the fallback strip, hidden unless `healthErr`).

Checklist copy rules (spec §5): robot "mất kết nối {X} phút" uses `Math.round((Date.now() - App.skew - r.lastSeen)/60000)` only if `lastSeen` is in the snapshot; otherwise omit the duration. Row 4 fires when `health.robots[R].online && health.robots[R].mapAt === 0`. Row 5 counts `Object.values(App.site.points).filter(p => p.kind === 'table')` minus keys of `r.valetudo.points`. Row 7 hidden when `clients === null`.

Layout: `#tab-system` is a 2-column grid (`1fr 1fr`, gap 16) at ≥ 900 px: left column (a) then (c); right column (b) then (d). Portrait: single column, page scrolls. All cards use `.card`; checks reuse the `.good` / `.bad` colour rule from `map.html` moved into this page's `<style>` (not brand.css; only this page and map.html use it — leave map.html alone).

- [ ] **Step 1: Add the tab** (`TABS.system = 'Hệ thống'`, section markup with the ids above, `render()` dispatch, start polling on first `renderSystem()`).
- [ ] **Step 2: Implement `checks()`, `renderSystem()`, `pollHealth()`, ack and copy handlers.**
- [ ] **Step 3: Manual verification (Node-RED on Mac, 1280×800 then 800×1280 in devtools)**

| Case | Expected |
|---|---|
| Demo site, broker up | (a) one green line "Mọi thứ bình thường"; (b) shows Mac IP:1880, `location.host`, uptime; (c) Host/Port/Username + password hint; (d) "Site này chỉ có robot mô phỏng" |
| `pkill mosquitto` | within 10 s row 2 red; station strip red; restart → both clear |
| `fake-valetudo.js` + R1 set to Robot thật with topic `valetudo/Bot`, saved | (d) card: online pill, docked, 87 %, "nhận tin cuối 1 giây trước" counting; "bản đồ cuối" after the fake publishes a map; `Mở Valetudo ↗` hidden until `ips` arrives |
| `mosquitto_pub -p 1884 -t valetudo/Bot/WifiConfigurationCapability/ips -m '["192.168.1.40"]'` and `…/signal -m -75` | button href `http://192.168.1.40`, row 6 yellow "-75 dBm" |
| Stop fake | after 3 s row 3 red with the Mac IP in the hint |
| Site with 12 tables, R1 taught 10 | row 5 yellow listing the 2 missing names |
| Edit a field without saving | row 8 info |
| Set global `lastIp` to `1.2.3.4` | row 1 red with both IPs, `#ackIp` visible; click → row gone, station alert gone |
| 800×1280 | single column, no horizontal scroll, app bar shows 5 tabs on one line |
| `npm run web`, open `web/demo/setup.html?tab=system` via `npx serve web` | `#sysOffline` strip "Chỉ có khi chạy trên máy nhà hàng", rows 5/8 still computed, no console errors |
| `grep -o "type: *'[a-zA-Z]*'" data/public/*.html \| sort -u` | identical to before Task 5 |

- [ ] **Step 4: Re-export web and commit both repos**

```bash
npm run web
git add data/public/setup.html && git commit -m "ui(setup): Hệ thống tab — checks, server, MQTT facts, real robots"
cd ../web && git add -A && git commit -m "web: export setup.html with Hệ thống tab"
```
