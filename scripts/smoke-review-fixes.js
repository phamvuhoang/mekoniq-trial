// Regression smoke on static demo (serve ../web at 127.0.0.1:1892).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  try {
    const context = await browser.newContext(), p = await context.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:1892/demo/robot.html?id=R1');
    await p.waitForFunction(() => App.state && App.site);
    await p.locator('#start').click();
    await p.evaluate(() => send({ type: 'create', kind: 'summon', robot: 'R1', to: 'T01', by: 'Smoke' }));
    await p.waitForFunction(() => App.state.robots.find(r => r.id === 'R1').at === 'T01', null, { timeout: 45000 });
    for (let i = 1; i <= 2; i++) {
      await p.locator('[data-act="order"]').click();
      await p.locator('[data-qty="pho"][data-d="1"]').click();
      await p.locator('[data-act="orderSend"]').click();
      await p.waitForFunction(n => App.state.orders.length === n, i);
    }
    assert.equal(await p.evaluate(() => App.state.orders.reduce((s, o) => s + o.total, 0)), 130000);
    console.log('✓ two identical fresh carts on the demo leader create two orders');
    const hub = await context.newPage(); hub.on('pageerror', e => errors.push(e.message));
    await hub.goto('http://127.0.0.1:1892/demo/');
    await hub.waitForFunction(() => App.state && App.site);
    await hub.evaluate(() => send({ type: 'billPrepare', table: 'T01', orderIds: [1, 2], total: 130000, requestId: 'smoke-prep', by: 'Smoke' }));
    await hub.waitForFunction(() => App.state.bills.length === 1);
    await hub.locator('#reset').click(); await hub.locator('#reset').click();
    await hub.waitForFunction(() => [...document.querySelectorAll('.toast')].some(x => /chưa đóng/.test(x.textContent)), null, { timeout: 5000 });
    assert.equal(await hub.evaluate(() => App.state.bills.length), 1);
    assert.equal(await hub.evaluate(() => App.state.orders.length), 2);
    console.log('✓ demo home visibly explains refused reset and preserves the open bill/orders');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
