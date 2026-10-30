// Orchestrator wiring of feature policy v2 + staff-verified bills (spec §4.1, §6, §7): node scripts/test-guest-policy.js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/orchestrator-harness');
const Site = require('../data/lib/site');
const seed = require('../data/site.demo.json');

const DAY = 24 * 3600 * 1000;
const v2 = () => harness(Site.normalize(seed, seed).site);   // live site already saved as v2
const msgs = r => r.ui.map(u => JSON.parse(u.payload));
const state = r => msgs(r).find(p => p.type === 'state');
const order1 = h => { h.st.orders = [{id: 1, table: 'T01', status: 'new', items: [], total: 1000, t: 1e12}]; h.st.orderSeq = 1; };
const prepare = (h, extra) => h.send({type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, note: 'POS đã kiểm tra', requestId: 'p', ...extra});
const reply = h => { const r = h.replies(); assert.equal(r.length, 1, JSON.stringify(r)); return r[0]; };
const save = (h, edit, requestId = 'save') => { const s = structuredClone(h.site); edit(s); return h.send({type: 'siteSave', site: s, requestId}); };

test('init, sync and reset own the billing state', () => {
  const h = harness();
  assert.deepEqual([h.st.billingVersion, h.st.billSeq, h.st.bills], [1, 0, []]);
  delete h.st.bills; delete h.st.billSeq;   // state persisted before billing existed
  h.tick(0);
  assert.deepEqual([h.st.billSeq, h.st.bills], [0, []]);
  order1(h); prepare(h);
  h.send({type: 'reset'});
  assert.deepEqual([h.st.billSeq, h.st.bills, h.st.orders], [0, [], []]);
});

test('prepare and claim over WS: a claimed amount never changes the bill', () => {
  const h = harness();
  order1(h);
  prepare(h);
  let rep = reply(h);
  assert.deepEqual([rep.reply, rep.ok, rep.requestId, rep.duplicate, rep.bill.status, 'receipts' in rep.bill], [true, true, 'p', undefined, 'prepared', false]);
  const b = h.st.bills[0];
  const r = h.send({type: 'billClaim', bill: b.id, rev: b.rev, requestId: 'c', amount: 1});
  assert.equal(h.st.bills[0].total, 1000);
  assert.equal(h.st.bills[0].status, 'claimed');
  assert.equal(h.st.orders[0].status, 'new', 'a claim is not settlement');
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.requestId, rep.bill.status, rep.bill.rev, 'receipts' in rep.bill], [true, 'c', 'claimed', 2, false]);
  assert.equal(h.st.bills[0].receipts.length, 2, 'the live bill keeps its receipts');
  const a = h.st.alerts.find(x => x.key === 'bill-claim-1');
  assert.ok(a && a.level === 'warn' && a.text.includes('Bàn 01') && a.text.includes('#1') && a.text.includes('1.000đ'), a && a.text);
  const ding = msgs(r).find(p => p.type === 'event' && p.stationSound === 'ding');
  assert.equal(ding.point, 'bar', 'ding goes to the request station');

  const bill = JSON.stringify(h.st.bills);
  h.send({type: 'ack', alert: a.id});
  assert.equal(JSON.stringify(h.st.bills), bill, 'ack never changes a bill');
  assert.ok(!h.st.alerts.some(x => x.key === 'bill-claim-1'));

  const logs = h.st.log.length;
  h.send({type: 'billClaim', bill: b.id, rev: 1, requestId: 'c', amount: 1});   // retry after reconnect
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.duplicate, rep.bill.rev], [true, true, 2]);
  assert.equal(h.st.log.length, logs, 'duplicate: no second log');
  assert.ok(!h.st.alerts.some(x => x.key === 'bill-claim-1'), 'duplicate: no second alert');

  h.send({type: 'billSettle', bill: b.id, rev: 1, method: 'transfer', requestId: 's-old'});
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId, typeof rep.text], [false, 'stale', 's-old', 'string']);
  assert.equal(JSON.stringify(h.st.bills), bill, 'refusal changes nothing');
});

