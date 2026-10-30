// Unit tests for lib/site.js (site config validation): node scripts/test-site.js
const assert = require('assert');
const S = require('../data/lib/site');
const seed = require('../data/site.json');
const clone = o => JSON.parse(JSON.stringify(o));
const errs = (mut) => { const s = clone(seed); mut(s); return S.normalize(s, seed).errors; };
const has = (list, word) => assert.ok(list.some(e => e.includes(word)), `expected an error mentioning "${word}" in ${JSON.stringify(list)}`);

{
  // The seed is still pre-v2: normalize migrates it once, then a v2 site normalizes to itself.
  const r = S.normalize(clone(seed), seed);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.site, { ...seed, featurePolicyVersion: 2, serviceProfile: 'custom', customerCancel: 'direct', service: { requestStation: 'kitchen' },
    features: { guide: false, order: false, pay: false, callStaff: false, requestBill: false, busRobot: true }, payment: { ...seed.payment, verification: 'staff' } });
  assert.deepStrictEqual(S.normalize(clone(r.site), seed), r);
  console.log('✓ seed migrates to v2, v2 normalizes to itself');
}
{
  has(errs(s => { s.points['1abc'] = { name: 'x', kind: 'table' }; }), '1abc');
  has(errs(s => { s.points.T01 = { name: 'x', kind: 'sofa' }; }), 'sofa');
  has(errs(s => { s.points.dish2 = { name: 'x', kind: 'dish' }; }), 'dish');
  has(errs(s => { s.dishPoint = 'kitchen'; }), 'dishPoint');
  has(errs(s => { s.robots[0].dock = 'D9'; }), 'D9');
  has(errs(s => { s.robots[0].valetudo.acceptCm = 999; }), 'acceptCm');
  has(errs(s => { s.robots[0].valetudo.retryErr = '('; }), 'retryErr');
  console.log('✓ ids, kinds, dish, dock, knobs, regex');
}
{
  const s = clone(seed); s.robots[0].valetudo.arriveCm = '40';
  const r = S.normalize(s, seed);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.site.robots[0].valetudo.arriveCm, 40);
  console.log('✓ numeric strings coerced');
}
{
  has(errs(s => { s.timing.chargedBattery = 150; }), 'chargedBattery');   // a robot sent to charge would never come back
  has(errs(s => { s.timing.lowBattery = 85; }), 'Pin yếu');
  console.log('✓ battery thresholds');
}
{
  const s = clone(seed); s.points.T01 = { name: 'Bàn 01', kind: 'table' };
  s.robots[0].valetudo.points.T01 = { x: 12.7, y: 3 };
  assert.deepStrictEqual(S.normalize(s, seed).site.robots[0].valetudo.points.T01, { x: 13, y: 3 });
  s.robots[0].valetudo.points.T01 = { x: 12, y: -3 };
  has(S.normalize(s, seed).errors, 'T01');
  s.robots[0].valetudo.points.T01 = { x: 3000, y: 3 }; s.robots[0].valetudo.mapRef = { size: { x: 2500, y: 2000 } };
  has(S.normalize(s, seed).errors, 'T01');
  s.robots[0].valetudo.points.ZZ = { x: 1, y: 1 };   // point no longer exists -> dropped silently
  s.robots[0].valetudo.points.T01 = { x: 30, y: 3 };
  assert.strictEqual(S.normalize(s, seed).site.robots[0].valetudo.points.ZZ, undefined);
  console.log('✓ robot point coords');
}
{
  has(S.normalize('nope', seed).errors, 'không hợp lệ');
  has(S.normalize(null, seed).errors, 'không hợp lệ');
  const big = clone(seed); big.blob = 'x'.repeat(S.MAX_BYTES);
  has(S.normalize(big, seed).errors, 'quá lớn');
  const s = clone(seed); s.foo = 1;
  assert.strictEqual(S.normalize(s, seed).site.foo, 1);
  console.log('✓ size / type / unknown fields kept');
}
{
  const st = { missions: [{ status: 'active', robot: 'R1', stops: [{ p: 'T01', status: 'active' }, { p: 'T02', status: 'done' }] },
                          { status: 'queued', robot: null, stops: [{ p: 'T03', status: 'pending' }] }],
    robots: { R1: { mission: 1 }, R2: { mission: null } },
    orders: [{ table: 'T04', status: 'new' }, { table: 'T05', status: 'closed' }, { table: 'T06', status: 'paid-claimed' }],
    bills: [{ table: 'T07', status: 'claimed' }, { table: 'T08', status: 'closed' }, { table: 'T09', status: 'void' }] };
  const u = S.inUse(seed, st);
  assert.deepStrictEqual([...u.points].sort(), ['T01', 'T03', 'T04', 'T06', 'T07']);
  assert.deepStrictEqual([...u.robots], ['R1']);
  console.log('✓ inUse');
}
{
  assert.deepStrictEqual(S.nextTable({ points: { T01: {}, T03: {} } }), { id: 'T02', name: 'Bàn 02' });
  assert.deepStrictEqual(S.nextTable(seed), { id: 'T01', name: 'Bàn 01' });
  assert.strictEqual(S.KNOBS.acceptCm[0], 80);
  assert.strictEqual(S.RETRY_ERR, 'unreach|target|navigat|path');
  console.log('✓ nextTable / KNOBS');
}
{
  // review fix 5: a site.json from the previous version (site.valetudo.points) migrates into the first Valetudo robot
  const old = clone(seed); old.points.T01 = { name: 'Bàn 01', kind: 'table' };
  old.robots[0].valetudo = { topic: 'valetudo/Old', arriveCm: 40 };
  old.valetudo = { points: { kitchen: { x: 2351, y: 2544 }, T01: { x: 1890, y: 1420 }, ZZ: { x: 1, y: 1 } } };
  const r = S.normalize(old, seed);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.site.robots[0].valetudo.points, { kitchen: { x: 2351, y: 2544 }, T01: { x: 1890, y: 1420 } });
  assert.strictEqual(r.site.valetudo, undefined);
  console.log('✓ migrates old site.valetudo.points');
}
{
  const s = clone(seed); delete s.features; s.featurePolicyVersion = 2;
  assert.deepStrictEqual(S.normalize(s, seed).site.features, { callStaff: false, requestBill: false, guide: false, order: false, pay: false, busRobot: false });
  s.features = { order: 'yes' };
  has(S.normalize(s, seed).errors, 'order');
  console.log('✓ v2 features default to off, non-booleans rejected');
}
{
  const s = clone(seed); delete s.notes;
  assert.deepStrictEqual(S.normalize(s, seed).site.notes, ['Không hành', 'Ít cay', 'Món nóng', 'Thêm chén']);
  s.notes = ['  Ít đá ', '', 'x'.repeat(30), 42, 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const n = S.normalize(s, seed).site.notes;
  assert.deepStrictEqual(n, ['Ít đá', 'x'.repeat(24), '42', 'a', 'b', 'c', 'd', 'e']);
  s.notes = ['', '  '];
  assert.deepStrictEqual(S.normalize(s, seed).site.notes, [], 'all empty -> no chips, on purpose');
  s.notes = 'Ít cay';
  has(S.normalize(s, seed).errors, 'Ghi chú');
  console.log('✓ quick notes trimmed, capped, defaulted only when missing');
}
{
  const s = clone(seed); s.points.door = { name: 'Cửa đón khách', kind: 'entrance' };
  assert.deepStrictEqual(S.normalize(s, seed).errors, []);
  console.log('✓ entrance points accepted');
}
{
  const s = clone(seed); delete s.menu;
  assert.deepStrictEqual(S.normalize(s, seed).site.menu, { cats: [], items: [] });
  s.points.bar = { name: 'Quầy', kind: 'station' };
  s.menu = { cats: [{ id: 'mon', vi: 'Món', en: 'Mains' }, { id: 'nuoc', vi: 'Nước', en: 'Drinks', station: 'bar' }],
    items: [{ id: 'pho', cat: 'mon', vi: 'Phở', en: 'Pho', price: '65000' }, { id: 'tra', cat: 'nuoc', vi: 'Trà', price: 5000 }] };
  const r = S.normalize(s, seed);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.site.menu.cats[0].station, 'kitchen');
  assert.strictEqual(r.site.menu.items[0].price, 65000);
  assert.strictEqual(r.site.menu.items[1].en, 'Trà');
  has(errs(x => { x.menu = { cats: [{ id: 'a', vi: 'A' }], items: [{ id: 'p', cat: 'zz', vi: 'P', price: 1 }] }; }), 'zz');
  has(errs(x => { x.menu = { cats: [{ id: 'a', vi: 'A' }], items: [{ id: 'p', cat: 'a', vi: 'P', price: -1 }] }; }), 'price');
  has(errs(x => { x.menu = { cats: [{ id: 'a', vi: 'A' }], items: [{ id: 'p', cat: 'a', vi: 'P', price: 1.5 }] }; }), 'price');
  has(errs(x => { x.menu = { cats: [{ id: 'a', vi: 'A' }], items: [{ id: 'p', cat: 'a', vi: 'P', price: 1 }, { id: 'p', cat: 'a', vi: 'Q', price: 1 }] }; }), 'trùng');
  has(errs(x => { x.menu = { cats: [{ id: 'a', vi: 'A', station: 'D1' }], items: [] }; }), 'D1');
  console.log('✓ menu validated');
}
{
  // Review: a site whose stations are not called "kitchen" must not silently route orders to a missing point.
  const s = clone(seed); const { kitchen, ...rest } = s.points; s.points = { bep: kitchen, ...rest };
  s.menu = { cats: [{ id: 'mon', vi: 'Món' }], items: [] };
  assert.strictEqual(S.firstStation(s), 'bep');
  assert.strictEqual(S.normalize(s, seed).site.menu.cats[0].station, 'bep');
  has(errs(x => { x.points.bep = x.points.kitchen; delete x.points.kitchen; x.menu = { cats: [{ id: 'a', vi: 'A', station: 'kitchen' }], items: [] }; }), 'kitchen');
  console.log('✓ category station defaults to the first station point');
}
{
  const s = clone(seed); delete s.payment;
  assert.deepStrictEqual(S.normalize(s, seed).site.payment, { bank: '', account: '', name: '', verification: 'staff' });
  s.payment = { bank: ' VCB ', account: '0123 456 789', name: 'Nha hang A', qr: 'data:image/png;base64,AAAA' };
  assert.deepStrictEqual(S.normalize(s, seed).site.payment, { bank: 'VCB', account: '0123456789', name: 'Nha hang A', qr: 'data:image/png;base64,AAAA', verification: 'staff' });
  has(errs(x => { x.payment = { account: '12ab' }; }), 'account');
  has(errs(x => { x.payment = { qr: 'http://evil/x.png' }; }), 'qr');
  has(errs(x => { x.payment = { qr: 'data:image/png;base64,' + 'A'.repeat(210 * 1024) }; }), 'qr');
  console.log('✓ payment validated');
}
