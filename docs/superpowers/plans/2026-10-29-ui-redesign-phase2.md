# UI Redesign — Phase 2: new features from the design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the capabilities the round-3 design draws but the system does not have yet: retarget a delivery while the robot is moving, call staff / request bill from the table QR and the robot, bilingual QR page, configurable quick notes, bus-a-table from the robot, guide guests to a table (with slow mode), order food on the robot, pay by VietQR on the robot. Each behind a `site.features` flag so a real restaurant can enable them one by one.

**Architecture:** New WebSocket messages go through `orchestrator.fromUI` and are pure functions tested in `scripts/test.js`. New config (`features`, `notes`, `menu`, `payment`, `kind:'entrance'`) is validated in `lib/site.js` and edited in `setup.html`. Alerts reuse `alert()` (keyed, acked). Orders live in `st.orders`. A new adapter command `speed` is honoured by the simulator and logged by the Valetudo adapter. UI work extends the phase-1 shells (`robot.html` action zone, `table.html` footer, station strips).

**Tech Stack:** Node.js CommonJS, Node-RED function nodes (no new nodes), `node:assert` tests, static HTML.

**Spec:** `docs/superpowers/specs/2026-10-29-ui-redesign-design.md` §6, §8 (GĐ2). Prerequisite: phase-1 plan complete.

## Global Constraints

- Adapter contract: add **only** `{cmd:'speed', robot, factor}` (0.25–1). Telemetry unchanged.
- New UI messages (all with `by`): `call {point, what}`, `retarget {mission, stop, to}`, `order {table, items:[{id, qty}]}`, `speed {robot, slow}`, `create {kind:'guide', to}`, `dispatch {mission, tables:[t], bus:true}`. Unknown/invalid payloads are ignored silently (as today) except where the spec says to reply with `{type:'event', text}` to the session.
- `site.features = { call, guide, order, pay }` booleans; `lib/site.js` defaults missing keys to `false`; `site.demo.json` sets all `true`. UI hides a feature's buttons when its flag is off; the orchestrator **also** rejects the message when the flag is off (defence in depth, logged `warn`).
- `site.notes`: array of 1–8 strings ≤ 24 chars. `site.menu.items[].price` integer ≥ 0 (VND). `site.payment.account` digits only. `kind:'entrance'` allowed for points; an entrance never appears in table grids.
- Every task ends with `npm test` green and a commit. UI strings Vietnamese + English on robot/QR.

## Review Focus

1. **Alert spam from the QR page** — a guest tapping `Gọi nhân viên` ten times must produce one alert (keyed `call-staff-T05`) until acked; after ack a new tap creates a new one. Test in Task 1.
2. **Order routing** — items from two categories with different `station`s produce one alert per station, each listing only its items. Test in Task 7.
3. **Guide mission vs. standby** — a guide mission must not be preempted by `standbySec`; `handoffSec` timeout returns the robot and logs. Test in Task 6.
4. **`speed` on a robot with no mission or offline** — ignored, no cmd emitted. Test in Task 6.
5. **Bus from the robot** — `dispatch {bus:true}` on a standby mission at a station appends `collect(table) → unload(dish)`; at a non-station point it is refused; the dish point cannot be the bus target. Test in Task 5.

---

### Task 1: `call` — staff / bill / paid requests (`features.call`)

**Files:**
- Modify: `data/lib/site.js` (features defaults), `data/lib/orchestrator.js` (`fromUI` case `'call'`), `data/site.json`, `data/site.demo.json`, `scripts/test.js`

**Interfaces:**
- `case 'call'`: `point` must be a `table` point; `what ∈ staff|bill|paid`. `alert(c, 'call-'+what+'-'+point, 'warn', text)` with texts `Bàn 05 gọi nhân viên` / `Bàn 05 xin hoá đơn` / `Bàn 05 báo đã chuyển khoản` (+ ` · ${amount}` when `d.amount` present); `ev(c, { stationSound: 'ding', text })`; `log(c, 'info', …)`.

- [ ] **Step 1: Tests first** in `scripts/test.js`: (a) `call staff` creates one alert; second call before ack → still one; ack then call → two total history; (b) `call` with feature off → no alert, a `warn` log; (c) invalid `point` → ignored.
- [ ] **Step 2:** Implement; `lib/site.js` `normalize` fills `features` defaults; seed/demo JSON updated.
- [ ] **Step 3:** `npm test` green. Commit `feat(orchestrator): call staff / bill / paid alerts`.

