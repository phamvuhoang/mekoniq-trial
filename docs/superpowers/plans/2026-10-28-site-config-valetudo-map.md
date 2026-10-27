# Site Config on Screen, Valetudo Map, Blocked Auto-Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the shift manager configure points, tables, stations, roles and robot knobs in the browser on the real Valetudo map, and make the Valetudo adapter recover from blockages by itself.

**Architecture:** The live `site` object moves from `require('./site.json')` into Node-RED global context (persisted); `site.json` becomes an empty seed, the 12-table demo moves to `site.demo.json`. The Valetudo adapter returns a compact copy of the robot's map beside its state; Node-RED serves it at `GET /api/map/:robot`; a shared canvas renderer (`vmap.js`) draws it on the station and on the new `setup.html`, where points are placed in robot cm directly. The adapter gets a wait → retry → blocked state machine with a progress watchdog.

**Tech Stack:** Node.js CommonJS, Node-RED 5.0.8 core nodes (`function`, `http in/response`, `mqtt`), Mosquitto, browser canvas, `node:assert` tests run by `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-28-site-config-valetudo-map-design.md`

## Global Constraints

- Adapter contract stays backward compatible: telemetry robot `{id, x, y, battery, moving, blocked, nav, why, path, rem}` **plus new optional `pos: {x, y, angle} | null`** (robot cm). Events: `telemetry`, `arrived`, `reroute`, **new `log` `{event:'log', robot, text}`**.
- Valetudo coordinates are integer **cm**, origin top-left, y down; `go/set` payload `{"coordinates":{"x":<int>,"y":<int>}}`; `map-data` is zlib-deflated JSON with `size`, `pixelSize`, `layers[].compressedPixels` (`[xStart, y, count]` triples in **pixels**), `entities[]` (`robot_position`, `charger_location`, …).
- Point coordinates live per robot: `site.robots[].valetudo.points[id] = {x, y}`; `site.robots[].valetudo.mapRef = {size:{x,y}, charger?:{x,y}}`. The old `site.valetudo.points` is gone.
- Robot knobs (defaults): `arriveCm 40`, `nomoveSec 10`, `tripSec 180`, `retrySec 15`, `retryMax 4`, `stuckSec 20`, `progressCm 15`, `acceptCm 80` (0 = off), `retryErr "unreach|target|navigat|path"` (case-insensitive regex source). Validation ranges: cm `0–300`, seconds `5–300`, `retryMax 1–20`.
- Point id regex `^[A-Za-z][A-Za-z0-9_-]{0,15}$`; `kind ∈ table|station|dish|dock`; exactly one point with `kind:'dish'` and it equals `dishPoint`; every robot's `dock` is a `dock` point.
- Config edits never write `site.json`. Context store `default` flushes every `1` s; a `memory` store holds maps.
- UI strings are Vietnamese; file/identifier names English. `npm test` must stay green after every task; commit after every task.
- `data/site.json` = empty seed (no tables, no `map`, no `floor`, no `sim`); `data/site.demo.json` = today's 12-table demo (tests, smoke test, `export-web.sh`). `pack.sh` ships `site.json` only.

## Review Focus

1. **Two tablets save at once** → second save must be refused with "máy khác vừa lưu, tải lại" instead of silently overwriting (rev check). Test in Task 3.
2. **Deleting a table that is in an open mission** → refused with the mission label; the mission keeps running. Test in Task 3.
3. **`map-data` with no `robot_position` / zero layers / corrupt zlib** → position and map kept from before, no throw, telemetry still emitted. Test in Task 8.
4. **A new `goto` while the robot is in `wait`** (orchestrator cancels and redirects) → retry counter resets and the new goal is sent; no stale retry of the old goal fires later. Test in Task 13.
5. **Imported JSON is huge or not an object** → refused before parsing into state (size cap 512 KB, type check). Test in Task 2.

---

### Task 1: Split seed and demo site data

**Files:**
- Create: `data/site.demo.json` (copy of current `data/site.json`)
- Modify: `data/site.json` (empty seed), `scripts/test.js:3`, `scripts/test-valetudo.js` (fixture unaffected), `scripts/export-web.sh`, `data/settings.js:12`
- Test: `scripts/test.js` (existing scenarios keep passing against the demo file)

