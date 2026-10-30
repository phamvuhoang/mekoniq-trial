// Browser smoke for the setup "Tính năng" tab (spec §8) and the guest / robot / station screens under that policy (§5, §6, §9)
// against the held temp services (docs/testing.md): SMOKE_HOLD=1 node scripts/smoke-review.js, wait for "HOLD for browser
// tests", then run this. Saves and resets change only that temp site; a fake Valetudo robot talks to the temp broker on 1886.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const base = "http://127.0.0.1:1891";
const errors = [];
let browser, fixture, fake;

const expectText = async (page, selector, text) =>
  assert.match(await page.locator(selector).innerText(), new RegExp(text));
async function open(context, path) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(path + ": " + e.message));
  await page.goto(base + "/" + path);
  await page.waitForFunction(() => typeof D !== "undefined" && D);
  return page;
}
// Runs in the page. Every control can be touched: app bar controls as laid out (.screen clips and cannot be scrolled),
// tab controls after scrolling only real scroll areas (tab, cards), never the clipped frame. Returns what fails.
function unreachable() {
  const screen = document.querySelector(".screen"), out = [];
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight &&
      el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  };
  const name = (el) => el.id || el.dataset.feat || el.dataset.tab || el.dataset.m || el.textContent.trim().slice(0, 24);
  for (const el of document.querySelectorAll(".appbar a, .appbar button")) if (!hit(el)) out.push("app bar: " + name(el));
  for (const el of document.querySelectorAll(`#tab-${tab} :is(input, select, button, a)`)) {
    if (el.closest("[hidden]")) continue;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!hit(el) || screen.scrollTop || screen.scrollLeft || scrollX || scrollY) out.push(name(el));
  }
  return out;
}
async function save(page) {
  await page.locator("#save").click();
  await page.waitForFunction(() => !saving && !dirty);
}
// Station / robot / guest page, ready once the site and the first state arrived.
async function app(context, path) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(path + ": " + e.message));
  await page.goto(base + "/" + path);
  await page.waitForFunction(() => App.site && App.state);
  return page;
}
// Saves an edit of the live site through setup.html, like a manager changing the config mid-service.
async function push(context, edit) {
  const page = await open(context, "setup.html");
  const site = await page.evaluate(() => structuredClone(App.site));
  edit(site);
  await page.evaluate((s) => { D = s; setDirty(true); }, site);
  await save(page);
  await page.close();
}
// Records every toast the page shows (common.js toast, or the robot screen's own).
const spyToasts = (page) => page.evaluate(() => { window.toasts = []; const t = window.toast; window.toast = (x, l) => { toasts.push(x); t(x, l); }; });
const robotOf = (page, id) => page.evaluate((id) => App.state.robots.find((r) => r.id === id), id);
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
// One fresh context per scenario: empty state (reset), then the same saved site — every feature off, no request station —
// changed by edit(site) for this scenario.
async function scenario(name, fn, edit = () => {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await open(context, "setup.html");
    await page.evaluate(() => send({ type: "reset", by: "smoke" }));
    const site = structuredClone(fixture);
    edit(site);
    await page.evaluate((f) => { D = structuredClone(f); D.rev = App.site.rev; setDirty(true); }, site);
    await save(page);
    await page.close();
    await fn(context);
    console.log("✓ " + name);
  } finally {
    await context.close();
  }
}

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  try {
    const context = await browser.newContext();
    const page = await open(context, "setup.html");
    fixture = await page.evaluate(() => ({
      ...structuredClone(App.site), serviceProfile: "custom", customerCancel: "request", service: { requestStation: null },
      features: { callStaff: false, requestBill: false, guide: false, order: false, pay: false, busRobot: false }, notes: [...SiteLib.NOTES],
    }));
    await context.close();
    const kinds = Object.values(fixture.points).map((p) => p.kind);
    assert(kinds.includes("table") && kinds.includes("station") && fixture.menu.items.length, "temp site needs tables, a station and a menu");
    const station = Object.keys(fixture.points).find((k) => fixture.points[k].kind === "station");
    assert.deepEqual([station, fixture.robots.map((r) => r.id), fixture.menu.items.some((i) => i.id === "pho" && i.cat === fixture.menu.cats[0].id)], ["bar", ["R1", "R2", "R3"], true]);
    // Fake Valetudo robot on the temp broker (go/set -> idle at the target 4 s later); used by the guide scenario.
    fake = spawn(process.execPath, [path.join(__dirname, "fake-valetudo.js"), "smoke/guide", "mqtt://127.0.0.1:1886"], { stdio: "ignore" });

    await scenario("guest alias, unknown tab and Hệ thống link open the one editor; layout fits", async (context) => {
      const page = await open(context, "setup.html?tab=guest");
      assert.equal(await page.evaluate(() => tab), "features");
      assert(await page.locator("#tab-features").isVisible());
      assert.equal(await page.locator('.appbar [data-tab="features"]').getAttribute("aria-pressed"), "true");
      await expectText(page, '.appbar [data-tab="features"]', "Tính năng");
      assert.doesNotMatch(await page.locator("#features").innerText(), /callStaff|requestBill|busRobot|customerCancel|requestStation|serviceProfile/);
      await page.goto(base + "/setup.html?tab=nope");
      await page.waitForFunction(() => typeof D !== "undefined" && D);
      assert.equal(await page.evaluate(() => tab), "points");
      await page.goto(base + "/setup.html?tab=system");
      await page.waitForFunction(() => typeof D !== "undefined" && D);
      assert.match(await page.locator("#tab-system").textContent(), /Tính năng đang sử dụng/);   // eyebrow: innerText is uppercased
      assert.equal(await page.locator("#tab-system input[type=checkbox]").count(), 0);
      await page.locator("#manageFeatures").click();
      assert(await page.locator("#tab-features").isVisible());
      assert.match(page.url(), /tab=features/);
      for (const [width, height] of [[1280, 800], [800, 1280]])
        for (const t of ["features", "system"]) {
          await page.setViewportSize({ width, height });
          await page.goto(base + "/setup.html?tab=" + t);
          await page.waitForFunction(() => typeof D !== "undefined" && D);
          await page.waitForTimeout(300);
          assert.deepEqual(await page.evaluate(unreachable), [], `${t} at ${width}×${height}: controls off-screen or covered`);
          if (process.env.SMOKE_SHOTS) await page.screenshot({ path: `${process.env.SMOKE_SHOTS}/setup-${t}-${width}x${height}.png` });
        }
    });

    await scenario("order on with an empty menu saves as Chưa đủ điều kiện, reason links to the menu", async (context) => {
      const page = await open(context, "setup.html?tab=guest");
      await page.evaluate(() => { D.menu = { cats: [], items: [] }; setDirty(true); renderFeatures(); });
      await page.locator('[data-feat="order"]').check();
      await page.locator("#save").click();
      await page.waitForFunction(() => !saving);
      await expectText(page, "#features", "Chưa đủ điều kiện");
      assert.equal(await page.evaluate(() => App.site.features.order), true);
      await expectText(page, '[data-why="order"]', "Thực đơn chưa có món");
      await page.locator('[data-why="order"] [data-go]').click();
      assert(await page.evaluate(() => $("menuCard").contains(document.activeElement)));
    });

    await scenario("call staff needs the request station; Hệ thống shows only the saved config", async (context) => {
      const page = await open(context, "setup.html?tab=features");
      await page.locator('[data-feat="callStaff"]').check();
      await expectText(page, '[data-pill="callStaff"]', "Chưa đủ điều kiện");
      await expectText(page, '[data-why="callStaff"]', "trạm nhận yêu cầu");
      await page.locator('[data-why="callStaff"] [data-go="#reqStation"]').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "reqStation");
      await page.selectOption("#reqStation", station);
      await expectText(page, '[data-pill="callStaff"]', "Đang bật");
      await expectText(page, "#featNote", "Bản nháp — chưa áp dụng");
      await page.evaluate(() => showTab("system"));
      await expectText(page, "#sysFeatures", "Gọi nhân viên\\s*Đã tắt");
      await page.evaluate(() => showTab("features"));
      await save(page);
      assert.equal(await page.evaluate(() => App.site.service.requestStation), station);
      assert.equal(await page.locator("#featNote").innerText(), "");
      await page.evaluate(() => showTab("system"));
      await expectText(page, "#sysFeatures", "Gọi nhân viên\\s*Đang bật");
    });

    await scenario("all quick notes removed stay [] after save and reload", async (context) => {
      const page = await open(context, "setup.html?tab=roles");
      while (await page.locator("[data-delnote]").count()) await page.locator("[data-delnote]").first().click();
      await save(page);
      await page.reload();
      await page.waitForFunction(() => typeof D !== "undefined" && D);
      assert.deepEqual(await page.evaluate(() => App.site.notes), []);
      assert.equal(await page.locator("[data-note]").count(), 0);
      await expectText(page, "#notes", "Không có chip");
    });

    await scenario("preset changes only the draft, lists the changes, a later toggle makes it custom", async (context) => {
      const page = await open(context, "setup.html?tab=features");
      const rev = await page.evaluate(() => App.site.rev);
      await page.evaluate(() => { window.sent = []; const s = send; send = (o) => { sent.push(o.type); s(o); }; });
      await page.selectOption("#preset", "table-service");
      await page.locator("#applyPreset").click();
      assert.deepEqual(await page.evaluate(() => [D.serviceProfile, D.features.callStaff, D.features.requestBill, D.features.order, D.customerCancel]),
        ["table-service", true, true, false, "request"]);
      assert(await page.evaluate(() => JSON.stringify(D.menu) === JSON.stringify(App.site.menu) && JSON.stringify(D.notes) === JSON.stringify(App.site.notes)));
      assert.deepEqual(await page.evaluate(() => sent.filter((t) => t === "siteSave")), []);
      await expectText(page, "#featNote", "Mô hình phục vụ: Tự cấu hình → Phục vụ tại bàn, trả sau");
      await expectText(page, "#featNote", "Gọi nhân viên: Tắt → Bật");
      await expectText(page, "#featNote", "Yêu cầu tính tiền: Tắt → Bật");
      const other = await open(context, "setup.html");
      assert.deepEqual(await other.evaluate(() => [App.site.rev, App.site.features.callStaff, App.site.serviceProfile]), [rev, false, "custom"]);
      await page.locator('[data-feat="busRobot"]').check();
      assert.equal(await page.evaluate(() => D.serviceProfile), "custom");
      await page.locator('[data-cancel="direct"]').click();
      await expectText(page, "#featNote", "Khách trả/huỷ món: Báo nhân viên → Khách tự gửi trả");
      await page.locator("#revert").click();
      assert.equal(await page.locator("#featNote").innerText(), "");
      assert.equal(await page.evaluate(() => D.features.callStaff), false);
    });

    await scenario("competing save keeps the feature draft and reports the conflict", async (context) => {
      const a = await open(context, "setup.html?tab=features"), b = await open(context, "setup.html?tab=features");
      await a.locator('[data-feat="requestBill"]').check();
      await b.locator('[data-feat="busRobot"]').check();
      await save(b);
      await a.waitForFunction(() => stale);
      assert.deepEqual(await a.evaluate(() => [dirty, D.features.requestBill, App.site.features.busRobot]), [true, true, true]);
      await a.locator('[data-feat="guide"]').check();   // still editable; Lưu now refused by rev
      await a.locator("#save").click();
      await a.waitForFunction(() => !saving);
      await expectText(a, "#strips", "Không lưu");
      assert.equal(await a.evaluate(() => D.features.requestBill && dirty), true);
      await a.locator("#reload").click();
      assert.deepEqual(await a.evaluate(() => [dirty, D.features.requestBill, D.features.busRobot]), [false, false, true]);
    });

    await scenario("import with a string flag is refused by normalize and nothing is saved", async (context) => {
      const page = await open(context, "setup.html?tab=backup");
      const rev = await page.evaluate(() => App.site.rev);
      const bad = { ...fixture, features: { ...fixture.features, order: "false" } };
      await page.locator("#upload").setInputFiles({ name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
      await page.waitForFunction(() => err);
      await expectText(page, "#strips", "phải là true hoặc false");
      assert.deepEqual(await page.evaluate(() => [dirty, D.features.order, App.site.rev]), [false, false, rev]);
    });

    await scenario("migration notice until a site arrives without the flag; Lưu enabled without edits", async (context) => {
      const page = await open(context, "setup.html?tab=features");
      await page.evaluate(() => Transport.ws.onmessage({ data: JSON.stringify({ type: "site", site: App.site, migrated: true }) }));   // a hello while the live site is legacy
      await expectText(page, "#featNote", "Cấu hình cũ đã được chuyển sang dạng mới — kiểm tra Trạm nhận yêu cầu rồi bấm Lưu");
      assert.deepEqual(await page.evaluate(() => [dirty, $("save").disabled, $("save").textContent]), [false, false, "Lưu"]);
      await page.locator("#save").click();
      await page.waitForFunction(() => !saving && !App.migrated);
      assert.equal(await page.locator("#featNote").innerText(), "");
      assert.equal(await page.evaluate(() => $("save").disabled), true);
    });

    await scenario("a save lost in a reconnect is reported, never toasted as saved", async (context) => {
      const page = await open(context, "setup.html?tab=features");
      await page.evaluate(() => {
        window.toasts = []; const t = toast; toast = (x, l) => { toasts.push(x); t(x, l); };
        const s = send; send = (o) => { if (o.type !== "siteSave") s(o); };   // the save never reaches the server
      });
      await page.locator('[data-feat="pay"]').check();
      await page.locator("#save").click();
      await page.evaluate(() => Transport.ws.close());
      await page.waitForFunction(() => !saving, null, { timeout: 10000 });
      await expectText(page, "#strips", "Chưa lưu");
      assert.deepEqual(await page.evaluate(() => [dirty, D.features.pay, toasts.filter((x) => /Đã lưu/.test(x))]), [true, true, []]);
    });

    await scenario("QR guest: bill button alone, toasts only on the reply, return request alerts staff and the trip goes on", async (context) => {
      const st = await app(context, "station.html?role=bep&name=Smoke");
      await st.locator('[data-f="t:T01"]').click();   // notes [] -> no chips, free text stays
      assert.equal(await st.locator("#pvOpts .notes .chip").count(), 0);
      assert(await st.locator("#note").isVisible());
      await st.locator('#pvSend [data-act="unpick"]').click();
      await st.evaluate(() => send({ type: "create", kind: "deliver", from: "kitchen", tables: ["T05"], robot: "R1", by: "Smoke" }));
      const guest = await app(context, "table.html?t=T05");
      await guest.setViewportSize({ width: 390, height: 844 });
      await guest.locator('[data-act="returnRequest"]').waitFor();
      assert.deepEqual(await guest.locator("[data-call]").evaluateAll((b) => b.map((x) => x.dataset.call + ":" + x.textContent)), ["bill:Yêu cầu tính tiền"]);
      assert.equal(await guest.locator('[data-act="cancelStop"]').count(), 0);
      assert.doesNotMatch(await guest.locator("body").innerText(), /Xin hoá đơn/);
      assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "QR page scrolls sideways at 390 px");
      if (process.env.SMOKE_SHOTS) await guest.screenshot({ path: `${process.env.SMOKE_SHOTS}/table-request-390.png`, fullPage: true });

      await spyToasts(guest);
      await guest.evaluate(() => { window.realSend = send; send = (o) => { if (o.type !== "call") realSend(o); }; });   // the call never arrives
      await guest.locator('[data-call="bill"]').click();
      assert.deepEqual(await guest.evaluate(() => [$("foot").textContent, document.querySelector('[data-call="bill"]').disabled, toasts]), ["Đang gửi…", true, []]);
      await guest.waitForFunction(() => toasts.length, null, { timeout: 15000 });
      assert.deepEqual(await guest.evaluate(() => [toasts, document.querySelector('[data-call="bill"]').disabled]), [["Chưa nhận được xác nhận — vui lòng thử lại"], false]);
      assert(!(await st.evaluate(() => App.state.alerts.some((a) => a.key.startsWith("call-")))));
      await guest.evaluate(() => { send = realSend; toasts.length = 0; });
      await guest.locator('[data-call="bill"]').click();
      await guest.waitForFunction(() => toasts.length);
      assert.deepEqual(await guest.evaluate(() => toasts), ["Đã yêu cầu tính tiền — nhân viên sẽ tới"]);
      await st.waitForFunction(() => App.state.alerts.some((a) => a.key === "call-bill-T05" && a.station === "bar"));

      await guest.locator('[data-act="returnRequest"]').click();
      await st.waitForFunction(() => App.state.alerts.some((a) => a.key.startsWith("return-")));
      assert.equal(await guest.evaluate(() => App.state.missions[0].status), "active");
      await guest.waitForFunction(() => toasts.includes("Đã báo nhân viên — vui lòng chờ"));
      const strips = await st.locator("#strips").innerText();
      assert.match(strips, /Trạm khác · Quầy pha chế/);   // call-bill rings at the request station
      assert.match(strips, /Trạm này · Bếp/);   // return goes to the trip's own station
      assert.doesNotMatch(strips, /Đã thu tiền/);
      await st.locator('[data-act="openMission"]').click();
      assert(await st.locator("#pbody .mission.focus").isVisible());
      assert(await st.locator('#pbody .mission.focus [data-act="cancelStop"]').count());   // the usual per-table recall

      const m = await st.evaluate(() => App.state.missions[0].id);
      await guest.evaluate(() => { toasts.length = 0; });
      await st.evaluate((m) => send({ type: "retarget", mission: m, stop: 1, to: "T06", by: "Smoke" }), m);   // kitchen fixes a mix-up
      await guest.waitForFunction(() => !document.querySelector('[data-act="returnRequest"]') && toasts.some((x) => /sửa nhầm bàn/.test(x)));
    }, (s) => { s.features.requestBill = true; s.service.requestStation = "bar"; s.notes = []; });

    await scenario("robot order: off keeps the open cart, back on drops items gone from the menu, only the ok reply empties it", async (context) => {
      const robot = await app(context, "robot.html?robot=R1");
      await robot.locator("#start").click();
      await robot.locator('[data-act="order"]').click();
      await robot.locator('[data-ot="T05"]').click();
      for (const id of ["pho", "buncha"]) await robot.locator(`[data-qty="${id}"][data-d="1"]`).click();
      await push(context, (s) => { s.features.order = false; });
      await robot.waitForFunction(() => document.querySelector('[data-act="orderSend"]').disabled);
      assert.match(await robot.locator("#acts").innerText(), /Tạm ngưng gọi món/);
      assert.deepEqual(await robot.evaluate(() => cart), { pho: 1, buncha: 1 });
      for (const [width, height] of [[1280, 800], [800, 1280]]) {
        await robot.setViewportSize({ width, height });
        await robot.waitForTimeout(200);
        assert(await fits(robot), `robot order screen overflows at ${width}×${height}`);
        if (process.env.SMOKE_SHOTS) await robot.screenshot({ path: `${process.env.SMOKE_SHOTS}/robot-order-off-${width}x${height}.png` });
      }
      await spyToasts(robot);
      await push(context, (s) => { s.features.order = true; s.menu.items = s.menu.items.filter((i) => i.id !== "buncha"); });
      await robot.waitForFunction(() => !document.querySelector('[data-act="orderSend"]').disabled);
      assert.deepEqual(await robot.evaluate(() => [cart, toasts]), [{ pho: 1 }, ["Món không còn trong thực đơn đã được bỏ khỏi giỏ · Items no longer on the menu were removed"]]);
      await robot.locator('[data-act="orderSend"]').click();
      await robot.waitForFunction(() => !ordering);
      assert.deepEqual(await robot.evaluate(() => [cart, toasts.at(-1), App.state.orders.map((o) => o.table + ":" + o.items.map((i) => i.id))]),
        [{}, "Đã gửi bếp · Sent to the kitchen", ["T05:pho"]]);
    }, (s) => { s.features.order = true; });

    await scenario("guide: staff pick and confirm; slow button only on the simulator; guide off mid-trip still finishes; bus off hides robot shortcuts", async (context) => {
      const sendAs = (page, d) => page.evaluate((d) => send({ by: "Smoke", ...d }), d);
      const r1 = await app(context, "robot.html?robot=R1"), r2 = await app(context, "robot.html?robot=R2");
      for (const p of [r1, r2]) await p.locator("#start").click();
      await sendAs(r1, { type: "create", kind: "summon", to: "bar", robot: "R1" });
      await sendAs(r1, { type: "create", kind: "summon", to: "kitchen", robot: "R2" });
      for (const [p, id] of [[r1, "R1"], [r2, "R2"]])
        await p.waitForFunction((id) => App.state.robots.find((r) => r.id === id).phase === "atStop", id, { timeout: 30000 });
      assert.deepEqual(await r1.evaluate(() => [...document.querySelectorAll("[data-mode]")].map((b) => b.dataset.mode)), ["deliver"]);
      assert.equal(await r1.locator('[data-act="toDish"]').count(), 0);

      const lead = async (p, id, table) => {
        assert.match(await p.locator('[data-act="guide"]').innerText(), /Nhân viên: dẫn khách tới bàn/);
        await p.locator('[data-act="guide"]').click();
        assert(await p.locator('[data-act="guideGo"]').isDisabled());
        assert.equal(await p.locator("#body .tt .st").count(), 0);   // no table status: nothing claims a table is free
        await p.locator(`[data-g="${table}"]`).click();
        assert.equal(await robotOf(p, id).then((r) => r.phase), "atStop", "a pick alone never moves the robot");
        await p.locator('[data-act="guideGo"]').click();
        await p.waitForFunction((id) => { const r = App.state.robots.find((x) => x.id === id), m = missionOf(r); return r.phase === "toStop" && m && m.kind === "guide"; }, id);
        await p.waitForFunction(() => /^Dẫn khách →/.test($("bar").textContent));
      };
      await lead(r2, "R2", "T05");
      assert.equal(await r2.locator('[data-act="speed"]').count(), 0);   // Valetudo: no slow mode

      await lead(r1, "R1", "T06");
      assert.equal(await r1.locator('[data-act="speed"]').count(), 1);
      await spyToasts(r1);
      await r1.locator('[data-act="speed"]').click();
      await r1.waitForFunction(() => App.state.robots.find((r) => r.id === "R1").slow > 0 && /Đi bình thường/.test(document.querySelector('[data-act="speed"]').textContent));
      const cancel = await r1.locator('[data-arm="cg"]').elementHandle();
      await r1.waitForTimeout(1500);   // ETA ticks: the cancel button must not be re-created
      assert(await cancel.evaluate((e) => e.isConnected));
      await r1.locator('[data-act="speed"]').click();
      await r1.waitForFunction(() => !App.state.robots.find((r) => r.id === "R1").slow);
      assert.deepEqual(await r1.evaluate(() => toasts), []);

      await push(context, (s) => { s.features.guide = false; });
      await r1.waitForFunction(() => !feat("guide"));
      assert.equal(await r1.locator('[data-act="speed"]').count(), 1);
      assert.equal(await r1.locator('[data-arm="cg"]').count(), 1);
      await r1.waitForFunction(() => { const r = App.state.robots.find((x) => x.id === "R1"); return r.phase === "atStop" && missionOf(r).kind === "guide"; }, null, { timeout: 60000 });
      await r1.locator('[data-act="confirm"]').click();
      await r1.waitForFunction(() => App.state.history.some((m) => m.kind === "guide" && m.robot === "R1" && m.status === "done"));
    }, (s) => {
      s.features.guide = true;
      s.robots[1] = { ...s.robots[1], driver: "valetudo", valetudo: { topic: "smoke/guide", points: { kitchen: { x: 2000, y: 1000 }, T05: { x: 3000, y: 1400 } } } };
    });
  } finally {
    await browser.close();
    if (fake) fake.kill();
  }
  assert.deepEqual(errors, []);
  console.log("FEATURE_POLICY_BROWSER_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
