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
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