**Interfaces:**
- Produces: `global.get('mekoniq').seed` (was `.site`). Seed content:

```json
{ "name": "MEKONIQ Serve S1", "rev": 0, "trays": 4, "dishPoint": "dish",
  "timing": { "loadSec": 120, "handoffSec": 60, "remindSec": 15, "standbySec": 180, "lowBattery": 20, "chargedBattery": 80 },
  "roles": [ {"id":"bep","name":"Bếp","home":"kitchen","tab":"deliver"}, {"id":"bar","name":"Quầy pha chế","home":"bar","tab":"deliver"},
             {"id":"don","name":"Dọn bàn","home":"dish","tab":"bus"}, {"id":"ql","name":"Quản lý ca","home":null,"tab":"summon"} ],
  "robots": [ { "id": "R1", "dock": "D1", "driver": "valetudo", "valetudo": { "topic": "", "points": {} } } ],
  "points": { "kitchen": {"name":"Bếp","kind":"station"}, "bar": {"name":"Quầy pha chế","kind":"station"},
              "dish": {"name":"Khu rửa chén","kind":"dish"}, "D1": {"name":"Sạc 1","kind":"dock"} } }
```

- [ ] **Step 1:** `cp data/site.json data/site.demo.json`; write the seed above to `data/site.json`; add `"rev": 0` to `site.demo.json` too.
- [ ] **Step 2:** `scripts/test.js:3` and `scripts/export-web.sh` (`cp data/site.demo.json "$OUT/site.json"`) use the demo file. `data/settings.js:12`: `seed: require("./site.json")` replaces `site:`; also add `siteLib: require("./lib/site")` (file created in Task 2 — create an empty `module.exports = {}` stub now so Node-RED boots).
- [ ] **Step 3:** Run `npm test`. Expected: all `✓` lines as before.
- [ ] **Step 4:** Commit `chore: site.json is an empty seed; demo data moves to site.demo.json`.

---

### Task 2: `lib/site.js` — validate and normalize a site

**Files:**
- Create: `data/lib/site.js`, `scripts/test-site.js`
- Modify: `package.json` `test` script → `node scripts/test.js && node scripts/test-valetudo.js && node scripts/test-site.js`

**Interfaces:**
- Produces: `normalize(input, seed) -> { site, errors: string[] }` — `site` is a fresh object with unknown fields kept, numbers coerced, `rev` copied as-is; `errors` non-empty means reject. `KNOBS = { arriveCm:[40,0,300], nomoveSec:[10,5,300], tripSec:[180,5,300], retrySec:[15,5,300], retryMax:[4,1,20], stuckSec:[20,5,300], progressCm:[15,0,300], acceptCm:[80,0,300] }` (default, min, max) and `RETRY_ERR = 'unreach|target|navigat|path'` exported for the UI and the adapter (`setup.html` loads `lib/site.js` the way `map.html` loads `lib/route.js`). `MAX_BYTES = 512 * 1024`.
- `inUse(site, orchState) -> { points: Set<id>, robots: Set<id> }` — ids referenced by open missions (`status pending|active|queued`, their open stops) and by `robots[].mission`.
- `nextTable(site) -> { id, name }` — first free `Tnn` (`T01`…), name `Bàn nn`.

- [ ] **Step 1: Write `scripts/test-site.js`** with these assertions (use the seed from Task 1 as `seed`):
  - `normalize(seed, seed).errors` is `[]` and result deep-equals seed (rev kept).
  - bad id `"1abc"` → error contains `"1abc"`; duplicate id impossible (object keys) but `kind:'sofa'` → error.
  - two `dish` points → error; `dishPoint` not a dish → error; robot dock `D9` missing → error.
  - `robots[0].valetudo.acceptCm: 999` → error with `"acceptCm"`; `"40"` string → coerced to number 40.
  - `valetudo.points.T01 = {x: 12.7, y: -3}` → x rounded to 13, y → error (negative); `{x: 3000}` with `mapRef.size {x:2500}` → error.
  - `retryErr: "("` (invalid regex) → error.
  - input not an object / `JSON.stringify(input).length > MAX_BYTES` → single error `"quá lớn"`/`"không hợp lệ"`.
  - unknown top-level key `foo: 1` survives.
  - `inUse(site, st)` with `st.missions = [{status:'active', robot:'R1', stops:[{p:'T01', status:'active'}, {p:'T02', status:'done'}]}]`, `st.robots.R1.mission = 1` → points `{T01}`, robots `{R1}`.
  - `nextTable({points:{T01:…, T03:…}})` → `{ id: 'T02', name: 'Bàn 02' }`.