test('turning pay off keeps an existing bill workable to the end', () => {
  const h = v2();
  order1(h); prepare(h);
  save(h, s => { s.features.pay = false; });
  assert.deepEqual([h.site.features.pay, h.site.rev], [false, 1]);
  const b = h.st.bills[0];
  h.send({type: 'billClaim', bill: b.id, rev: b.rev, requestId: 'c'});
  assert.equal(reply(h).ok, true);
  assert.ok(h.st.alerts.some(x => x.key === 'bill-claim-1'));
  h.send({type: 'billSettle', bill: b.id, rev: b.rev, method: 'transfer', requestId: 's'});
  assert.equal(reply(h).ok, true);
  assert.ok(!h.st.alerts.some(x => x.key === 'bill-claim-1'), 'settle resolves the claim alert');
  h.send({type: 'billClose', bill: b.id, rev: b.rev, requestId: 'x'});
  assert.equal(reply(h).ok, true);
  assert.deepEqual([h.st.bills[0].status, h.st.orders[0].status], ['closed', 'closed']);
});

test('a table being billed takes no new order until the bill is voided', () => {
  const h = v2();
  order1(h); prepare(h);
  h.send({type: 'order', table: 'T01', items: [{id: 'pho', qty: 1}], requestId: 'o1'});
  const rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId], [false, 'billing', 'o1']);
  assert.ok(rep.text.includes('Bàn đang tính tiền'), rep.text);
  assert.equal(h.st.orders.length, 1);
  h.send({type: 'order', table: 'T02', items: [{id: 'pho', qty: 1}]});
  assert.equal(h.st.orders.length, 2, 'other tables still order');
  h.send({type: 'billVoid', bill: 1, rev: 1, reason: 'Khách gọi thêm', requestId: 'v'});
  h.send({type: 'order', table: 'T01', items: [{id: 'pho', qty: 1}]});
  assert.equal(h.st.orders.length, 3);
});

test('payment account cannot change while a bill waits for payment', () => {
  const h = v2();
  order1(h); prepare(h);
  const edits = {bank: 'ACB', account: '123', name: 'KHAC', qr: 'data:image/png;base64,AAAA'};
  const refused = () => {
    for (const [k, v] of Object.entries(edits)) {
      const r = save(h, s => { s.payment[k] = v; }, k);
      const t = reply(h).text;
      assert.ok(t.startsWith('Không lưu: ') && t.includes('Bàn 01'), t);
      assert.equal(r.site, undefined, k);
    }
  };
  refused();
  h.send({type: 'billClaim', bill: 1, rev: 1, requestId: 'c'});
  refused();
  h.send({type: 'billSettle', bill: 1, rev: 2, method: 'transfer', requestId: 's'});
  assert.equal(save(h, s => { s.payment.bank = 'ACB'; }).site.payment.bank, 'ACB', 'settled bill no longer shows the QR');
});

test('a table with an open order or bill can be neither deleted nor made another kind', () => {
  const h = v2();
  order1(h);
  const check = () => {
    for (const edit of [s => { delete s.points.T01; }, s => { s.points.T01.kind = 'station'; }]) {
      const r = save(h, edit);
      const t = reply(h).text;
      assert.ok(t.startsWith('Không lưu: ') && t.includes('Bàn 01') && t.includes('đơn') && !t.includes('đang có lệnh'), t);
      assert.equal(r.site, undefined);
    }
  };
  check();
  h.st.orders[0].status = 'closed';
  prepare(h, {orderIds: [], total: 0, requestId: 'p0'});   // bill for a table that ordered at the POS only
  check();
  h.send({type: 'billVoid', bill: 1, rev: 1, reason: 'Nhầm bàn', requestId: 'v'});
  assert.equal(save(h, s => { delete s.points.T01; }).site.points.T01, undefined, 'free table can go');
});

