// Regression cases from the final restaurant-policy review. Uses the real core and UI handlers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('./helpers/orchestrator-harness');
const order = { type: 'order', table: 'T01', items: [{ id: 'pho', qty: 1 }], requestId: 'first' };

test('a burst of other requests cannot turn an order retry into a second order', () => {
  const h = H(); h.send(order);
  for (let i = 0; i < 1000; i++) h.send({ type: 'call', point: 'T02', what: 'staff', requestId: 'call-' + i });
  h.send(order);
  assert.equal(h.st.orders.length, 1);
  assert.equal(h.replies()[0].duplicate, true);
});
test('reset preserves order receipts alongside closed financial records', () => {
  const h = H(); h.send(order);
  h.send({ type: 'billPrepare', table: 'T01', orderIds: [1], total: 65000, requestId: 'p' });
  h.send({ type: 'billSettle', bill: 1, rev: 1, method: 'cash', requestId: 's' });
  h.send({ type: 'billClose', bill: 1, rev: 2, requestId: 'x' });
  h.send({ type: 'reset' }); h.send(order);
  assert.deepEqual(h.st.orders.map(o => [o.id, o.status]), [[1, 'closed']]);
  assert.equal(h.replies()[0].duplicate, true);
});
test('guide rejects closed runtime lanes without ending standby; reopening permits it', () => {
  const h = H(); h.send({ type: 'create', kind: 'summon', robot: 'R1', to: 'kitchen' }); h.arrive('R1');
  const standby = h.st.robots.R1.mission;
  const map = structuredClone(h.st.map); map.edges.forEach(e => e.closed = true);
  h.send({ type: 'map', map });
  const r = h.send({ type: 'create', kind: 'guide', robot: 'R1', to: 'T01', requestId: 'g' });
  assert.equal(h.replies()[0]?.ok, false);
  assert.equal(h.st.robots.R1.mission, standby);
  assert(!r.cmds.some(c => c.cmd === 'goto'));
  map.edges.forEach(e => e.closed = false); h.send({ type: 'map', map });
  h.send({ type: 'create', kind: 'guide', robot: 'R1', to: 'T01' });
  assert(h.st.missions.some(m => m.kind === 'guide' && m.status === 'active'));
});

const common = fs.readFileSync(__dirname + '/../data/public/common.js', 'utf8');
const robot = fs.readFileSync(__dirname + '/../data/public/robot.html', 'utf8');
function cartUI() {
  const h = H(), waiting = [], timers = new Map(); let nextTimer = 0;
  const c = vm.createContext({ console, ordering: false, cart: {}, otable: null, osent: {}, r: {}, ID: 'R1',
    render() {}, toast() {}, say: x => x, refusal: x => x.code, pname: x => x, hereTable: () => 'T01',
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    send(msg) { h.send(msg); if (c.lost) waiting.push(h.replies()[0]); else vm.runInContext(`settle(${JSON.stringify(h.replies()[0])})`, c); }
  });
  vm.runInContext(common.slice(common.indexOf('const REPLY_MS'), common.indexOf('const say =')), c);
  const actions = robot.slice(robot.indexOf("  if (a === 'order')"), robot.indexOf("  if (a === 'guide')"));
  return { h, c, click(a) { c.a = a; vm.runInContext(actions, c); },
    expire() { for (const fn of [...timers.values()]) fn(); },
    reply() { for (const rep of waiting.splice(0)) vm.runInContext(`settle(${JSON.stringify(rep)})`, c); } };
}
for (const lost of [false, true]) test(`fresh identical cart is a new order after ${lost ? 'lost' : 'synchronous'} reply`, () => {
  const u = cartUI(); u.c.lost = lost;
  u.click('order'); u.c.cart = { pho: 1 }; u.click('orderSend');
  if (lost) { u.expire(); u.click('orderBack'); }
  u.c.lost = false; u.click('order'); u.c.cart = { pho: 1 }; u.click('orderSend');
  assert.equal(u.h.st.orders.length, 2);
});
test('retrying the same timed-out cart keeps its ID and late reply does not clear a new cart', () => {
  const u = cartUI(); u.c.lost = true; u.click('order'); u.c.cart = { pho: 1 }; u.click('orderSend');
  u.expire(); u.c.lost = false; u.click('orderSend');
  assert.equal(u.h.st.orders.length, 1);
  u.c.lost = true; u.click('order'); u.c.cart = { pho: 2 }; u.click('orderSend');
  u.click('orderBack'); u.click('order'); u.c.cart = { pho: 3 }; u.reply();
  assert.equal(u.c.cart.pho, 3);
  assert.equal(u.c.ordering, true);
});