- [ ] **Step 2:** Run `node scripts/test-site.js`. Expected: FAIL `Cannot find module`/`not a function`.
- [ ] **Step 3: Implement `data/lib/site.js`** (~90 lines, pure, no deps). Coerce with `Number()`, clamp nothing — out of range is an error, not a clamp (operators must see what they typed was wrong).
- [ ] **Step 4:** `node scripts/test-site.js` → all `✓`; `npm test` green.
- [ ] **Step 5:** Commit `feat(site): lib/site.js validates and normalizes site config`.

---

### Task 3: Orchestrator — live site, save/reset, robustness without `site.map`

**Files:**
- Modify: `data/lib/orchestrator.js` (`sync`, `gotoCmd`, `assign`, `telemetry`, `snapshot`, `fromUI`, `handle`), `scripts/test.js` (new scenarios at the end)

**Interfaces:**
- Consumes: `require('./site')` (`normalize`, `inUse`).
- Produces: `handle(st, site, input, now) -> { ui, cmds, site? }` — `site` present only when the config changed; the function node persists it (Task 5). New UI messages:
  - `{type:'siteSave', site, by}`: `normalize(d.site, seed)`; errors → `{type:'event', text:'Không lưu: ' + errors.join('; ')}` to that session. `d.site.rev !== site.rev` → `'Không lưu: máy khác vừa lưu cấu hình — tải lại trang'`. Removing a point/robot in `inUse` → `'Không lưu: … đang có lệnh'`. OK → `result.site = {...normalized, rev: site.rev + 1}`, log `"<by> cập nhật cấu hình (bản N)"`, push `{type:'site', site}` to all sessions, `c.force = true`.
  - `{type:'siteReset', by}`: same with `seed` (rev continues counting).
  - `{type:'probe', robot, x, y, by}`: robot exists, `!r.mission && r.phase==='idle' && !r.halt` → `cmds.push({cmd:'probe', robot, x, y})`, log `"<by> cho R1 chạy thử tới (x, y)"`; else ignored.
  - adapter `{event:'log', robot, text}` → `log(c, 'info', text, robot)`.
- `seed` reaches the orchestrator as `input.seed` on `siteSave`/`siteReset` (function node passes `global.get('mekoniq').seed`), so the lib stays pure.
- Telemetry copies `t.pos` (or `null`) to `r.pos`; `snapshot()` emits `pos` per robot.
- Robustness: `sync()` builds `st.map = { v: 1, nodes: {}, edges: [], ...(site.map || {}) }`; a dock without `x,y` yields robot at `{x:0, y:0}`; robots no longer in `site.robots` and without a mission are deleted from `st.robots`. `gotoCmd` uses `st.map.nodes[target] || site.points[target]` and sends `x: p.x ?? 0, y: p.y ?? 0`. `assign` distance: `R.distance` when both robot and goal have map nodes, else if `r.pos` and `site.robots[].valetudo.points[first]` exist → Euclid in cm, else `Infinity` for robots lacking the point when it's a Valetudo robot (they cannot go there), else `0`.

