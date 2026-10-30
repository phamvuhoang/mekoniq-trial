// Browser smoke against the isolated services described in docs/testing.md.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const screens = [
    "station.html?role=bep",
    "station.html?role=ql",
    "robot.html?id=R1",
    "table.html?id=T01",
    "setup.html",
    "setup.html?tab=robots",
    "setup.html?tab=roles",
    "setup.html?tab=backup",
    "setup.html?tab=system",
    "map.html",
  ];
  for (const [w, h] of [
    [1280, 800],
    [800, 1280],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const screen of screens) {
      await page.goto("http://127.0.0.1:1891/" + screen);
      await page.waitForTimeout(450);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        screen + " horizontal overflow",
      );
    }
    console.log("✓ Node-RED pages at " + w + "×" + h);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://127.0.0.1:1891/setup.html");
  await page.waitForFunction(() => typeof D !== "undefined" && D);
  // Intercept only this tab's outbound save; another tab's actual save wins.
  await page.evaluate(() => {
    D.name = "draft A";
    setDirty(true);
    window.originalSend = send;
    send = (o) => {
      if (o.type !== "siteSave") originalSend(o);
    };
  });
  await page.locator("#save").click();
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:1891/setup.html");
  await other.waitForFunction(() => typeof D !== "undefined" && D);
  await other.evaluate(() => {
    D.name = "saved B";
    setDirty(true);
  });
  await other.locator("#save").click();
  await page.waitForFunction(() => stale);
  assert.equal(await page.evaluate(() => D.name), "draft A");
  assert.equal(await page.evaluate(() => dirty), true);
  console.log("✓ competing save preserves browser draft and reports conflict");
  await page.evaluate(() => {
    send = originalSend;
    load();
    D.name = "own save";
    setDirty(true);
  });
  await page.locator("#save").click();
  await page.waitForFunction(() => !saving && !dirty);
  assert.equal(await page.evaluate(() => App.site.name), "own save");
  console.log("✓ own save acknowledgement");
  await page.evaluate(async () => {
    const assert = (v, m) => {
      if (!v) throw Error(m);
    };
    const r = D.robots[0];
    r.driver = "valetudo";
    r.valetudo = { topic: "test/A", points: {} };
    robotId = r.id;
    sel = "T01";
    const m = {
      size: { x: 1000, y: 1000 },
      pixelSize: 5,
      layers: [],
      t: 123,
      topic: "test/A",
      robot: r.id,
    };
    lastMap = m;
    mapT = m.t;
    vm.setMap(m);
    const originalFetch = fetch;
    let resolve;
    fetch = () => new Promise((r) => (resolve = r));
    const pending = pollMap();
    r.valetudo.topic = "test/B";
    drawMap();
    assert(!lastMap, "map not cleared after topic edit");
    resolve({ ok: true, json: async () => m });
    await pending;
    assert(!lastMap, "old response accepted");
    fetch = async () => ({ ok: true, json: async () => m });
    await pollMap();
    assert(!lastMap, "server cache from old topic accepted");
    setXY(321, 123);
    assert(!r.valetudo.points.T01, "teaching allowed without current map");
    fetch = async () => ({
      ok: true,
      json: async () => ({ ...m, topic: "test/B" }),
    });
    await pollMap();
    setXY(321, 123);
    assert(r.valetudo.points.T01.x === 321, "new map not teachable");
    fetch = originalFetch;
    load();
  });
  console.log("✓ map topic change, stale HTTP responses and teaching guard");
  for (const size of [[390, 844]]) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    for (const f of [
      "index.html",
      "serve.html",
      "demo.html",
      "contact.html",
      "demo/index.html",
    ]) {
      const r = await page.goto("http://127.0.0.1:1892/" + f);
      if (r.status() === 404) throw Error("Missing web page " + f);
      await page.waitForTimeout(300);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        f + " mobile overflow",
      );
    }
    console.log("✓ web mobile layout");
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("BROWSER_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
