# Valetudo MQTT Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive a real Valetudo robot from the existing Mission Orchestrator over MQTT, side by side with the simulator, deployable to the partner's Android/Termux phone.

**Architecture:** New pure module `data/lib/valetudo.js` implements the adapter contract (`cmd goto/stop/resume` in, `event telemetry/arrived` out) and additionally returns MQTT publishes. Node-RED routes orchestrator cmds to simulator or Valetudo adapter by `robot.driver`; one `mqtt in` (`#`) feeds the adapter, one `mqtt out` publishes. Mosquitto runs in Termux next to Node-RED.

**Tech Stack:** Node.js (CommonJS), Node-RED 5.0.8 core nodes (`mqtt-broker`, `mqtt in/out`, `switch`, `function`), Mosquitto 2.x, Node `zlib`, `node:assert` tests via `scripts/test.js`.

**Spec:** `docs/superpowers/specs/2026-10-27-valetudo-mqtt-adapter-design.md`

## Global Constraints

- `data/lib/orchestrator.js` is not modified.
- Adapter contract unchanged: telemetry robot shape `{id, x, y, battery, moving, blocked, nav, why, path, rem}`; `{event:'arrived', robot, token}`.
- Valetudo topics under `<robot.valetudo.topic>/…`: `GoToLocationCapability/go/set` payload `{"coordinates":{"x":<int>,"y":<int>}}`; `BasicControlCapability/operation/set` payload `HOME|STOP|PAUSE|START`; reads `StatusStateAttribute/status|flag|error_description`, `BatteryStateAttribute/level`, `$state`, `MapData/map-data` (zlib-deflated JSON).
- Valetudo coordinates are **cm**, y down; site coordinates are **m**.
- Defaults: `arriveCm = 40`, status ignore window after a command `1500 ms`, STOP→idle wait max `3000 ms`.
- Redirect rule: if robot status is `moving`/`returning` when a new goal arrives → publish `STOP`, wait for `idle` (≤ 3 s), then publish the goal. Latest goal wins; no second STOP while already waiting.
- Repo `data/site.json` keeps all three robots on the simulator (`scripts/test.js` and `smoke-test.js` depend on it). Partner values (`driver`, `valetudo.topic`, `valetudo.points`) are edited on the device.
- Tests: `npm test` must stay green; no new test framework.
- Commit after every task (`git -C trial`).

## Review Focus

1. Goal already reached (robot standing at the target, status never leaves `idle`) → must emit `arrived` right after the goto, not hang. Test in Task 3.
2. Stale `idle` arriving within 1.5 s after `go/set` → must not be treated as "trip ended". Test in Task 3.
3. `map-data` payload that is not valid zlib / has no `robot_position` entity → ignore, keep last position, no throw. Test in Task 4.
4. Goto to an un-calibrated point id → `blocked:true, why:'noroute'` until the next cmd; no MQTT publish. Test in Task 2.
5. `$state lost` or no MQTT message for the robot since start → robot absent from telemetry so the orchestrator raises its own offline alert. Test in Task 2.

---

### Task 1: Coordinate mapping (`fit`, `toSite`)

**Files:**
- Create: `data/lib/valetudo.js`
- Create: `scripts/test-valetudo.js` (run from `npm test`, see Step 5)

**Interfaces:**
- Produces: `fit(pairs: Array<{site:{x,y}, robot:{x,y}}>) -> {a,b,tx,ty} | null` — similarity transform robot(cm) → site(m): `X = a*x - b*y + tx`, `Y = b*x + a*y + ty`, least squares; `null` when fewer than 2 pairs.
- Produces: `toSite(T, p:{x,y}) -> {x,y}` rounded to 0.01 m.
- Produces: `calib(site) -> {T, points}` where `points = site.valetudo?.points || {}` and `T = fit(pairs built from ids present in both site.points and points)`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/test-valetudo.js
const assert = require('assert');
const V = require('../data/lib/valetudo');
// robot cm = site m * 100, rotated 90° (x_r = y_m*100, y_r = -x_m*100), shifted by (1000, 3000)
const pairs = [{ site: { x: 3, y: 11.5 }, robot: { x: 1000 + 1150, y: 3000 - 300 } },
               { site: { x: 11.5, y: 4.5 }, robot: { x: 1000 + 450, y: 3000 - 1150 } }];