- [ ] **Step 1: Write failing scenarios in `scripts/test.js`** (a second `site` object built from `site.demo.json` with `rev`):
  - `siteSave` with `rev` mismatch → event text starts `'Không lưu: máy khác'`, `r.site` undefined.
  - `siteSave` removing `T01` while a deliver mission to T01 is active → event contains `'đang có lệnh'`.
  - `siteSave` adding `T13 {name:'Bàn 13', kind:'table'}` (no map node) → `r.site.rev === site.rev + 1`; then with that site, deliver to `T13` by `R1` → a `goto` cmd with `to:'T13'`, `x: 0`, `y: 0`, no throw.
  - `siteReset` → `r.site.points` has no tables.
  - `probe` while idle → `{cmd:'probe', robot:'R1', x:100, y:200}`; while on a mission → no cmd.
  - telemetry with `pos:{x:1,y:2,angle:90}` → state `robots[0].pos` deep-equals it.
  - `{event:'log', robot:'R1', text:'hello'}` → `st.log[0].text === 'hello'`.
  - `O.init(seedSite)` (seed from Task 1) → no throw, `st.robots.R1.x === 0`.
- [ ] **Step 2:** `node scripts/test.js` → FAIL on the first new assertion.
- [ ] **Step 3:** Implement in `orchestrator.js`. Keep the mission state machine untouched.
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit `feat(orchestrator): live site save/reset, probe, pos passthrough, works without route map`.

---

### Task 4: Route editor and simulator tolerate points without nodes

**Files:**
- Modify: `data/lib/route.js:60-95` (`unreachable`, `clean`), `data/lib/simulator.js:20-30` (`init`), `scripts/test.js`

- [ ] **Step 1: Tests:** `R.clean(map, siteWithT13)` returns a map (not null) when `T13` has no node; `R.unreachable` does not list `T13`; `S.init(seedSite)` → `{}` robots, no throw (dock has no node → robot skipped); `S.init(demoSite)` unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement: `clean` requires nodes only for points that already had one in `site.map.nodes`; `unreachable` filters `Object.keys(site.points).filter(p => map.nodes[p] && …)`; `simulator.init` `continue` when `!site.map || !site.map.nodes[dock]`.
- [ ] **Step 4:** `npm test` green. **Step 5:** Commit `fix(route,sim): points without a route node are Valetudo-only`.

---

### Task 5: Node-RED wiring — site in global context, memory store, adapter rebuild keeps state

**Files:**
- Modify: `data/flows.json` (function nodes `orch`, `sim`, `val`), `data/settings.js` (`contextStorage`), `data/lib/valetudo.js` (`init`/rebuild, points source), `scripts/test-valetudo.js`

**Interfaces:**
- Function nodes: `const { seed } = global.get('mekoniq'); const site = global.get('site') || seed;`. `orch` node: after `O.handle`, `if (r.site) global.set('site', r.site);` and for `siteSave`/`siteReset` inputs add `input.seed = seed`.
- `settings.js`: `contextStorage: { default: { module: 'localfilesystem', config: { flushInterval: 1 } }, memory: { module: 'memory' } }`.
- `valetudo.js`: points come from `r.valetudo.points || {}` per robot; `calib()` and `fit` remain only for `x,y` m output when `site.points[id].x` exists (demo), else telemetry `x,y` = `0`. On `robotsKey` change, rebuild copies `status, err, battery, pos, online` from the old entry with the same `topic`.

- [ ] **Step 1: Tests in `test-valetudo.js`:** (a) site with `robots[0].valetudo.points.kitchen` → goto publishes those coords (no `site.valetudo`); (b) after `$state ready`/status/battery ingested, change `arriveCm` in a cloned site → next tick telemetry still lists R1 with battery 87; (c) changing `topic` → R1 absent until `$state` arrives again.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` green.
- [ ] **Step 5:** Edit the three function nodes in `flows.json` (JSON-escaped `func` strings) and `settings.js`. Start Node-RED (`npm start`) and open `http://localhost:1880/station.html?role=ql`: no console error, roles render from the seed. Stop it.
- [ ] **Step 6:** Commit `feat(node-red): site lives in global context; adapter survives knob edits`.

---

### Task 6: `setup.html` — Robot / Roles & timing / Backup tabs, point list

**Files:**
- Create: `data/public/setup.html`
- Modify: `data/public/common.js` (`connect`: re-run `onMsg` for `site` messages — it already does; add `hasSim = () => App.site.robots.some(r => !r.driver || r.driver === 'sim')`; guard `etaSec` with `(App.site.sim || {}).speed || 1`), `data/public/index.html` (tile `⚙️ Cấu hình` → `setup.html`; `Thiết kế lộ trình` tile only when `hasSim()`), `data/public/station.html:153` (`map.html` link and obstacle tools only when `hasSim()`)

