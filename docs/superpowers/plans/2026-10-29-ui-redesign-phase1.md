# UI Redesign — Phase 1: restyle existing screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every existing screen (robot tablet, station dispatch + monitor, route designer, setup, table QR, demo hub, website) looks like the Claude Design round-3 mock-ups: dark app bar, Be Vietnam Pro, mint primary actions in a fixed action zone, no page scroll at 1280×800 and 800×1280. **No behaviour change**: every button sends the same WebSocket message as today; `lib/*`, `flows.json` and `npm test` untouched.

**Architecture:** Design tokens and shared components (`.appbar`, `.act`, `.seg`, `.tt`, `.strip`, `.toast`, `.screen`) live in `brand.css`; `common.js` gains `APPBAR()`, `L()` (bilingual label), `TONE`, `tableState()`, `strip()`. Each page keeps its state/`send` code and only swaps the HTML skeleton and render templates. Orientation is handled by `@media (orientation: portrait)` (and `:root[data-orient]` override for screenshots).

**Tech Stack:** Static HTML/CSS/JS, no build step, Node-RED static `public/`, Vercel static `web/`. Self-hosted woff2 fonts.

**Spec:** `docs/superpowers/specs/2026-10-29-ui-redesign-design.md` §2–§5, §7, §8 (GĐ1).

## Global Constraints

- Do not touch `data/lib/*`, `data/flows.json`, `data/settings.js`, `scripts/test*.js`. `npm test` must stay green after every task (it will, but run it).
- Every existing `send({type: …})` call keeps its payload. Grep before/after: `grep -o "type: *'[a-zA-Z]*'" data/public/*.html | sort -u` must be identical before and after the phase (allowed additions: none).
- Vietnamese UI strings; bilingual labels on the robot tablet and table QR only (`L(vi, en)`). No emoji in button labels (design uses none); keep emoji only in the hand-drawn floor obstacles (`🚶 🪑` → replaced by `N`/`G` discs, see Task 6).
- Colours only via tokens from `brand.css`; no new hex values inside page `<style>` except where the spec names one.
- Layout rule for tablet pages (robot, station, map, setup): `html, body { height: 100% }`, `.screen { height: 100dvh; overflow: hidden }`, inner lists scroll (`overflow: auto; min-height: 0`). The body must not scroll at 1280×800 or 800×1280 in any state listed in the Verification Checklist.
- Fonts self-hosted at `data/public/fonts/`; never link Google Fonts from `data/public`. `web/` copies the same files via `export-web.sh`.
- Commit after every task with the message given.

## Review Focus

1. **Portrait fallback** — at 800×1280 every page's action zone is at the bottom and the main content shrinks (`min-height: 0`) instead of pushing it off-screen. Check Task 3 (robot) and Task 4 (station) with the checklist.
2. **Re-render stability** — `setHTML()` still wraps every template so a 1 s tick does not recreate the button under the user's finger; `#timer` text stays outside the diffed HTML (Task 3).
3. **No lost control** — the spec's "thiết kế không vẽ nhưng phải giữ" list: recall card (`Thu hồi robot` when nothing selected), receive buttons (`✓ Đã nhận lại đồ / Đã dỡ chén đĩa`), 🔒 locked missions, `Khôi phục mặc định` (map + setup), `Xoá điểm`, `Xoá robot`, stale-config strip, save errors, robot picker in setup, demo reset. Each task names where they land.
4. **Message parity** — the grep in Global Constraints before/after each task.
5. **Offline LAN** — pages render with the self-hosted font and no external request (`grep -rn "googleapis\|fonts.gstatic" data/public` returns nothing).

---

### Task 1: Fonts and design tokens

**Files:**
- Create: `data/public/fonts/BeVietnamPro-400.woff2`, `-700.woff2`, `-900.woff2`, `data/public/fonts/JetBrainsMono-500.woff2`
- Modify: `data/public/brand.css` (tokens, `@font-face`, remove dark-mode blocks), `scripts/export-web.sh` (copy `fonts/`)

