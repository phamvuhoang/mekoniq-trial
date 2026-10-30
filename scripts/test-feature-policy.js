// Unit tests for lib/feature-policy.js (v2 feature policy): node scripts/test-feature-policy.js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../data/lib/feature-policy');
const Site = require('../data/lib/site');
const O = require('../data/lib/orchestrator');
const seed = require('../data/site.demo.json');
const legacy = () => require('./helpers/legacy-site')(seed);   // the demo as the previous version saved it
test('both seeds are explicit v2 and normalize to themselves', () => {
  const prod = require('../data/site.json');
  for (const s of [prod, seed]) {
    assert.equal(s.featurePolicyVersion, 2);
    assert.deepEqual(Site.normalize(structuredClone(s), s), {site: s, errors: []});
  }
  assert.deepEqual([prod.serviceProfile, prod.features, prod.customerCancel, prod.service, prod.payment.verification],
    ['custom', Policy.preset('custom').features, 'request', {requestStation: null}, 'staff']);
  assert.deepEqual([seed.serviceProfile, seed.customerCancel, seed.service, seed.payment.verification], ['custom', 'request', {requestStation: 'kitchen'}, 'staff']);
  for (const k of Object.keys(seed.features)) assert.equal(Policy.readiness(seed, k).effective, true, `demo ${k} on and ready`);
});
test('legacy call splits without losing other flags', () => {
  const old = legacy();
  old.features = {call:true, guide:false, order:true, pay:false};
  const next = Policy.migrate(old);
  assert.equal(next.featurePolicyVersion, 2);
  assert.equal(next.features.callStaff, true);
  assert.equal(next.features.requestBill, true);
  assert.equal(next.features.busRobot, true);
  assert.equal(next.customerCancel, 'direct');
  assert.equal(next.rev, old.rev);
  assert.equal('call' in next.features, false);
  assert.equal('call' in old.features, true);
});
test('explicit empty notes stay empty', () => {
  const input = {...structuredClone(seed), notes:[]};
  assert.deepEqual(Site.normalize(input, seed).site.notes, []);
});
test('preset does not enable ordering or payment', () => {
  const p = Policy.preset('table-service');
  assert.equal(p.features.callStaff, true);
  assert.equal(p.features.requestBill, true);
  assert.equal(p.features.order, false);
  assert.equal(p.features.pay, false);
});

const v2 = () => Site.normalize(structuredClone(seed), seed).site;
const errs = site => Site.normalize(site, seed).errors;