**Interfaces:**
- Page state: `let D = null, dirty = false;` `D` is a deep copy of `App.site` taken on first `site` message and whenever `!dirty`. If a `site` message arrives while `dirty`, show `"Máy khác vừa lưu — Tải lại để lấy bản mới"` with a button that reloads `D`.
- Save: `send({type:'siteSave', site: D, by})`; button shows `Đang lưu…` until a `site` message with `rev === D.rev + 1` arrives → toast `Đã lưu`; an `event` with text starting `Không lưu` → shown red under the Save button.
- Tabs (`?tab=`): `points` (Task 11 fills the canvas; this task renders the list only), `robots`, `roles`, `backup`.
- Points list: grouped by kind; row = name input, id (read-only), kind badge, for Valetudo robots a `x`/`y` cm numeric pair per robot (`D.robots[i].valetudo.points[id]`), status `● đã định vị` / `○ chưa`; buttons `+ Thêm bàn` (`nextTable`), `+ Thêm trạm` (prompt id/name), `Xoá` (2-tap via `armed`).
- Robots tab: id, dock (select of dock points), driver (`valetudo`/`sim`), topic, each knob from `KNOBS` with a one-line Vietnamese hint, `lowBattery`/`chargedBattery`. `+ Thêm robot` / `Xoá`.
- Roles tab: roles (name, home point select, default tab), `timing.*`, `trays`.
- Backup tab: `Tải xuống JSON` (Blob of `App.site`, filename `site-<name>-<date>.json`), `Nhập JSON` (`<input type=file>` → `JSON.parse` → `D = parsed; D.rev = App.site.rev; dirty = true`), `Khôi phục mặc định` (2-tap → `siteReset`), line `Bản N · sửa lần cuối …` (use the latest log entry containing `cập nhật cấu hình`).

- [ ] **Step 1:** Build the page with `brand.css`, `transport.js`, `common.js`, `lib/site.js` (loaded like `map.html` loads `lib/route.js`). Native `<input type=number>`, `<select>`; no new libs.
- [ ] **Step 2: Verify by hand** with Node-RED running: add table `T01`, type cm `100, 200` for R1, save → station `role=bep` shows Bàn 01 immediately; `pkill -f node-red`, restart, reload → table still there. Import an invalid file → red line. Open the page in two tabs, save in both → second gets `máy khác vừa lưu`.
- [ ] **Step 3:** `npm test` green (no logic change) and commit `feat(ui): setup.html — robots, roles, timing, backup, point list`.

---

### Task 7: Installer stops touching `site.json`

**Files:**
- Modify: `termux/install.sh:579-581, 649` (remove the backup/`SITE_BAK` block and its final warning), print `Cấu hình: http://<IP>:1880/setup.html` next to the station links.

- [ ] **Step 1:** Edit; `sh -n termux/install.sh` → no syntax error.
- [ ] **Step 2:** Commit `chore(termux): config persists in Node-RED context; installer no longer backs up site.json`.

---

### Task 8: Adapter emits compact map and robot `pos`

**Files:**
- Modify: `data/lib/valetudo.js` (`parseMap` → `parseMapData`, `handle` return, `telemetry`), `scripts/test-valetudo.js`

**Interfaces:**
- `parseMapData(payload) -> { pos: {x, y, angle} | null, map: CompactMap | null }` where `CompactMap = { size:{x,y}, pixelSize, layers:[{type, segmentId?, name?, px:number[]}], charger:{x,y}|null, t }` (`px` = the raw `compressedPixels`; `t = Date.now()` set by caller).
- `handle()` returns `{ events, mqtt, maps }` with `maps[robotId] = CompactMap` only for robots whose map arrived in **this** call. The map is **not** stored in `st`; `st.robots[id].mapMeta = {size, charger}` (tiny) is, for the `mapRef` warning.
- Telemetry robots carry `pos: b.pos ? {x, y, angle} : null`.