**Interfaces:**
- Produces CSS tokens: `--pill-ok --pill-go --pill-warn --pill-danger --warn-ink --alert-ink --bg-app --font --mono` (values in spec §2). `body { font-family: var(--font) }`.

- [ ] **Step 1:** Download the four woff2 files from Google Fonts' static CSS (fetch `https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;700;900&family=JetBrains+Mono:wght@500` with a modern Chrome UA, take the `vietnamese` + `latin` subset URLs — Be Vietnam Pro needs the Vietnamese subset; concatenating is not possible, so keep **two files per weight** if the subsets are split: `BeVietnamPro-400-vi.woff2` + `-latin.woff2`, with matching `unicode-range` in `@font-face`). Total must stay under ~250 KB; check with `du -sh data/public/fonts`.
- [ ] **Step 2:** In `brand.css` add `@font-face` rules (`font-display: swap`), the new tokens, set `body` font to `var(--font)`, remove the three `prefers-color-scheme` blocks and `:root[data-theme="dark"]` rules (all pages are light by design). Update `.pill.*` to the `--pill-*` backgrounds, `.toast` to the centred-bottom pill (`position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--deep); color: var(--mint); border-radius: 999px; padding: 12px 24px; font-weight: 800; box-shadow: 0 14px 34px rgba(7,29,33,.3)`; `.toast.error` danger/white; `.toast.warn` accent/`--alert-ink`). `.toasts` becomes a single-slot container (newest replaces, max 1).
- [ ] **Step 3:** `export-web.sh`: `rsync` already copies `data/public/` recursively → verify `fonts/` lands in `web/demo/fonts/` after `npm run web`. Add `fonts` to nothing else.
- [ ] **Step 4:** Open `http://localhost:1880/station.html` (or the web demo via `python3 -m http.server`) — DevTools Network shows `fonts/*.woff2` 200, computed font-family is Be Vietnam Pro, no request to googleapis.
- [ ] **Step 5:** Commit `style: self-hosted Be Vietnam Pro + design tokens, drop dark mode`.

---

### Task 2: Shared components in `brand.css` and `common.js`

**Files:**
- Modify: `data/public/brand.css` (append component section), `data/public/common.js`