test('legacy migration keeps the other flags, metadata and new fields that are already valid', () => {
  const old = {...legacy(), rev: 7, by: 'Quản lý', savedAt: 5, saveRequestId: 'r1',
    features: {call: false, guide: true, order: 'yes', pay: true, busRobot: false}, customerCancel: 'request', serviceProfile: 'buffet'};
  const next = Policy.migrate(old);
  assert.deepEqual(next.features, {guide: true, order: false, pay: true, busRobot: false, callStaff: false, requestBill: false});
  assert.equal(next.customerCancel, 'request');
  assert.equal(next.serviceProfile, 'buffet');
  assert.deepEqual([next.rev, next.by, next.savedAt, next.saveRequestId], [7, 'Quản lý', 5, 'r1']);
  assert.equal(next.payment.verification, 'staff');
  assert.equal(Policy.migrate({...old, customerCancel: 'maybe', serviceProfile: 'x'}).customerCancel, 'direct');
});
test('legacy requestStation: valid kept, else first station by key order, else null', () => {
  assert.equal(Policy.migrate(legacy()).service.requestStation, 'bar');
  assert.equal(Policy.migrate({...legacy(), service: {requestStation: 'kitchen'}}).service.requestStation, 'kitchen');
  assert.equal(Policy.migrate({...legacy(), service: {requestStation: 'T01'}}).service.requestStation, 'bar');
  assert.equal(Policy.migrate({points: {T01: {kind: 'table'}}}).service.requestStation, null);
});
test('v2 normalize is idempotent and never re-injects legacy defaults', () => {
  const once = v2();
  assert.deepEqual(Site.normalize(structuredClone(once), seed), {site: once, errors: []});
  const m = Policy.migrate(once);
  assert.deepEqual(m, once);
  assert.notEqual(m, once);
  const bare = {...structuredClone(once), features: {}};
  delete bare.customerCancel; delete bare.serviceProfile; delete bare.service;
  const r = Site.normalize(bare, seed);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.site.features, Policy.preset('custom').features);
  assert.equal(r.site.customerCancel, 'request');
  assert.equal(r.site.serviceProfile, 'custom');
  assert.equal(r.site.service.requestStation, null);
});
test('each preset', () => {
  const on = name => Object.entries(Policy.preset(name).features).filter(([, v]) => v).map(([k]) => k);
  assert.deepEqual(on('table-service'), ['callStaff', 'requestBill']);
  assert.deepEqual(on('counter-prepaid'), []);
  assert.deepEqual(on('buffet'), ['callStaff']);
  assert.deepEqual(on('custom'), []);
  for (const name of ['table-service', 'counter-prepaid', 'buffet', 'custom']) {
    const p = Policy.preset(name);
    assert.deepEqual(Object.keys(p).sort(), ['customerCancel', 'features', 'serviceProfile']);
    assert.equal(p.serviceProfile, name);
    assert.equal(p.customerCancel, 'request');
    assert.equal(Object.keys(p.features).length, 6);
  }
  Policy.preset('custom').features.pay = true;
  assert.equal(Policy.preset('custom').features.pay, false, 'fresh object each call');
  assert.equal(Policy.preset('nope'), null);
  assert.equal(Policy.preset('__proto__'), null);
});
test('missing notes get the defaults, non-list is rejected', () => {
  const s = v2(); delete s.notes;
  assert.deepEqual(Site.normalize(s, seed).site.notes, ['Không hành', 'Ít cay', 'Món nóng', 'Thêm chén']);
  assert.equal(errs({...v2(), notes: 'Ít cay'}).length, 1);
});
test('"false" and other non-booleans are rejected, enums validated', () => {
  assert.equal(errs({...v2(), features: {...v2().features, guide: 'false'}}).length, 1);
  assert.equal(errs({...v2(), features: {...v2().features, pay: 1}}).length, 1);
  assert.equal(errs({...v2(), customerCancel: 'maybe'}).length, 1);
  assert.equal(errs({...v2(), serviceProfile: 'cafe'}).length, 1);
  assert.equal(errs({...v2(), payment: {...v2().payment, verification: 'auto'}}).length, 1);
});
test('v2 requestStation must be null or an existing station', () => {
  assert.deepEqual(errs({...v2(), service: {requestStation: 'kitchen'}}), []);
  assert.equal(Site.normalize({...v2(), service: {requestStation: ''}}, seed).site.service.requestStation, null);
  assert.equal(errs({...v2(), service: {requestStation: 'T01'}}).length, 1);
  assert.equal(errs({...v2(), service: {requestStation: 'gone'}}).length, 1);
});
test('alias call is dropped from v2 input without enabling callStaff', () => {
  const s = Site.normalize({...v2(), features: {...v2().features, callStaff: false, call: true}}, seed).site;
  assert.equal('call' in s.features, false);
  assert.equal(s.features.callStaff, false);
});
test('custom unknown fields are kept through migrate and normalize', () => {
  const old = {...legacy(), custom: {a: [1]}, features: {...legacy().features, beta: true}};
  const s = Site.normalize(old, seed).site;
  assert.deepEqual(s.custom, {a: [1]});
  assert.equal(s.features.beta, true);
});
test('capabilities: only simulator robots control speed', () => {
  assert.deepEqual(Policy.capabilities({id: 'R1'}), {speedControl: true});
  assert.equal(Policy.capabilities({driver: 'sim'}).speedControl, true);
  assert.equal(Policy.capabilities({driver: 'valetudo'}).speedControl, false);
  assert.equal(Policy.capabilities({driver: 'newbot'}).speedControl, false);
  for (const r of [null, undefined, 'R1', 1]) assert.equal(Policy.capabilities(r).speedControl, false);
});