test('guide readiness respects closed and one-way lanes in the supplied map', () => {
  const P = require('../data/lib/feature-policy');
  const site = { featurePolicyVersion: 2, features: { guide: true }, points: { S: { kind: 'station' }, T: { kind: 'table' } }, robots: [{ id: 'R1' }],
    map: { nodes: { S: { x: 0, y: 0 }, T: { x: 1, y: 0 } }, edges: [{ a: 'S', b: 'T', closed: true }] } };
  assert.equal(P.readiness(site, 'guide').ready, false);
  site.map.edges = [{ a: 'T', b: 'S', oneway: true }];
  assert.equal(P.readiness(site, 'guide').ready, false);
  const live = { ...site.map, edges: [{ a: 'S', b: 'T', oneway: true }] };
  assert.equal(P.readiness(site, 'guide', live).ready, true);
});

const os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const installer = fs.readFileSync(__dirname + '/../termux/install.sh', 'utf8');
const copyStep = installer.slice(installer.indexOf('node "$HERE/scripts/preserve-site.js"'), installer.indexOf('# MQTT: the robot connects'));
for (const scenario of ['unsaved', 'saved', 'fresh', 'corrupt']) test(`installer preserves effective site: ${scenario}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-upgrade-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app'), bundle = path.join(dir, 'bundle');
  fs.mkdirSync(app); fs.mkdirSync(path.join(bundle, 'data'), { recursive: true });
  fs.symlinkSync(__dirname, path.join(bundle, 'scripts'));
  const fresh = require('../data/site.json'), old = require('./helpers/legacy-site')(require('../data/site.demo.json'));
  fs.writeFileSync(path.join(bundle, 'data/site.json'), JSON.stringify(fresh));
  const context = path.join(app, 'context/global/global.json');
  if (scenario !== 'fresh') fs.writeFileSync(path.join(app, 'site.json'), JSON.stringify(old));
  if (scenario === 'saved' || scenario === 'corrupt' || scenario === 'unsaved') {
    fs.mkdirSync(path.dirname(context), { recursive: true });
    fs.writeFileSync(context, scenario === 'corrupt' ? '{broken' : JSON.stringify(scenario === 'saved' ? { site: { ...old, name: 'Saved config' }, another: 123 } : { another: 123 }));
  }
  const r = spawnSync('sh', ['-ec', copyStep], { env: { ...process.env, APP: app, HERE: bundle }, encoding: 'utf8' });
  if (scenario === 'corrupt') {
    assert.notEqual(r.status, 0, 'abort rather than overwrite a site when context cannot be read');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'site.json'))), old);
  } else {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'site.json'))), fresh);
    if (scenario === 'fresh') assert(!fs.existsSync(context));
    else {
      const saved = JSON.parse(fs.readFileSync(context));
      assert.deepEqual(saved.site, scenario === 'saved' ? { ...old, name: 'Saved config' } : old);
      assert.equal(saved.another, 123);
      const h = H(saved.site); h.send({ type: 'hello' });
      const live = h.site; // retained raw config is migrated by the actual hello path
      const hello = h.send({ type: 'hello' }).ui.map(x => JSON.parse(x.payload)).find(x => x.type === 'site');
      assert.equal(hello.site.features.busRobot, true);
      assert.equal(live.featurePolicyVersion, undefined);
    }
  }
});

test('guide checks the selected robot route even when another pickup point is ready', () => {
  const h = H(); h.send({ type: 'create', kind: 'summon', robot: 'R1', to: 'kitchen' }); h.arrive('R1');
  const map = structuredClone(h.st.map); map.edges.filter(e => e.a === 'kitchen' || e.b === 'kitchen').forEach(e => e.closed = true);
  h.send({ type: 'map', map });
  assert.equal(require('../data/lib/feature-policy').readiness(h.site, 'guide', h.st.map).effective, true);
  const before = h.st.robots.R1.mission;
  h.send({ type: 'create', kind: 'guide', robot: 'R1', to: 'T01', requestId: 'g' });
  assert.equal(h.replies()[0]?.code, 'unreachable');
  assert.equal(h.st.robots.R1.mission, before);
});

test('explicit sim driver supports guides and speed just like an implicit simulator', () => {
  const Policy = require('../data/lib/feature-policy'), h = H();
  h.site.robots.forEach(r => r.driver = 'sim');
  assert.equal(Policy.readiness(h.site, 'guide').effective, true);
  assert.equal(Policy.capabilities(h.site.robots[0]).speedControl, true);
});