- [ ] **Step 1: Tests:** deflate a map `{size:{x:2500,y:2000}, pixelSize:5, layers:[{type:'floor', compressedPixels:[1,1,3], metaData:{}}, {type:'segment', compressedPixels:[4,1,2], metaData:{segmentId:'7', name:'Sảnh'}}], entities:[{type:'robot_position', points:[120,340], metaData:{angle:90}}, {type:'charger_location', points:[100,300]}]}` → `parseMapData` returns pos `{120,340,90}` and map with 2 layers (`name:'Sảnh'`), charger `{100,300}`; corrupt buffer → `{pos:null, map:null}`; map without `robot_position` → `pos:null`, `map` present; `handle` with map-data → `maps.R1.size.x === 2500`, next tick `maps` is `{}` and telemetry `pos` deep-equals `{x:120,y:340,angle:90}`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit `feat(valetudo): compact map beside state; telemetry pos in cm`.

---

### Task 9: Serve the map — `GET /api/map/:robot`

**Files:**
- Modify: `data/flows.json` (node `val` writes maps; new nodes `map_in` (`http in`, GET `/api/map/:robot`), `map_fn` (function), `map_out` (`http response`)), `scripts/fake-valetudo.js`

**Interfaces:**
- `val` node: `for (const [id, m] of Object.entries(r.maps)) global.set('vmap:' + id, m, 'memory');`
- `map_fn`: `const m = global.get('vmap:' + msg.req.params.robot, 'memory'); msg.statusCode = m ? 200 : 404; msg.payload = m || { error: 'no map yet' }; return msg;`
- `fake-valetudo.js`: the published map gains `size {x:3000,y:2000}`, `pixelSize 5`, one `floor` layer (a 400×300 px rectangle as rows of `[20, y, 400]`), a `wall` layer (its 1-px border), one `segment` layer (`name:'Sảnh'`, inner rectangle), `charger_location` at `dock`. Publish with `retain: true` (matches the real robot).

- [ ] **Step 1:** Start `mosquitto -p 1884 &`, `node scripts/fake-valetudo.js &`, `npm start &`. `curl -s localhost:1880/api/map/R1 | head -c 300` → JSON with `"size"`, `"layers"`; `curl -s -o /dev/null -w '%{http_code}' localhost:1880/api/map/R9` → `404`.
- [ ] **Step 2:** Commit `feat(node-red): GET /api/map/:robot serves the robot's latest map`.

---

### Task 10: `vmap.js` — canvas renderer and hit-test

**Files:**
- Create: `data/public/vmap.js`

**Interfaces:**
- `VMap(canvas, opts)` → object with:
  - `setMap(compactMap)` (re-rasterizes layers into an offscreen canvas at 1 px per map pixel; floor `#dfe7ec`, wall `#334`, segments 6 pastel tints by index, segment name at `dimensions` midpoint computed from `px`),
  - `draw({ points: {id: {x, y, name, kind, sel?, pending?}}, robots: [{id, x, y, angle, tone, ring}], charger, goal? })` (fit-to-canvas transform, optional `zoom` 1|2 via `setZoom(z)` centred on the selected point or robot),
  - `toMap(clientX, clientY) -> {x, y}` cm (rounded ints) and `hit(clientX, clientY) -> pointId | null` (within 25 px screen).
  - `opts.onTap(x, y, hitId)` fired on `click`.
- Markers: table = rounded pill with label `short(id)`, station/dish = rectangle label, dock = `⚡` at charger, robot = filled circle `r=8px` + heading line, red dashed ring when `ring`. Selected point drawn with a thick outline; `pending` (no coords) listed but not drawn.

- [ ] **Step 1:** Write `vmap.js` (~150 lines, no libs). Create a throwaway `data/public/vmap-dev.html` that fetches `/api/map/R1` and draws two fake points — verify visually with the fake robot from Task 9, then delete the dev page.
- [ ] **Step 2:** Commit `feat(ui): vmap.js draws the Valetudo map, points and robots`.

---

### Task 11: `setup.html` — "Điểm & bản đồ" tab, teach by robot position, probe, mapRef