**Interfaces:**
- `APPBAR({ title, sub, tabs?, right?, home? })` → HTML string for `<header class="appbar">`: `home` link (default `index.html`) wrapping `<img src="logo.svg">`; `.title` block (`<b>` title + `<small>` sub); `tabs` = `[{id, label, on}]` rendered as `.seg.dark` with `data-tab`; `right` raw HTML; always ends with `<span id="clock"></span><span class="dot" id="conn"></span>`. Caller wires `data-tab` clicks.
- `L(vi, en)` → `<b>${vi}</b><small>${en}</small>`.
- `TONE = { ok:'#b9fb75', go:'#63dcc5', warn:'#ff9f68', danger:'#d93d42' }` (moved from station.html).
- `tableState(t)` moved from `station.html` unchanged (returns `[text, cls]`).
- `strip(alerts, extra)` → HTML for `.strip` rows: `KIND` (`Cảnh báo`/`Lỗi`) · text · `clock(t)` · buttons: optional extra button HTML from `extra(a)` (station adds `Đã dọn lối đi` for `key` starting `blk-`), then `<button class="btn sm dark" data-act="ack" data-id="…">Đã biết</button>`.
- `startClock()` → sets `#clock` every second (shared by station/robot/map/setup).
- CSS classes (spec §2): `.appbar`, `.appbar .title b/small`, `.seg.dark`, `.act` + `.primary .outline .danger .warn .dark .armed`, `.tt` (+ `.busy .st`, `[aria-pressed=true]`, `.tag`), `.strip` (+ `.error`), `.screen`, `.body` (grid area), `.card` restyle (18px radius, no shadow), `.eyebrow.sm` (12px uppercase .1em muted — the design's card captions), `.stepper` (`− value +`), `.switch` (44×26 track for map.html).

- [ ] **Step 1:** Append the component CSS to `brand.css`. Keep old classes (`.btn`, `.pick`, `.seg button`) working so pages not yet migrated still render.
- [ ] **Step 2:** Add the JS helpers to `common.js`; move `TONE` and `tableState` out of `station.html` (station keeps working — it references the globals).
- [ ] **Step 3:** Smoke: load `station.html` and `index.html` — no console errors, old look still intact apart from toast/pill colours.
- [ ] **Step 4:** `npm test` green. Commit `style: shared appbar/action/strip components`.

---

### Task 3: `robot.html` — no-scroll tablet with fixed action zone

**Files:**
- Modify: `data/public/robot.html` (rewrite markup/CSS/templates; keep `ID`, `cfg`, `send` calls, `connect`, `tick`)

**Interfaces:**
- `view(r, m)` now returns `{ bar, sub, tone, body, acts, face? }` where `acts` is the HTML of the action zone (`.act` buttons / info boxes) and `body` the content column. `render()` writes `#bar`, `#sub`, `#body`, `#acts`, sets `body.className = 't-' + tone` and toggles `#estop` (now inside the header) with `r.halt === 'estop'`.
- Tones: `ok|go` → deep header, paper content; `warn` → accent header (deep text), `#fff4ec` content; `danger` → danger header, `#fbe8e6` content.
- Messages sent (unchanged set): `estop, confirm, cancelStop, cancel, resume(+atRobot), clear, dispatch(tables|toDish|release)`; **added** (already supported by orchestrator, no lib change): `pause {robot, by}` from the moving screen, `manual {robot, by}` (armed) from blocked screens.

- [ ] **Step 1:** New skeleton: `<div class="screen"><header class="appbar robot">logo · <div class="title"><b id="bar"></b><small id="sub"></small></div> · <span class="bat" id="bat"><i></i><span></span></span> · <span class="rid"><i class="dot"></i>R1</span> · <span id="clock"></span> · <button id="estop" class="stop">DỪNG · STOP</button></header><div class="body"><section id="body"></section><aside id="acts"></aside></div><div id="toast"></div></div>` plus the start overlay. CSS per spec §4.1: `.body { grid-template: minmax(0,1fr) / minmax(0,1fr) 380px }`, `@media (orientation: portrait), (max-width: 900px) { .body { grid-template: minmax(0,1fr) auto / minmax(0,1fr) } aside { flex-direction: row; flex-wrap: wrap } }`; `:root[data-orient=portrait]` duplicates the portrait rules (for `?orient=` screenshots: `document.documentElement.dataset.orient = qs.get('orient')`).
- [ ] **Step 2:** Redraw `face(mood, move)` (spec §4.1 "Mặt robot"): body `#dbe6e8`/`#b7c9cc`, screen `#12333a`, mint round eyes with glow filter, mouth arc; `sad`/`wait` → accent oval eyes + flat/downturned mouth; `sleep` → lines. Keep the `.move` bob animation.
- [ ] **Step 3:** Rewrite `view()` for the 7 designed states and the 11 derived states exactly as the two tables in spec §4.1 (content + acts). Helpers: `split(faceHTML, eyebrow, h1, en, extraHTML)` for the idle-style two-column block; `trays(active[], labels[])` for the 4-tray box; `routeList(m)` for the stops list; `act(cls, vi, en, dataAct, extra)`; `info(title, text)` for the dark info box. Battery alert replaces today's "Đang sạc" idle (`r.charging`). Idle action zone (phase 1): the dark `Nhân viên · Staff` button shows a toast "Gọi robot từ máy trạm · Call the robot from a station" (no message). Hidden future buttons are **not rendered** in phase 1 (no dead buttons).
- [ ] **Step 4:** Low-battery chip: when `r.battery < App.site.timing.lowBattery` and the robot is not charging, header `.bat` turns danger and the moving/handoff screens show the chip "Pin n% · về sạc sau việc này" (spec §6.8, UI-only).
- [ ] **Step 5:** Toast on robot: `#toast` pill top-centre of `#body`, 2.6 s; `toast()` from common.js is overridden locally to target it (`window.toast = …` after common.js).
- [ ] **Step 6:** Verify in the web demo at 1280×800 and 800×1280 through the full delivery of the checklist (idle → load → moving → handoff → return) plus `sim` faults (blocked, estop, offline, lowbat) and `pause`. No body scrollbar in any state; `#timer` ticks without re-rendering buttons (set a breakpoint or check `el.__html` unchanged).
- [ ] **Step 7:** Message-parity grep; `npm test`. Commit `ui(robot): single-screen tablet layout with fixed action rail`.

---

### Task 4: `station.html` — dispatch board

**Files:**
- Modify: `data/public/station.html` (markup/CSS/`renderTask`, `renderDesk`, setup dialog; keep `F`, `choose`, `send`, `hears`, `render` loop)

**Interfaces:**
- Views: `?view=desk|mon` (default from role? no — default `desk`; `ql` role opens `mon`); the appbar `.seg.dark` with `data-view` replaces `#views`. Role segmented `data-role` writes `me.role` + `localStorage` and calls `applyRole()`; `…` button opens the (trimmed) name dialog.
- Alerts → `strip(App.state.alerts, a => a.key.startsWith('blk-') ? '<button class="btn sm dark" data-act="clear" data-r="…">Đã dọn lối đi</button>' : '')` rendered in `#strips` under the appbar (both views). Robot id for the clear button: `App.state.robots.find(r => a.key === 'blk-' + r.id)`.
- Quick notes: `const NOTES = ['Không hành', 'Ít cay', 'Món nóng', 'Thêm chén']`; `F.chips = []`; `F.note` sent = `[...F.chips, F.free].filter(Boolean).join(', ')`. Free-text input `#note` stays (placeholder "Khác…").
- Footer adds `Can thiệp {kpi.interventions}`.
- Preview card has two modes: **send mode** when `selected().length > 0` (title, robot, slots, notes, urgent, send, `Bỏ chọn`), **recall mode** when nothing is selected: caption `LỆNH GẦN NHẤT CỦA TRẠM NÀY`, `tgt = cancelTarget()` → label, robot, `missionStatus`, and one big button: `arrived(tgt)` → `receiveBtn(tgt, 'act primary')`; `locked(tgt)` → explanatory text, no button; else `.act.danger` `Thu hồi robot · Recall` (armed `cm-<id>` → `cancel`); no target → text "Không có lệnh để thu hồi". Keep `cancelTarget()`, `locked()`, `arrived()`.
- Removed: `#banner` only.

- [ ] **Step 1:** Skeleton (spec §4.2): `.screen > header.appbar + #strips + main.desk.body(grid 270px/1fr/330px) + footer.kpis`. Portrait: 1 column, rows `auto minmax(0,1fr) auto`; robots aside becomes 2 columns + queue in column 3 (`grid-template-columns: repeat(2,minmax(0,1fr)) minmax(0,1.3fr)`); preview card 2 columns with the send button spanning rows on the right.
- [ ] **Step 2:** `renderDesk()`: robots list as `.rbtn` cards (`Bất kỳ · gần nhất` first, dot colour `TONE[tone]`, battery %, status), queue rows with `✕`/armed `Huỷ?`, 🔒, receive button (keep `receiveBtn`), task row (3 `.task` buttons with `L()`), pick row (`LẤY TẠI` chips / bus text / summon text + right hint), table grid (`.tt`, 4 fixed columns, summon spots first), preview card (title per spec, `Robot: …`, 4 slots `K1–K4`, note chips, urgent toggle, send `.act.primary` 104px, `Bỏ chọn`), footer line.
- [ ] **Step 3:** Setup dialog: keep `<dialog id="setup">` with name field only + role grid **only when `me` is null on first run** (so a fresh tablet still picks its role once); afterwards role changes via the appbar segmented.
- [ ] **Step 4:** Remove `banner`; implement the preview card's recall mode; ensure `arrived(m)` receive buttons remain reachable in the queue rows, the recall card and the mission list (Task 5).
- [ ] **Step 5:** Verify checklist scenario 1 at both orientations; the queue scrolls internally; alert strip appears on `sim block` with a working `Đã dọn lối đi`. Message-parity grep (expect the same set; `cancel` now only from queue rows). `npm test`.
- [ ] **Step 6:** Commit `ui(station): one-screen dispatch board`.

---

### Task 5: `station.html` — monitor view with tabbed side panel

**Files:**
- Modify: `data/public/station.html` (monitor markup/CSS; `renderMode`, `renderOps`, `renderSim`, `render`), `data/public/common.js` (`floorSVG`/`netSVG`/`obstacleSVG`/`LEGEND` colours), `data/public/vmap.js` (`COL` palette, `resize()`)

**Interfaces:**
- `#mon` layout `minmax(0,1fr) 420px`; portrait `auto minmax(0,1fr)` with the map `flex: 0 0 auto` (aspect-ratio box).
- Side panel tabs `data-ptab="fleet|missions|log|sim"` (local `PTAB`, default `fleet`; `sim` hidden when `!hasSim()`); `render()` fills only the active tab.
- Sim tab buttons: existing `sim` faults + new `Dừng khẩn cấp` → `send({type:'estop', robot: simRobot, by})` (existing message) + `↺ Khởi động lại demo` (armed `reset`).
- `vmap.resize()` sets canvas pixel size from its CSS box (devicePixelRatio-aware) and redraws; station and setup call it on `resize` and when the tab becomes visible.
- Floor colours: zones station `#e3f6d0`, dish `#d9f3ee`, dock `#ffe4cc`/`#ffbf8a`; table fill `#fff` stroke `#a9bcb5`, `.busy` stroke `--green` .14, `.sel` deep fill/mint text; lanes `#63dcc5` / narrow dashed `#ff9f68` / slow `#e88a3c` .7 / closed dashed `--danger`; robots r .5 (≈40px) fill `TONE`, stroke deep .09, red ring when blocked/wait; obstacles 26px discs with `N`/`G` text (`#ffe4cc`/`#ff9f68` person, `#fbd9da`/`#d93d42` object).

- [ ] **Step 1:** Monitor skeleton per spec §4.3 (tools row, map card, legend row, KPI row, tabbed aside). Reuse `missionHTML`, `robotHTML` (restyle classes to `.card`-like rows; keep every button incl. `Màn robot ↗`), log rows (52px time column), sim grid.
- [ ] **Step 2:** Recolour `floorSVG/netSVG/obstacleSVG/LEGEND` and the `#map` CSS in station; update `vmap.js` `COL` and add `resize()`; legend = one row mixing lane styles and robot tone dots.
- [ ] **Step 3:** Add `?view=mon` handling and the `data-view` segmented in the appbar; `ql` role defaults to `mon`.
- [ ] **Step 4:** Verify checklist scenario 3 at both orientations, Valetudo-only site (`hasSim()` false: tools/sim hidden, canvas resizes, no empty gaps). `npm test`.
- [ ] **Step 5:** Commit `ui(station): monitor view with map, KPIs and tabbed panel`.

---

### Task 6: `map.html` — route designer

**Files:**
- Modify: `data/public/map.html`

**Interfaces:**
- Appbar right: `#ver` pill, `#dirty` text (hidden in portrait via CSS), `#revert`, `#defaults` (armed), `#apply` (mint). Buttons get `opacity: .4` when disabled instead of the generic `.btn:disabled`.
- Panel: `.switch` rows replace the checkboxes (same `data-prop` so the existing `change` handler keeps working — render as `<button class="switch" data-prop="oneway" aria-pressed="true|false">`; convert the `change` listener to a `click` listener toggling the prop). Node panel unchanged. Rules card → `<details class="card"><summary>Nguyên tắc thiết kế lộ trình</summary>…</details>` under the check card.

- [ ] **Step 1:** Skeleton `.screen` + appbar + `.body` grid `minmax(0,1fr) 360px` (portrait: map on top with `aspect-ratio`, aside two columns `1fr 1.3fr`: tools+check left, selection right).
- [ ] **Step 2:** Switch rows, legend row (6 items), tool segmented (3 tools), `beforeunload` guard kept.
- [ ] **Step 3:** Verify checklist scenario 4; drag still works on touch (`touch-action: none` on the svg). `npm test`. Commit `ui(map): route designer in the shared shell`.

---

### Task 7: `setup.html` — configuration

**Files:**
- Modify: `data/public/setup.html`, `data/public/vmap.js` (uses `resize()` from Task 5)

**Interfaces:**
- Appbar tabs `data-tab` drive the existing `tab` variable (`?tab=` kept). `#rev` pill, `#revert`, `#save` in the appbar; `#strips` under it renders: stale strip (accent, with `#reload` button), save error strip (danger, text from `msg()`), success as toast.
- Points tab: delete moves to the selected-point tool row as `#delPoint` (armed; disabled for `kind:'dish'`); list rows lose their delete button but keep `data-pt`, name input, pill and small mono id.
- Robots tab: driver segmented (`sim`/`valetudo`) replaces the select; knobs under a `<details>` "Nâng cao · n thông số"; connection pill from `App.state.robots[].offline`; battery steppers bound to `D.timing.lowBattery/chargedBattery` (±5, 5–95).
- Roles tab: default-tab segmented (`deliver|bus|summon`), home select; timing steppers (`loadSec ±10`, `handoffSec ±10`, `remindSec ±5`, `standbySec ±30`, `trays ±1`) with a number input revealed on tap of the value.
- Backup tab: centred 640px card.
- `.stepper` writes through the same `setDirty(true)` path as today's inputs.

- [ ] **Step 1:** Skeleton + appbar + strips; port each tab's render function to the new markup keeping ids used by handlers (`points`, `robots`, `roles`, `timing`, `info`, `download`, `upload`, `reset`, `addTable`, `addStation`, `addRobot`, `useRobot`, `probe`, `clearXY`, `zoom`, arrows `data-mv`).
- [ ] **Step 2:** Canvas fills the card (`flex:1; min-height:0`); call `vm.resize()` on `resize` and tab switch; map warning overlay kept.
- [ ] **Step 3:** Verify checklist scenario 5 at both orientations, plus: stale strip when another tab saves; error strip on an invalid id; import JSON; Valetudo site with 2 robots shows the robot segmented. `npm test`. Commit `ui(setup): tabs in the app bar, steppers, single-screen layout`.

---

### Task 8: `table.html` — customer QR page

**Files:**
- Modify: `data/public/table.html`

- [ ] **Step 1:** Markup per spec §4.6: header (logo, wordmark, placeholder slot `#lang` empty), eyebrow + big table name, list of order cards (title · time, items line = `m.note` or `what`, 4 progress bars, status line coloured, cancel `.act.warn` armed), note paragraph. Footer with two buttons is **not rendered** in phase 1 (left as a comment pointing to spec §6.1). Toast pill at `bottom: 120px` → `bottom: 24px` since no footer yet.
- [ ] **Step 2:** Verify scenario 6 on a 390×844 viewport and on desktop (max-width 480px centred). Commit `ui(table): phone layout`.

---

### Task 9: Demo hub (`index.html`, `web/demo/index.html`, `showcase.html`)

**Files:**
- Modify: `data/public/index.html`, `web/demo/index.html`, `web/demo/showcase.html`

- [ ] **Step 1:** `index.html` per spec §4.7: dark hero, four groups rendered from `App.site` (roles → station cards incl. `Giám sát & sơ đồ` → `station.html?role=ql&view=mon`; robots; customer card "Bàn 05 · Theo dõi món" + table number grid; config cards with `hasSim()` gate). Keep the `⚙️ Node-RED` link in the hero.
- [ ] **Step 2:** `web/demo/index.html`: same hub + hero buttons `▶ Chế độ trình diễn` / `← Trang giới thiệu`, cards "Kịch bản 2 phút" and "Về bản demo này" (reset button armed) in the same card style. `showcase.html`: appbar only.
- [ ] **Step 3:** Run `npm run web`; open `web/demo/` locally; all links resolve. Commit `ui(hub): demo hub groups`.

---

### Task 10: Website (`web/`)

**Files:**
- Create: `web/site.css`, `web/serve.html`, `web/demo.html`, `web/contact.html`
- Modify: `web/index.html`, `web/README.md`

**Interfaces:**
- `site.css` = tokens + `@font-face` pointing at `demo/fonts/` + website classes (`.top .nav .hero .section .cards .cta .footer .form`). Each page: sticky header with 4 nav pills (`aria-current` on the active page) + mint `Đặt lịch demo` → `contact.html`.
- Contact form keeps the current submit mechanism from `web/index.html` (read it first; move the handler verbatim) and shows the "Đã nhận yêu cầu" state.

- [ ] **Step 1:** Build `site.css` and `index.html` (Home) from spec §4.8; keep the existing CSS robot illustration in the hero where the design has a photo placeholder; keep meta/OG.
- [ ] **Step 2:** `serve.html`, `demo.html`, `contact.html` with the texts from the design file (`Website.dc.html` `renderVals()` arrays: steps, cases, features, apps, scenarios, next).
- [ ] **Step 3:** `web/README.md`: list the pages. Local check `python3 -m http.server 4173` → all four pages, nav, demo links, form. Commit `web: four-page site in the new design`.

---

### Task 11: Verification pass and docs

**Files:**
- Modify: `docs/valetudo-setup.md` (screenshots/wording of buttons if names changed), `web/README.md`

- [ ] **Step 1:** Run the full Verification Checklist below at 1280×800 and 800×1280 on the web demo, and `npm start` + `scripts/fake-valetudo.js` for the Valetudo-only path (setup canvas, monitor canvas, robot `wait` screen).
- [ ] **Step 2:** `grep -rn "googleapis\|gstatic" data/public web` → nothing. Message-parity grep equals the baseline captured before Task 3.
- [ ] **Step 3:** `npm test`, `npm run smoke`, `npm run web`. Commit `docs: phase-1 UI redesign notes`.

## Verification Checklist (both orientations, no body scrollbar)

| Page | States |
|---|---|
| `robot.html` | start overlay · idle · charging (battery alert) · load/xếp món · moving (2 stops) · moving + wait · handoff · return · collect · unload · standby at station (pick tables) · standby elsewhere · paused · blocked · blocked noroute · estop · offline · toDock |
| `station.html?view=desk` | each role · deliver with 0/2/4 tables · bus · summon · queue with locked + arrived receive · alert strip (blocked) |
| `station.html?view=mon` | pick/object/person modes · each side tab · Valetudo canvas · KPI row |
| `map.html` | nothing selected · edge selected (switches) · node selected · dirty state |
| `setup.html` | 4 tabs · point selected / not located · stale strip · error strip · 2 Valetudo robots |
| `table.html` | 0 / 2 orders · armed cancel · cancelled · done |
| `index.html`, `web/demo/`, `web/*.html` | desktop + 390px phone |