test('legacy config: hello sends the migrated v2 site without saving it', () => {
  const h = harness();   // demo seed is pre-v2
  const raw = JSON.stringify(h.site);
  const r = h.send({type: 'hello'});
  const s = msgs(r).find(p => p.type === 'site');
  assert.equal(s.migrated, true);
  assert.equal(s.site.featurePolicyVersion, 2);
  assert.deepEqual(s.site.features, {guide: true, order: true, pay: true, callStaff: true, requestBill: true, busRobot: true});
  assert.deepEqual([s.site.service.requestStation, s.site.customerCancel, s.site.rev], ['bar', 'direct', 0]);
  assert.equal(r.site, undefined, 'migration is never persisted');
  assert.equal(JSON.stringify(h.site), raw);
  assert.equal('migrated' in msgs(v2().send({type: 'hello'})).find(p => p.type === 'site'), false);
});

test('importing an old file: setup normalizes it to v2 and the save goes through', () => {
  const h = v2();
  const file = structuredClone(seed); file.name = 'Nhập từ tệp';
  const {site, errors} = Site.normalize(file, h.site);
  assert.deepEqual(errors, []);
  site.rev = h.site.rev;
  const r = h.send({type: 'siteSave', site, requestId: 'imp'});
  assert.deepEqual([r.site.name, r.site.featurePolicyVersion, r.site.rev], ['Nhập từ tệp', 2, 1]);
});

test('stale setup page: a pre-v2 payload cannot overwrite a v2 live site', () => {
  const h = v2();
  const old = structuredClone(seed); old.rev = h.site.rev;
  const r = h.send({type: 'siteSave', site: old, requestId: 'old'});
  const t = reply(h).text;
  assert.ok(t.startsWith('Không lưu: ') && t.includes('tải lại'), t);
  assert.deepEqual([r.site, h.site.rev], [undefined, 0]);
  const l = harness();   // live site still pre-v2: a pre-v2 payload is fine, normalize migrates it
  const r2 = save(l, s => { s.name = 'Cũ'; });
  assert.deepEqual([r2.site.name, r2.site.featurePolicyVersion], ['Cũ', 2]);
});

test('old pay screen: call paid asks for a reload and changes nothing', () => {
  const h = v2();
  order1(h);
  const orders = JSON.stringify(h.st.orders), alerts = h.st.alerts.length, logs = h.st.log.length;
  h.send({type: 'call', point: 'T01', what: 'paid', amount: 123000, requestId: 'old'});
  const rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.text, rep.requestId], [false, 'reload', 'Màn thanh toán đã cũ — vui lòng tải lại trang', 'old']);
  assert.deepEqual([JSON.stringify(h.st.orders), h.st.alerts.length, h.st.log.length], [orders, alerts, logs]);
});

test('state snapshot carries open bills and orders only, without receipts', () => {
  const h = v2();
  order1(h);
  h.st.orders.push({id: 2, table: 'T02', status: 'closed', closedAt: 1e12, items: [], total: 0, t: 1e12});
  prepare(h);
  let s = state(h.send({type: 'hello'}));
  assert.deepEqual(s.orders.map(o => o.id), [1]);
  assert.deepEqual(s.bills.map(b => [b.id, 'receipts' in b]), [[1, false]]);
  assert.equal(h.st.bills[0].receipts.length, 1);
  h.send({type: 'billVoid', bill: 1, rev: 1, reason: 'Nhầm', requestId: 'v'});
  s = state(h.send({type: 'hello'}));
  assert.deepEqual(s.bills, []);
});

test('open orders and bills outlive days; closed ones leave 30 days after closing', () => {
  const h = v2();
  order1(h); prepare(h);
  h.tick(3 * DAY);
  assert.deepEqual([h.st.orders.length, h.st.bills.length], [1, 1]);
  h.send({type: 'billSettle', bill: 1, rev: 1, method: 'transfer', requestId: 's'});
  h.send({type: 'billClose', bill: 1, rev: 2, requestId: 'x'});
  h.tick(29 * DAY);
  assert.deepEqual([h.st.orders.length, h.st.bills.length], [1, 1]);
  h.tick(DAY);
  assert.deepEqual([h.st.orders, h.st.bills], [[], []]);
});