**Files:**
- Modify: `data/public/setup.html`, `data/lib/valetudo.js` (cmd `probe`), `scripts/test-valetudo.js`

**Interfaces:**
- Adapter `{cmd:'probe', robot, x, y}`: publishes `go/set` with those coords **only if** `!b.goal && !MOVING.includes(b.status) && !b.paused`; sets nothing else (no goal, no arrival). Test: probe while idle → one `go/set`; probe while a goal exists → no publish.
- Page: robot selector (Valetudo robots), canvas via `VMap`, polls `/api/map/<robot>` every 10 s and `setMap` only when `t` changed; robot marker from `App.state.robots[].pos`. Point list from Task 6 becomes the right column; clicking a row selects it; `onTap` with a selected point sets `D.robots[i].valetudo.points[sel] = {x, y}`, `dirty = true`. Buttons: `← ↑ ↓ →` ±10 cm, `Dùng vị trí robot` (copy `pos` x,y), `Chạy thử tới đây` (`send({type:'probe', robot, x, y, by})`, enabled only when the robot status text is `Sẵn sàng`), `Xoá vị trí`. Zoom toggle `1× / 2×`.
- `mapRef`: on save, for each robot with a map, `D.robots[i].valetudo.mapRef = { size, charger }` from the last fetched map. On load/poll, if `mapRef.size` differs from the current map `size` → yellow banner over the canvas: `Bản đồ robot có thể đã vẽ lại — kiểm tra lại các điểm`.
- Dock row shows `⚡ lấy từ robot` (charger) and is not editable.

- [ ] **Step 1:** Adapter probe test → FAIL → implement → `npm test` green.
- [ ] **Step 2:** Build the tab. Verify by hand with the fake robot: select `T01`, tap the map, save, `station.html?role=bep` → deliver T01 → fake robot receives `go/set` with the tapped coords (fake robot logs it). `Dùng vị trí robot` copies the fake robot's position. Probe publishes once; while a mission runs the button is disabled.
- [ ] **Step 3:** Commit `feat(ui): place points on the Valetudo map, teach from robot position, probe`.

---

### Task 12: Station monitor and robot screen use the Valetudo map/state

**Files:**
- Modify: `data/public/station.html` (monitor view: when `!hasSim()`, replace the `<svg id="map">` floor with a `<canvas id="vmap">` driven by `VMap`; tap on a table marker selects it for the form exactly like `data-f="t:<id>"`; hide `#mode`, `obClear`, legend), `data/public/robot.html:118-120` (wait text: for a Valetudo robot `Có vật cản phía trước — robot sẽ thử đi tiếp sau ${retrySec} giây.`, where `retrySec = (robot.valetudo||{}).retrySec || 15`; the `noroute` hint drops the words `site.json` → `Quản lý định vị điểm này trong “Cấu hình”.`)

- [ ] **Step 1:** Implement; keep the SVG path when `hasSim()` (web demo).
- [ ] **Step 2:** Verify by hand: monitor tab shows the fake robot moving on the fake map during a delivery; selecting a table on the canvas fills the form. Open `robot.html?robot=R1` while the adapter reports `nav:'wait'` (Task 13 fake scenario) → new text.
- [ ] **Step 3:** Commit `feat(ui): station monitor draws the Valetudo map; robot wait text per driver`.

---

### Task 13: Blocked auto-recovery in the adapter

**Files:**
- Modify: `data/lib/valetudo.js` (`init` knobs, `tick`, `ingest`, `end`, `block`, new `waitRetry`), `scripts/test-valetudo.js`, `scripts/fake-valetudo.js`