---

### Task 2: `retarget` — change a table while the robot is on its way

**Files:**
- Modify: `data/lib/orchestrator.js` (`fromUI` case `'retarget'`, helper `retarget(c, m, i, to, by)`), `data/public/station.html`, `data/public/robot.html` (toast only), `scripts/test.js`

**Interfaces:**
- `retarget {mission, stop, to, by}`: stop `i` must be `a:'handoff'` with status `pending`, or `active` while the robot is `toStop`; `to` must be a `table` point not already an open stop of `m`. Effect: `s.p = to`; `m.label` rebuilt the way `create()` builds it; if `i === m.cur && r.phase === 'toStop'` → `goTo(c, r, to, 'toStop')`; `log(c,'info', `${by} đổi Bàn 05 → Bàn 07 của ${m.label}`)`; `ev(c, { table: oldTable, text })` and `ev(c, { table: to, text })` with no sounds; no KPI change. Refusals reply to the session `{type:'event', text:'Không đổi được: robot đã tới bàn'}` (or `bàn đã có trong chuyến`).
- Station: `F.retarget = {mission, stop} | null`. Queue rows and the recall card show `Đổi bàn` per open handoff stop (one button when the mission has one table; otherwise one small `Đổi` per stop chip). Tapping sets `F.retarget`, the pick row hint reads `Chạm bàn mới cho Bàn 05`, table tiles of open stops are disabled; tapping a tile sends `retarget` and clears `F.retarget`; `Bỏ chọn` also clears it.
- Robot: when the current target changes while `toStop`, toast `Đổi đích → Bàn 07 · New destination` (compare `m.stops[m.cur].p` between renders).

- [ ] **Step 1: Tests**: (a) retarget the active stop while `toStop` → `r.target === 'T07'`, label updated, `kpi.cancelledStaff` unchanged, robot arrives at T07 (run the sim loop as the existing delivery test does); (b) retarget while `atStop` → refused, state unchanged, event text to session; (c) `to` already in the mission → refused; (d) retarget a `pending` second stop → only `s.p` changes, robot keeps its current target.
- [ ] **Step 2:** Implement orchestrator + station UI + robot toast.
- [ ] **Step 3:** `npm test`; demo: deliver to Bàn 05, while moving tap `Đổi bàn` → Bàn 07; QR Bàn 05 drops the item, QR Bàn 07 shows it. Commit `feat: retarget a delivery while the robot is moving`.

---

### Task 3: QR page — footer buttons and VI/EN

**Files:**
- Modify: `data/public/table.html`

**Interfaces:**
- Footer (`features.call`): `Gọi nhân viên` → `send({type:'call', point: T, what:'staff', by:'Khách ' + pname(T) + ' (QR)'})`, `Xin hoá đơn` → `what:'bill'`; toast confirms; buttons disabled 30 s after a tap (client-side debounce).
- Language: `#lang` segmented VI/EN, stored in `localStorage['mekoniq.lang']`; dictionary `T = { vi: {...}, en: {...} }` covering eyebrow, table, call, bill, note, status strings (5 steps + cancelled/paused), cancel/confirm labels, toasts. Status strings come from a function `status(m, s, r)` returning a key + params so both languages share logic.

- [ ] **Step 1:** Dictionary + render through it; footer per spec §4.6.
- [ ] **Step 2:** Verify in the web demo: EN strings, footer tap → station strip + ding; feature off → footer hidden. Commit `feat(table): call staff / request bill, VI-EN`.

---

### Task 4: Quick notes from config (`site.notes`)

**Files:**
- Modify: `data/lib/site.js`, `data/site.json`, `data/site.demo.json`, `data/public/station.html`, `data/public/setup.html`, `scripts/test-site.js`

- [ ] **Step 1: Tests** in `test-site.js`: notes normalised (trim, drop empty, cap 8, cap 24 chars); missing → default four.
- [ ] **Step 2:** `station.html` uses `App.site.notes`; `setup.html` tab "Vai trò & thời gian" gains card "Ghi chú nhanh" (list with remove + `+ Thêm`).
- [ ] **Step 3:** `npm test`. Commit `feat(config): quick notes list`.

---

### Task 5: Bus a table from the robot (`dispatch bus`)

