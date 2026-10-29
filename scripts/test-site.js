// Unit tests for lib/site.js (site config validation): node scripts/test-site.js
const assert = require('assert');
const S = require('../data/lib/site');
const seed = require('../data/site.json');
const clone = o => JSON.parse(JSON.stringify(o));
const errs = (mut) => { const s = clone(seed); mut(s); return S.normalize(s, seed).errors; };
const has = (list, word) => assert.ok(list.some(e => e.includes(word)), `expected an error mentioning "${word}" in ${JSON.stringify(list)}`);

{
  const r = S.normalize(clone(seed), seed);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.site, seed);
  console.log('✓ seed normalizes to itself');
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
    robots: { R1: { mission: 1 }, R2: { mission: null } } };
  const u = S.inUse(seed, st);
  assert.deepStrictEqual([...u.points].sort(), ['T01', 'T03']);
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
  const s = clone(seed); delete s.features;
  assert.deepStrictEqual(S.normalize(s, seed).site.features, { call: false, guide: false, order: false, pay: false });
  s.features = { call: 1, order: 'yes', bogus: true };
  assert.deepStrictEqual(S.normalize(s, seed).site.features, { call: true, guide: false, order: true, pay: false });
  console.log('✓ features default to off, coerced to booleans');
}
