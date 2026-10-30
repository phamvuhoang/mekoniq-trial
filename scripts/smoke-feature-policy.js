// Browser smoke for the setup "Tính năng" tab (spec §8) against the held temp services (docs/testing.md):
// SMOKE_HOLD=1 node scripts/smoke-review.js, wait for "HOLD for browser tests", then run this. Saves change only that temp site.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const base = "http://127.0.0.1:1891";
const errors = [];
let browser, fixture;

const expectText = async (page, selector, text) =>
  assert.match(await page.locator(selector).innerText(), new RegExp(text));
async function open(context, path) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(path + ": " + e.message));
  await page.goto(base + "/" + path);
  await page.waitForFunction(() => typeof D !== "undefined" && D);
  return page;
}
async function save(page) {
  await page.locator("#save").click();
  await page.waitForFunction(() => !saving && !dirty);
}
// One fresh context per scenario, each starting from the same saved site: every feature off, no request station.
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await open(context, "setup.html");
    await page.evaluate((f) => { D = structuredClone(f); D.rev = App.site.rev; setDirty(true); }, fixture);
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
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, `${t} overflows at ${width}×${height}`);
          if (t === "features" && height > width)   // stacked cards must not overlap
            assert(await page.evaluate(() => $("policy").closest(".card").getBoundingClientRect().bottom <= $("menuCard").getBoundingClientRect().top), "cards overlap in portrait");
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
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, []);
  console.log("FEATURE_POLICY_BROWSER_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