**Files:**
- Modify: `data/lib/orchestrator.js` (`dispatch`), `data/public/robot.html`, `scripts/test.js`

**Interfaces:**
- `dispatch(c, r, d, by)` with `d.bus === true`: requires the current stop to be `standby` at a `station` point and exactly one `d.tables[0]` that is a `table` point; appends `{p: t, a:'collect'}` then `{p: site.dishPoint, a:'unload'}` (mirrors `create kind:'bus'`), sets `m.kind = 'bus'`, `m.label` like `create` does; logs `${by} giao việc cho ${r.id}: Thu dọn Bàn 05`.

- [ ] **Step 1: Tests**: happy path advances to `toStop` with target = table; refused at a non-station standby; refused with 2 tables.
- [ ] **Step 2:** Implement; robot load screen step 1 shows `Giao món` / `Thu dọn bàn` segmented (`mode`), bus mode limits picks to 1 and the primary button reads `Đi thu dọn Bàn nn · Go bus table` → `dispatch {tables:[t], bus:true}`.
- [ ] **Step 3:** `npm test`. Commit `feat(robot): bus a table from the standby screen`.

---

### Task 6: Guide guests to a table (`features.guide`) + `speed`

**Files:**
- Modify: `data/lib/site.js` (`kind:'entrance'`), `data/lib/orchestrator.js` (`create kind:'guide'`, stop action `guide`, `confirm` for guide, `timers`, `speed`), `data/lib/simulator.js` (`speed` cmd → per-robot factor), `data/lib/valetudo.js` (`speed` → log only), `data/public/robot.html`, `data/public/common.js` (`ACTION_VI.guide = 'Dẫn khách'`), `scripts/test.js`, `scripts/test-valetudo.js`

**Interfaces:**
- `create {kind:'guide', to, by}` only from a robot session (`d.robot` set) that is `atStop` at a `station|entrance|standby` point or idle at an `entrance`; mission `{kind:'guide', stops:[{p: to, a:'guide'}], robot: d.robot}` assigned immediately to that robot (no queue). Robot `toStop` → `atStop` → `confirm` marks done → `advance` → dock/next job. `timers`: guide stop uses `handoffSec` (reminder every `remindSec` via `robotSound:'remind'`), on timeout `finish(c, m, 'timeout')` **without** counting `kpi.timeout` (that is for deliveries) — add `kpi.guides` counter instead.
- `speed {robot, slow}` → if robot has a mission and is online: `c.cmds.push({cmd:'speed', robot, factor: slow ? .5 : 1})`, `r.slow = !!slow` in snapshot; log once per change.
- Simulator: `factor` multiplies `site.sim.speed` for that robot until the mission ends (reset on `finish`).

- [ ] **Step 1: Tests**: guide mission flow to done; `speed` sets factor and simulator moves ~half distance per tick; `speed` without mission → no cmd; guide timeout returns robot, no `kpi.timeout` increment; `entrance` validates and never appears in `tables` lists (UI-only, but `site.js` test that kind is accepted).
- [ ] **Step 2:** Implement lib changes (valetudo: `case 'speed'` → `log` event "R1: đi chậm/bình thường — robot Valetudo không hỗ trợ, bỏ qua").
- [ ] **Step 3:** `robot.html`: idle/standby action `Dẫn tôi tới bàn · Guide me to a table` (visible when `features.guide` and the position rule holds) → table grid (1 pick) → `create guide`; moving screen for `a === 'guide'` = design "guide" (title, big table number, guests placeholder, progress bar from `rem`), acts `Đã tới bàn` (`confirm`), `Đi chậm hơn`/`Đi bình thường` (`speed`), `Gọi nhân viên` (`call staff`, `point` = target table).
- [ ] **Step 4:** `npm test`; demo: summon R1 to `kitchen`, tap guide → Bàn 07 → slow → arrive → confirm. Commit `feat: guide guests to a table with slow mode`.

---

### Task 7: Menu + order on the robot (`features.order`)

**Files:**
- Modify: `data/lib/site.js` (`menu`), `data/lib/orchestrator.js` (`case 'order'`, `st.orders`, cleanup in `timers`, `snapshot` exposes `orders`), `data/site.demo.json` (12 items from the design), `data/public/robot.html`, `data/public/station.html` (orders in alert strips already; queue shows "Khách Bàn 05 gọi món" rows?) — **no**: orders surface as alerts only, kitchen creates the delivery as today), `data/public/table.html` (list orders), `data/public/setup.html` (menu table), `scripts/test.js`, `scripts/test-site.js`