// Ready demo-shaped v2 site: every feature on and every condition met.
const ready = () => {
  const s = v2();
  for (const k of Object.keys(s.features)) s.features[k] = true;
  s.service.requestStation = 'kitchen';
  return s;
};
const codes = (s, key) => Policy.readiness(s, key).reasons.map(r => r.code);
test('readiness: a fully configured site is ready for every feature', () => {
  for (const key of ['callStaff', 'requestBill', 'guide', 'order', 'pay', 'busRobot'])
    assert.deepEqual(Policy.readiness(ready(), key), {enabled: true, ready: true, effective: true, reasons: []}, key);
  const off = ready(); off.features.guide = false;
  assert.deepEqual(Policy.readiness(off, 'guide'), {enabled: false, ready: true, effective: false, reasons: []});
});
test('readiness: callStaff/requestBill need a table and a request station', () => {
  const s = ready(); s.service.requestStation = null;
  assert.deepEqual(codes(s, 'callStaff'), ['no-request-station']);
  for (const id of Object.keys(s.points)) if (s.points[id].kind === 'table') delete s.points[id];
  assert.deepEqual(codes(s, 'requestBill'), ['no-table', 'no-request-station']);
  const r = Policy.readiness(s, 'requestBill');
  assert.equal(r.effective, false);
  for (const {text} of r.reasons) assert.ok(typeof text === 'string' && text && !/[a-z][A-Z]|[a-z]\.[a-z]/.test(text), text);   // no key names
});
test('readiness: guide needs a start point and a robot that reaches a table', () => {
  const s = ready(); delete s.map;
  assert.deepEqual(codes(s, 'guide'), ['no-robot-route']);
  s.robots[0].driver = 'valetudo'; s.robots[0].valetudo = {points: {T03: {x: 1, y: 1}}};
  assert.deepEqual(codes(s, 'guide'), []);
  for (const id of ['bar', 'kitchen']) s.points[id].kind = 'dish';
  assert.deepEqual(codes(s, 'guide'), ['no-start']);
});
test('readiness: order needs items, valid prices, categories and stations', () => {
  const s = ready();
  s.menu.items[0].price = -1; s.menu.items[1].cat = 'zz'; s.menu.cats[0].station = 'T01';
  assert.deepEqual(codes(s, 'order'), ['bad-price', 'bad-category', 'bad-station']);
  s.menu.items = [];
  assert.equal(codes(s, 'order')[0], 'no-item');
});
test('readiness: pay needs request station, bank details and staff verification', () => {
  const s = ready(); s.payment.account = ' '; s.payment.verification = 'auto'; s.service.requestStation = 'gone';
  assert.deepEqual(codes(s, 'pay'), ['no-request-station', 'no-bank', 'no-staff-verification']);
});
test('readiness: busRobot needs a table and the dish point', () => {
  const s = ready(); s.dishPoint = 'kitchen';
  assert.deepEqual(codes(s, 'busRobot'), ['no-dish']);
});
test('readiness accepts legacy sites', () => {
  const r = Policy.readiness(legacy(), 'callStaff');
  assert.deepEqual(r, {enabled: true, ready: true, effective: true, reasons: []});
  assert.equal(Policy.readiness({}, 'busRobot').enabled, true);
  assert.equal(Policy.readiness(null, 'pay').ready, false);
  assert.equal(Policy.readiness(ready(), 'nope').effective, false);
});
test('orchestrator gate reads the v2 flags (legacy "call" = callStaff)', () => {
  const alerts = site => {
    const st = O.init(site, 1e12);
    O.handle(st, site, {source: 'ui', data: {type: 'call', point: 'T01', what: 'staff', by: 'test'}}, 1e12);
    return st.alerts.length;
  };
  const s = ready();
  assert.equal(alerts(s), 1);
  s.features.callStaff = false;
  assert.equal(alerts(s), 0);
  assert.equal(alerts(legacy()), 1);
});
