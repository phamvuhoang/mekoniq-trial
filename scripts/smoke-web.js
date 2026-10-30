// Browser smoke against the isolated services described in docs/testing.md.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const station = await ctx.newPage(),
    robot = await ctx.newPage();
  const errors = [];
  for (const p of [station, robot])
    p.on("pageerror", (e) => errors.push(e.message));
  await station.goto("http://127.0.0.1:1892/demo/station.html?role=bep");
  await station.waitForFunction(() => App.state);
  await station.locator('[data-f="robot:R1"]').click();
  await station.locator('[data-f="t:T01"]').click();
  await station.locator('[data-act="create"]').click();
  await robot.goto("http://127.0.0.1:1892/demo/robot.html?id=R1");
  await robot.waitForFunction(
    () => App.state?.robots.find((r) => r.id === "R1")?.phase === "atStop",
    null,
    { timeout: 45000 },
  );
  await robot.locator("#start").click();
  console.log(
    "Buttons at kitchen:",
    await robot.locator("#acts button").allTextContents(),
  );
  await robot.locator('[data-act="confirm"]').click();
  await robot.waitForFunction(
    () =>
      App.state?.robots.find((r) => r.id === "R1")?.phase === "atStop" &&
      App.state.missions[0]?.cur === 1,
    null,
    { timeout: 45000 },
  );
  await robot.locator('[data-act="confirm"]').click();
  await station.waitForFunction(() => App.state.kpi.delivered === 1);
  assert.deepEqual(errors, []);
  console.log(
    "✓ static demo actual station/robot buttons deliver kitchen → T01",
  );

  // Each browser runs its own demo restaurant: a feature set saved in one never reaches another.
  const seed = await (await fetch("http://127.0.0.1:1892/demo/site.json")).json();
  const a = await browser.newContext(), b = await browser.newContext();
  const setup = async (ctx) => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://127.0.0.1:1892/demo/setup.html?tab=features");
    await p.waitForFunction(() => typeof D !== "undefined" && D && App.site);
    return p;
  };
  const pa = await setup(a);
  await pa.locator('[data-feat="callStaff"]').uncheck();
  await pa.locator('[data-feat="pay"]').uncheck();
  await pa.locator("#save").click();
  await pa.waitForFunction(() => !saving && !dirty && App.site.features.callStaff === false);
  assert.deepEqual(await pa.evaluate(() => App.site.features), { ...seed.features, callStaff: false, pay: false });
  const pb = await setup(b);
  assert.deepEqual(await pb.evaluate(() => [App.site.features, App.site.customerCancel, App.site.service]),
    [seed.features, "request", { requestStation: "kitchen" }]);
  const qr = async (ctx) => {
    const p = await ctx.newPage();
    await p.goto("http://127.0.0.1:1892/demo/table.html?t=T05");
    await p.waitForFunction(() => App.site && App.state);
    return p.locator("button").allTextContents();
  };
  const [qa, qb] = [await qr(a), await qr(b)];
  assert(!qa.some((t) => t.includes("Gọi nhân viên")) && qa.some((t) => t.includes("Yêu cầu tính tiền")), qa.join("|"));
  assert(qb.some((t) => t.includes("Gọi nhân viên")) && qb.some((t) => t.includes("Yêu cầu tính tiền")), qb.join("|"));
  assert.deepEqual(errors, []);
  console.log("✓ demo feature settings saved in one browser context leave another on the seed defaults");

  // "Xoá dữ liệu demo" with a bill open is refused and keeps the saved settings; once the bill is voided it goes back to
  // site.json, and the next bill gets a new number.
  const prep = (requestId) => pa.evaluate((requestId) => send({ type: "billPrepare", table: "T05", orderIds: [], total: 1000, note: "Smoke", requestId, by: "Smoke" }), requestId);
  await prep("web-p1");
  await pa.waitForFunction(() => App.state.bills.length === 1);
  await pa.evaluate(() => { window.replies = []; const s = settle; settle = (m) => { replies.push(m); return s(m); }; send({ type: "reset", by: "Smoke" }); });
  await pa.waitForFunction(() => replies.length);
  assert.deepEqual(await pa.evaluate(() => [replies[0].ok, replies[0].code, App.site.features.callStaff, App.state.bills.length]), [false, "billing", false, 1]);
  const bill = await pa.evaluate(() => App.state.bills[0]);
  await pa.evaluate((b) => { send({ type: "billVoid", bill: b.id, rev: b.rev, reason: "Smoke", requestId: "web-v1", by: "Smoke" }); send({ type: "reset", by: "Smoke" }); }, bill);
  await pa.waitForFunction(() => App.site.features.callStaff === true && !App.state.bills.length);
  assert.deepEqual(await pa.evaluate(() => App.site.features), seed.features);
  await prep("web-p2");
  await pa.waitForFunction(() => App.state.bills.length === 1);
  assert.equal(await pa.evaluate(() => App.state.bills[0].id), bill.id + 1);
  assert.deepEqual(errors, []);
  console.log("✓ demo reset refused while a bill is open keeps the saved settings; afterwards back to site.json, bill numbers go on");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