**Interfaces:**
- `site.menu = { cats: [{id, vi, en, station?}], items: [{id, cat, vi, en, price}] }`; `station` defaults to `kitchen`.
- `case 'order'`: `table` is a table point; items valid ids with `qty 1–20`; → `st.orders.push({ id: ++st.orderSeq, table, items: [{id, qty, price}], total, t: now, status: 'new' })`; group items by `cat.station` → one `alert(c, 'order-'+id+'-'+station, 'warn', 'Bàn 05 gọi món: Phở bò ×2, Trà đá ×2')` per station with `point: station` so only that station's screens `ding` (`hears()` filter already uses `point`); log. `timers` drops orders older than 24 h or `status:'paid'`.
- `snapshot()` adds `orders` (open + paid-claimed of the day).

- [ ] **Step 1: Tests**: order with items from kitchen+bar → two alerts, each listing its items and totals; invalid item → ignored; feature off → warn log; cleanup after 24 h.
- [ ] **Step 2:** `lib/site.js` menu validation + tests; demo menu data.
- [ ] **Step 3:** `robot.html` order screen per design: category segmented, item grid (3 cols landscape / 2 portrait, `grid-auto-rows: minmax(0,1fr)`, placeholder image band, +/− controls), action zone: cart box, `Gửi bếp n món · Send to kitchen` (`order {table}` where `table` = `r.at` if a table, else a table picker step first), `Quay lại`. Entry: idle/standby/handoff action `Gọi món · Order food` when `features.order`.
- [ ] **Step 4:** `table.html` lists the table's orders (status `new` → "Bếp đã nhận · đang chuẩn bị"; delivery progress still comes from missions). `setup.html` "Thực đơn" card (rows id · VI · EN · giá · danh mục · trạm; `+ Thêm món`; JSON import covers it too).
- [ ] **Step 5:** `npm test`; demo scenario (b). Commit `feat: order food on the robot`.

---

### Task 8: Pay on the robot (`features.pay`)

**Files:**
- Modify: `data/lib/site.js` (`payment`), `data/lib/orchestrator.js` (`call what:'paid'` marks the table's open orders `paid-claimed` and includes the amount), `data/public/robot.html`, `data/public/setup.html`, `scripts/test.js`

**Interfaces:**
- `site.payment = { bank, account, name, qr? }` (`qr` = data URL of a static QR image uploaded in setup, ≤ 200 KB). Bill = sum of `st.orders` for the table with `status:'new'`.
- Robot pay screen: bill card (items, qty, sums, total) + QR: `navigator.onLine && payment.bank ? img.vietqr.io URL with amount/addInfo : payment.qr || text fallback ("Chuyển khoản tới {bank} {account} · {name} · {total}")`. Acts: `Tôi đã chuyển khoản · I've paid` → `call {what:'paid', amount}`; `Tiền mặt / thẻ · call staff` → `call {what:'staff'}`.
- Hidden when the table has no open orders ("Chưa có món nào để thanh toán").

- [ ] **Step 1: Tests**: `call paid` with amount marks orders `paid-claimed` and alerts with the amount; no open orders → alert still raised (guest may pay cash) but no state change.
- [ ] **Step 2:** Implement lib + setup card "Thanh toán" (bank, account, name, QR upload → data URL).
- [ ] **Step 3:** Robot pay screen; entry button `Thanh toán · Pay the bill` on idle-at-table/handoff when `features.pay`.
- [ ] **Step 4:** `npm test`; demo scenario (d). Commit `feat: pay by VietQR on the robot`.

---

### Task 9: Docs, seed, verification

**Files:**
- Modify: `docs/valetudo-setup.md` (features section: how to enable, what each needs), `data/site.json` (features all false, empty menu/payment), `web/demo.html` (scenarios list mentions order/pay/guide), `README`s

- [ ] **Step 1:** Full phase-2 acceptance (spec §8 GĐ2 a–f) on the web demo and with `fake-valetudo.js` (speed logged, call alerts).
- [ ] **Step 2:** `npm test`, `npm run smoke`, `npm run web`. Commit `docs: phase-2 features and flags`.