**Interfaces:**
- Per-robot state adds `tries: 0, retryAt: 0, lastPos: null, progressAt: 0, waiting: false`.
- Knobs from `KNOBS` defaults (Global Constraints) via the existing `knob()`; `retryErr` compiled once per rebuild into `b.retryRe`.
- Behaviour (spec §8):
  - `enterWait(b, now)`: `waiting = true; blocked = false; why = 'object'; retryAt = now + retrySec`. Telemetry: `nav:'wait', why:'object', blocked:false, moving:false`.
  - tick: `waiting && now >= retryAt && !paused` → `tries++`; if `tries > retryMax` → `block(b)` (keeps `waiting` so retries continue every `retrySec * 4`) else `send()`; emit `{event:'log', robot, text:'R1: thử đi tiếp lần N tới <to>'}`.
  - trip end away from goal, no error (B) → if `tries >= retryMax && acceptCm && dist <= acceptCm` → `arrive` + log `'R1 dừng cách <to> ~<d> cm — coi là đã tới'`; else `enterWait`.
  - status `moving` with `pos` → if `hypot(pos - lastPos) > progressCm` update `lastPos, progressAt`; tick: `moving && now - progressAt >= stuckSec*1000` (A) → publish `STOP`, `enterWait`, log `'R1: đứng yên <stuckSec>s trên đường tới <to>'`.
  - `error` whose `err` matches `retryRe` (C) → `enterWait`; other `err` → `block` as today; `err` cleared while blocked-by-error and goal present → `start()`.
  - `moving` seen after a retry → `waiting = false; tries = 0; blocked = false`.
  - new `goto` (different `to`) / `resume` / `sim clear` → `tries = 0, waiting = false, retryAt = 0`.
  - Every abnormal trip end logs `'R1: chuyến tới <to> dừng ở <x>,<y> (cách <d> cm), status=<s>, lỗi=<err|->'`.
- `fake-valetudo.js`: `go/set` with odd `x` → `moving` 2 s then `idle` 150 cm short of the target the first time; the second `go/set` to the same coords arrives. Env `FAKE_ERR=1` → instead publishes `error` + `error_description 'Cannot reach target'` then `idle`.

- [ ] **Step 1: Tests (fake clock, `now` advanced by hand):**
  - (B) goto → moving → idle 200 cm away → telemetry `nav:'wait', blocked:false`; +15 s tick → one `go/set` republished, `events` include `log` with `'lần 1'`; repeat until `tries > 4` → `blocked:true`; +60 s → another `go/set`; then `moving` → `idle` within 40 cm → `arrived`, `blocked:false`.
  - acceptCm: after 4 tries, idle 60 cm away → `arrived` and a log containing `'coi là đã tới'`; with `acceptCm: 0` → wait again.
  - (A) moving with the same `pos` for 20 s → `STOP` published, `nav:'wait'`.
  - (C) `error_description 'Cannot reach target'` → `nav:'wait'` not `blocked`; `'Wheel lost floor contact'` → `blocked:true`; then `'No error'` → `go/set` republished.
  - Review Focus 4: in `wait` with `tries 2`, goto to another point → `go/set` to the new coords now, `tries === 0`, and +15 s tick publishes nothing extra.
  - `paused` during wait → no republish on tick; `resume` → republish.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (~60 lines net). **Step 4:** `npm test` green.
- [ ] **Step 5:** Fake robot scenario; by hand: deliver to an odd-x point → station log shows `thử đi tiếp lần 1`, robot screen shows the wait text, then arrives without any click.
- [ ] **Step 6:** Commit `feat(valetudo): wait/retry/blocked state machine, stuck watchdog, acceptCm, retryable errors`.

---

### Task 14: Docs and bundle

**Files:**
- Modify: `docs/valetudo-setup.md` (§2–3 rewritten: open `setup.html`, tab Điểm & bản đồ, teach by robot position; §5 table rows for `wait`/retry; new §6 "Checklist đầu ca" and §7 "Thực hành tốt" from spec §10), `scripts/pack.sh` (comment: ships the empty seed), `docs/superpowers/specs/2026-10-27-valetudo-mqtt-adapter-design.md` (one-line note at top: points moved to `robots[].valetudo.points`, see the 10-28 spec)

- [ ] **Step 1:** Write; `sh scripts/pack.sh` → tarball lists `data/site.json` and not `site.demo.json` (`tar tzf dist/robot-nodered.tar.gz | grep site`).
- [ ] **Step 2:** Final check: `npm test` green; the full fake-robot round trip from Task 13 Step 5; `pkill -f node-red` → restart → config intact.
- [ ] **Step 3:** Commit `docs: setup via setup.html, pre-shift checklist, delivery best practices`.