const T = V.fit(pairs);
assert.deepStrictEqual(V.toSite(T, { x: 1000 + 800, y: 3000 - 1450 }), { x: 14.5, y: 8 });
assert.strictEqual(V.fit(pairs.slice(0, 1)), null);
console.log('✓ fit/toSite');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-valetudo.js` — Expected: `Cannot find module '../data/lib/valetudo'`

- [ ] **Step 3: Implement `fit`, `toSite`, `calib` in `data/lib/valetudo.js`**

Closed-form least squares for the 4 unknowns (standard 2-D similarity / Umeyama without reflection). Header comment mirrors `simulator.js` style: what the adapter does, the Valetudo topics, the `ponytail:` notes.

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/test-valetudo.js` — Expected: `✓ fit/toSite`

- [ ] **Step 5: Wire into `npm test`**

In `package.json` set `"test": "node scripts/test.js && node scripts/test-valetudo.js"`. Run `npm test` — Expected: existing scenarios print `✓`, then `✓ fit/toSite`.

- [ ] **Step 6: Commit**

```bash
git add data/lib/valetudo.js scripts/test-valetudo.js package.json
git commit -m "feat(valetudo): coordinate fit robot cm -> site m"
```

---

### Task 2: Adapter state, MQTT ingest, telemetry tick, goto/stop/resume publishes

**Files:**
- Modify: `data/lib/valetudo.js`
- Modify: `scripts/test-valetudo.js`

**Interfaces:**
- Produces: `init(site) -> state` with `state.robots[id]` for every robot whose `driver === 'valetudo'`: `{ topic, dock, status:null, flag:null, err:null, battery:null, pos:null, online:false, goal:null, pending:null, sentAt:0, blocked:false, why:null }`.
- Produces: `handle(state, site, input, now) -> { events: adapterEvent[], mqtt: {topic:string, payload:string}[] }`
  - `input` is an orchestrator cmd, `{cmd:'tick'}`, or `{cmd:'mqtt', topic, payload:string|Buffer}`.
- Produces: `arriveCm(site, r) = r.valetudo.arriveCm ?? 40`.
- Test fixture `SITE` (inline in test file): points `kitchen (3,11.5)`, `T01 (11.5,4.5)`, `T06 (14.5,8)`, `D1 (7.5,1.2)`; robots `[{id:'R1', dock:'D1', driver:'valetudo', valetudo:{topic:'valetudo/Bot'}}, {id:'R2', dock:'D1'}]`; `valetudo.points` = `{kitchen:{x:2150,y:2700}, T01:{x:1450,y:1850}}` (consistent with Task 1's transform).

- [ ] **Step 1: Write the failing tests**

```js
const st = V.init(SITE); let now = 1e12;
const H = (i) => V.handle(st, SITE, i, now);
assert.deepStrictEqual(Object.keys(st.robots), ['R1']);                        // R2 is not ours
assert.deepStrictEqual(H({ cmd: 'tick' }).events, [{ event: 'telemetry', robots: [] }]);   // nothing heard yet -> absent
H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '87' });
let t = H({ cmd: 'tick' }).events[0].robots[0];
assert.deepStrictEqual(t, { id: 'R1', x: 7.5, y: 1.2, battery: 87, moving: false, blocked: false, nav: 'idle', why: null, path: [], rem: 0 }); // no position yet -> dock
let r = H({ cmd: 'goto', robot: 'R1', to: 'kitchen', x: 3, y: 11.5, token: 1 });
assert.deepStrictEqual(r.mqtt, [{ topic: 'valetudo/Bot/GoToLocationCapability/go/set', payload: '{"coordinates":{"x":2150,"y":2700}}' }]);
assert.strictEqual(H({ cmd: 'tick' }).events[0].robots[0].nav, 'moving');
assert.deepStrictEqual(H({ cmd: 'stop', robot: 'R1' }).mqtt, [{ topic: 'valetudo/Bot/BasicControlCapability/operation/set', payload: 'STOP' }]);
now += 2000;
assert.strictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt[0].payload, '{"coordinates":{"x":2150,"y":2700}}');   // resend goal
r = H({ cmd: 'goto', robot: 'R1', to: 'T06', x: 14.5, y: 8, token: 2 });                 // not calibrated
assert.deepStrictEqual(r.mqtt, []);
t = H({ cmd: 'tick' }).events[0].robots[0];
assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'noroute');
now += 2000;
assert.strictEqual(H({ cmd: 'goto', robot: 'R1', to: 'D1', x: 7.5, y: 1.2, token: 3 }).mqtt[0].payload, 'HOME');
assert.strictEqual(H({ cmd: 'tick' }).events[0].robots[0].blocked, false);
H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'lost' });
assert.deepStrictEqual(H({ cmd: 'tick' }).events[0].robots, []);
assert.deepStrictEqual(H({ cmd: 'map', map: {}, v: 2 }), { events: [], mqtt: [] });       // ignored
console.log('✓ ingest / telemetry / publishes');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-valetudo.js` — Expected: `V.init is not a function`

- [ ] **Step 3: Implement `init`, `handle` (cmds `goto|stop|resume|map|obstacle|sim|reset|tick|mqtt`)**

- `mqtt`: match `topic` against each robot's `valetudo.topic + '/'`; dispatch on the suffix. `$state`: `online = payload === 'ready'`. Payload is `String(payload)`.
- `goto`: `goal = {to, token, home: to === dock, coords: points[to]}`. No coords and not home → `blocked=true, why='noroute'`, no publish. Otherwise set `sentAt = now` and publish via a helper `send(r, goal) -> mqtt msg` (`HOME` or `go/set`). Redirect/STOP-wait logic is Task 3; here publish immediately.
- `stop`: publish `STOP`, `paused = true`. `resume`: `paused = false`, `send(goal)` if any.
- `tick`: one telemetry event; robot included only if `online && status !== null`. `x,y` = `toSite(T, pos)` when `pos` and `T`, else dock point from `site.points[dock]`. `moving = !!goal && !paused && status in ('moving','returning')`, `nav = moving ? 'moving' : 'idle'`.
- `map/obstacle/sim`: return empty. `reset`: clear `goal/pending/blocked` of every robot, no publish.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test` — Expected: all `✓`.

- [ ] **Step 5: Commit**

```bash
git add data/lib/valetudo.js scripts/test-valetudo.js
git commit -m "feat(valetudo): adapter state, mqtt ingest, telemetry, goto/stop/resume"
```

---

### Task 3: Trip end detection, blocked, redirect (STOP → idle → resend)

**Files:**
- Modify: `data/lib/valetudo.js`
- Modify: `scripts/test-valetudo.js`

**Interfaces:**
- Consumes: Task 2 state fields; adds `r.pending = { goal } | null` (goal waiting for idle) and `r.pendingSince`.
- Produces: `arrived` events `{event:'arrived', robot, token}`; `blocked:true, why:'object'` on bad stop / error; helper `near(site, r) -> boolean` (distance in cm between `r.pos` and `goal.coords` ≤ `arriveCm`).

- [ ] **Step 1: Write the failing tests**

Setup per sub-case: fresh `init`, `$state ready`, status `docked`, battery `90`. Position is injected by calling an exported test seam `V._setPos(st, 'R1', {x, y})` (cm) — simpler than crafting zlib payloads here; Task 4 covers map-data.

```js
// a) normal trip: idle after moving, near target -> arrived with token
goto kitchen token 1; mqtt status 'moving'; now += 3000; _setPos(2160, 2690); mqtt status 'idle'
assert.deepStrictEqual(ev, [{ event: 'arrived', robot: 'R1', token: 1 }]); goal cleared; tick -> moving:false, blocked:false
// b) stale idle within 1.5 s is ignored
goto T01 token 2; now += 500; mqtt status 'idle' -> no arrived; tick nav 'moving'
// c) stops far away -> blocked 'object'; resume resends go/set; later arrives
now += 3000; _setPos(3000, 3000); mqtt status 'idle' -> no arrived; tick blocked:true, why:'object'
resume -> mqtt go/set T01; mqtt 'moving'; now += 3000; _setPos(1455, 1850); mqtt 'idle' -> arrived token 2, blocked false
// d) error_description != 'No error' -> blocked 'object'; back to 'No error' -> false
// e) HOME: goto D1 token 3; mqtt 'returning'; now += 3000; mqtt 'docked' -> arrived token 3 (no position check)
// f) already there: _setPos(2150, 2700); status 'idle'; goto kitchen token 4 -> arrived immediately, no publish
// g) redirect: status 'moving' with goal T01 token 5 -> goto kitchen token 6 => mqtt [STOP] only; mqtt status 'idle' now+1000 => mqtt [go/set kitchen]; no 'arrived' for token 5 or 6 from that idle
// h) redirect timeout: as g) but no idle; now += 3000; tick => mqtt [go/set kitchen]
// i) second goto while pending (token 7 to T01) replaces pending, no extra STOP; idle -> go/set T01
// j) no position at all (pos null): moving -> idle after 3 s -> arrived (trust status)
console.log('✓ trip end / blocked / redirect');
```

Write each as explicit asserts on `handle(...)` return values (same style as Task 2).

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-valetudo.js` — Expected: assertion failure in (a) (no `arrived`).

- [ ] **Step 3: Implement in `data/lib/valetudo.js`**

- In `goto`: if `status ∈ {moving, returning}` or `pending` → set `pending = {goal}`, `pendingSince = now`; publish `STOP` only when `pending` was previously null. Else if `near()` and not home → emit `arrived` immediately, no publish. Else publish.
- On status message: ignore if `now - sentAt < 1500`. If `pending` and status `idle|docked|paused` → publish pending goal, `pending=null`, `sentAt=now`. Else if `goal` and previous status ∈ `{moving, returning}` and new status ∈ `{idle, docked, error, paused}`: home&&docked → arrived; `!pos` → arrived; `near()` → arrived; else `blocked=true, why='object'`. On arrived: `goal=null, blocked=false`.
- On `tick`: if `pending && now - pendingSince >= 3000` → publish pending goal anyway.
- `error_description`: `err = payload !== 'No error' ? payload : null`; `blocked = !!err || blockedByStop`. Keep a single `blocked` boolean plus `why`; error clears → recompute.
- `resume`: clears `blocked` when `why === 'object'`, resends goal.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test` — Expected: all `✓`.

- [ ] **Step 5: Commit**

```bash
git add data/lib/valetudo.js scripts/test-valetudo.js
git commit -m "feat(valetudo): arrival detection, blocked, stop-wait-resend redirect"
```

---

### Task 4: Robot position from `MapData/map-data`

**Files:**
- Modify: `data/lib/valetudo.js`
- Modify: `scripts/test-valetudo.js`

**Interfaces:**
- Produces: `parseMap(payload: Buffer|string) -> {x, y, angle} | null` — `zlib.inflateSync`, JSON, find `entities[].type === 'robot_position'`, `points: [x, y]`, `metaData.angle`. Returns `null` on any failure (bad zlib, bad JSON, missing entity).
- `handle` on topic suffix `MapData/map-data` → `pos = parseMap(payload) || pos`.

- [ ] **Step 1: Write the failing tests**

```js
const zlib = require('zlib');
const map = { entities: [{ type: 'charger_location', points: [1, 2] }, { type: 'robot_position', points: [1455, 1848], metaData: { angle: 90 } }] };
assert.deepStrictEqual(V.parseMap(zlib.deflateSync(JSON.stringify(map))), { x: 1455, y: 1848, angle: 90 });
assert.strictEqual(V.parseMap(Buffer.from('not zlib')), null);
assert.strictEqual(V.parseMap(zlib.deflateSync('{"entities":[]}')), null);
// through handle: pos updated, bad payload keeps the old pos
console.log('✓ map-data position');
```

- [ ] **Step 2: Run to verify it fails** — Expected: `V.parseMap is not a function`.

- [ ] **Step 3: Implement `parseMap`; use `require('zlib')` inside `valetudo.js`** (plain Node module loaded by `settings.js`, so no `functionGlobalContext` change needed). Remove the `_setPos` seam only if Task 3 tests are rewritten to use `parseMap`; otherwise keep it, exported under `_setPos`.

- [ ] **Step 4: Run** `npm test` — Expected: all `✓`.

- [ ] **Step 5: Commit**

```bash
git add data/lib/valetudo.js scripts/test-valetudo.js
git commit -m "feat(valetudo): robot position from deflated map-data"
```

---

### Task 5: Simulator skips non-sim robots

**Files:**
- Modify: `data/lib/simulator.js:22-29` (`init`)
- Modify: `scripts/test-valetudo.js`

**Interfaces:**
- `S.init(site)` only creates `sim.robots[id]` for robots with `!driver || driver === 'sim'`.

- [ ] **Step 1: Write the failing test** (in `test-valetudo.js`, using `SITE` from Task 2)

```js
const S = require('../data/lib/simulator');
assert.deepStrictEqual(Object.keys(S.init(SITE).robots), ['R2']);
console.log('✓ simulator ignores valetudo robots');
```

- [ ] **Step 2: Run** — Expected: assertion `['R1','R2'] !== ['R2']`.
- [ ] **Step 3: Implement** one `if` in `init`'s loop. Check `handle` paths that iterate `site.robots` (none do; they iterate `sim.robots`).
- [ ] **Step 4: Run** `npm test` — Expected: all `✓` (existing scenarios still see R1–R3 since repo `site.json` has no `driver`).
- [ ] **Step 5: Commit** `git commit -am "fix(sim): only simulate robots without a driver"`.

---

### Task 6: Node-RED wiring + local end-to-end with a fake robot

**Files:**
- Modify: `data/flows.json`
- Modify: `data/settings.js:11-13` (add `valetudo: require("./lib/valetudo")` to `mekoniq`)
- Modify: `data/site.json` (add top-level `"valetudo": { "points": {} }`; robots unchanged)
- Create: `scripts/fake-valetudo.js`
- Modify: `data/public/index.html:33` (text: `Robot Adapter (simulator / Valetudo)`)

**Interfaces:**
- Flow nodes (ids fixed so later edits can target them):
  - `mqtt_broker` (`mqtt-broker`, `broker: "127.0.0.1"`, `port: "1883"`, `clientid: ""`, `autoConnect: true`, `protocolVersion: "4"`).
  - `mqtt_in` (`mqtt in`, `topic: "#"`, `qos: "0"`, `datatype: "buffer"`, `broker: "mqtt_broker"`) → `val`.
  - `route` (`function` "Route cmd by driver", 2 outputs → `[['sim'], ['val']]`): `const { site } = global.get('mekoniq'); const d = site.robots.find(r => r.id === msg.payload.robot); if (!msg.payload.robot) return [msg, msg]; return d && d.driver === 'valetudo' ? [null, msg] : [msg, null];` — cmds without `robot` (`map`, `reset`, `obstacle`) go to both adapters. (A `switch` node cannot look the driver up, hence a function.)
  - `val` (`function` "Robot Adapter (Valetudo)", 2 outputs → `[['orch'], ['mqtt_out']]`): body mirrors `sim` node: `const { valetudo: V, site } = global.get('mekoniq'); const st = flow.get('val') || V.init(site); const input = msg.topic === 'tick' ? { cmd: 'tick' } : Buffer.isBuffer(msg.payload) || typeof msg.payload === 'string' ? { cmd: 'mqtt', topic: msg.topic, payload: msg.payload } : msg.payload; const r = V.handle(st, site, input, Date.now()); flow.set('val', st); return [r.events.map(e => ({ topic: 'adapter', payload: e })), r.mqtt.map(m => ({ topic: m.topic, payload: m.payload }))];`
  - `mqtt_out` (`mqtt out`, `topic: ""`, `qos: "0"`, `retain: false`, `broker: "mqtt_broker"`).
  - `orch.wires[1]` → `['route']`; `tick.wires` → `['sim','val']`.
- `scripts/fake-valetudo.js [topic=valetudo/Bot]`: connects to `mqtt://127.0.0.1:1883` (uses `require('mqtt')` resolved from `node_modules` — it is a Node-RED dependency; if not hoisted, `npm i -D mqtt@5`), publishes `$state ready`, status `docked`, battery `95` every 2 s; on `go/set` publishes status `moving`, after 4 s sets its position to the requested coords and publishes `idle` plus a deflated `map-data` with `robot_position`; on `HOME` publishes `returning` then `docked` after 4 s; on `STOP` publishes `idle`.

- [ ] **Step 1: Edit `flows.json`, `settings.js`, `site.json`, `index.html` as above.** Validate: `node -e "JSON.parse(require('fs').readFileSync('data/flows.json'))"`.

- [ ] **Step 2: Write `scripts/fake-valetudo.js`** (≈40 lines, no tests; it is a dev tool).

- [ ] **Step 3: Local run with a Valetudo-configured copy of site.json**

```bash
brew install mosquitto && mosquitto -p 1883 -d
cp data/site.json /tmp/site.sim.json
# temporarily set in data/site.json: robots[0] = {"id":"R1","dock":"D1","driver":"valetudo","valetudo":{"topic":"valetudo/Bot"}}
#   and valetudo.points = {"kitchen":{"x":2150,"y":2700},"T01":{"x":1450,"y":1850},"T05":{"x":1450,"y":2200}}
npm start &   # http://127.0.0.1:1880
node scripts/fake-valetudo.js
```
Open `http://127.0.0.1:1880/station.html?role=bep`, pick robot R1, deliver to T01. Expected: Node-RED debug/`mosquitto_sub -t '#' -v` shows `go/set {"coordinates":{"x":2150,"y":2700}}`, robot screen plays `load` after ~4 s, confirm, then `go/set` T01, `arrived`, confirm, then `HOME`, dock. Also: cancel mid-trip → `STOP` then `go/set` kitchen after fake publishes `idle`.

- [ ] **Step 4: Restore `data/site.json`** (`cp /tmp/site.sim.json data/site.json`), run `npm run smoke` against the still-running Node-RED (restart it first) — Expected: `OK live round trip via R1`.

- [ ] **Step 5: Commit**

```bash
git add data/flows.json data/settings.js data/site.json data/public/index.html scripts/fake-valetudo.js
git commit -m "feat: route cmds to Valetudo adapter via MQTT; fake robot for local tests"
```

---

### Task 7: Termux installer with Mosquitto + operator runbook

**Files:**
- Modify: `termux/install.sh`
- Create: `docs/valetudo-setup.md` (Vietnamese, for the partner session)
- Modify: `scripts/pack.sh` (add `docs/valetudo-setup.md` to the tarball)

**Interfaces:**
- `install.sh`: `pkg install -y mosquitto` inside the existing install block (and when `! command -v mosquitto`); writes `$APP/mosquitto.conf` = `listener 1883 0.0.0.0` + `allow_anonymous true`; boot script starts `mosquitto -c "$HOME/robot/mosquitto.conf" -d` before the Node-RED loop (skip if already listening: `pgrep -x mosquitto`); final message adds `MQTT broker cho Valetudo : <IP>:1883` and the line `Đặt IP cố định cho máy này trên router (DHCP reservation) trước khi khai vào Valetudo.`
- `docs/valetudo-setup.md` sections, in this order: (1) Valetudo → Connectivity → MQTT settings to enter (host, port, enable, *Provide map data*; copy prefix+identifier); (2) the 5-step coordinate capture from the partner's screenshots, one line per step; (3) what to edit in `~/robot/site.json` (exact JSON snippet for `driver`, `valetudo.topic`, `valetudo.points`), then `pkill -f node-red` (boot loop restarts it); (4) the 5-stage test ladder from spec §8 with the exact `mosquitto_sub`/`mosquitto_pub` commands; (5) troubleshooting: robot offline alert, `noroute` alert, robot stops short → re-capture coordinates.

- [ ] **Step 1: Edit `install.sh`; check it with `bash -n termux/install.sh`.**
- [ ] **Step 2: Write `docs/valetudo-setup.md`; add it to `pack.sh`; run `sh scripts/pack.sh` and `tar tzf dist/robot-nodered.tar.gz | grep -c valetudo` — Expected: `≥ 2` (lib + doc).**
- [ ] **Step 3: If an Android device is at hand: install the tarball in Termux, `mosquitto_sub -h <phone-ip> -t '#' -v` from the Mac must connect. Otherwise note "untested on device" in the commit message.**
- [ ] **Step 4: Commit**

```bash
git add termux/install.sh docs/valetudo-setup.md scripts/pack.sh
git commit -m "feat(termux): install and autostart Mosquitto; Valetudo setup runbook"
```

---

### Task 8: Remote deploy and live test (manual, with the partner)

No code. Follow `docs/valetudo-setup.md` over RustDesk:

- [ ] Upload `dist/robot-nodered.tar.gz` to a download link; in Termux: `curl -L -o robot-nodered.tar.gz <link> && rm -rf ~/bundle && mkdir ~/bundle && tar xzf robot-nodered.tar.gz -C ~/bundle && bash ~/bundle/termux/install.sh`.
- [ ] Partner answers spec §10 (same subnet + fixed IP, topic prefix/identifier, Valetudo version). If no fixed IP → point Valetudo at a broker on their PC/NAS and set `mqtt_broker` host in the Node-RED editor instead.
- [ ] Configure Valetudo MQTT; capture coordinates for kitchen + 2 tables; edit `~/robot/site.json`; restart.
- [ ] Run the 5-stage ladder; stop at the first failing stage; a person stands next to the robot the whole time.
- [ ] Afterwards: copy the measured `valetudo.points`, `topic`, and observed trip times into a commit of `docs/valetudo-setup.md` (as the worked example) and adjust `site.timing` if trips exceed `loadSec/handoffSec`.
