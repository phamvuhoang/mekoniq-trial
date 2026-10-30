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

test('an open order for a table already gone from the site never blocks a save', () => {
  const h = v2();   // e.g. table deleted before inUse counted orders; the 24 h purge no longer clears it
  h.st.orders = [{id: 1, table: 'T99', status: 'new', items: [], total: 1000, t: 1e12}];
  assert.equal(save(h, s => { s.name = 'Đổi tên'; }).site.name, 'Đổi tên');
  assert.equal(h.send({type: 'siteReset', requestId: 'r'}).site.rev, 2);
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

// ---- Task 5: gates for requests, cancellation, bus and capability (spec §3, §5, §6, §9) ----
const events = r => msgs(r).filter(p => p.type === 'event');
const dings = r => events(r).filter(e => e.stationSound === 'ding');
const alertOf = (h, key) => h.st.alerts.find(a => a.key === key);
const deliver = (h, tables = ['T05', 'T07']) => { h.send({type: 'create', kind: 'deliver', from: 'kitchen', tables, robot: 'R1'}); return h.st.missions[h.st.missions.length - 1]; };
const standby = (h, robot, to = 'bar') => { h.send({type: 'create', kind: 'summon', to, robot}); const m = h.st.missions.find(x => x.robot === robot); h.arrive(robot); return m; };

test('callStaff off / requestBill on: only the bill request goes through', () => {
  const h = v2();
  h.site.features.callStaff = false;
  h.site.features.requestBill = true;
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'a'});
  assert.equal(h.st.alerts.some(a => a.key === 'call-staff-T01'), false);
  let rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId], [false, 'disabled', 'a']);
  const r = h.send({type: 'call', point: 'T01', what: 'bill', requestId: 'b'});
  const a = alertOf(h, 'call-bill-T01');
  assert.deepEqual([a.text, a.station], ['Bàn 01 yêu cầu tính tiền', 'bar']);
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.requestId], [true, 'b']);
  assert.deepEqual(dings(r).map(e => e.point), ['bar']);
  assert.ok(!JSON.stringify(h.st).includes('xin hoá đơn'));
});

test('bill request off / callStaff on: only staff is called; on but not ready answers the reasons', () => {
  const h = v2();
  h.site.features.requestBill = false;
  h.send({type: 'call', point: 'T01', what: 'bill', requestId: 'b'});
  assert.deepEqual([reply(h).code, h.st.alerts.length], ['disabled', 0]);
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 's'});
  assert.equal(alertOf(h, 'call-staff-T01').text, 'Bàn 01 gọi nhân viên');
  h.site.service.requestStation = null;
  h.send({type: 'call', point: 'T02', what: 'staff', requestId: 's2'});
  const rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.text], [false, 'not-ready', 'Chưa chọn trạm nhận yêu cầu hoặc trạm đó không còn']);
  assert.equal(alertOf(h, 'call-staff-T02'), undefined);
  delete h.site.service;   // v2 site that skipped normalize: refused, never a throw
  h.send({type: 'call', point: 'T02', what: 'staff', requestId: 's3'});
  assert.equal(reply(h).code, 'not-ready');
});

test('pay works without callStaff or requestBill: a claim still reaches the request station', () => {
  const h = v2();
  Object.assign(h.site.features, {callStaff: false, requestBill: false, pay: true});
  order1(h); prepare(h);
  const r = h.send({type: 'billClaim', bill: 1, rev: 1, requestId: 'c'});
  assert.equal(reply(h).ok, true);
  assert.equal(alertOf(h, 'bill-claim-1').station, 'bar');
  assert.deepEqual(dings(r).map(e => e.point), ['bar']);
  delete h.site.service;   // missing service block: the claim is still recorded, routed to every station
  h.send({type: 'billVoid', bill: 1, rev: 2, reason: 'Nhầm', requestId: 'v'});
  prepare(h, {requestId: 'p2'});
  h.send({type: 'billClaim', bill: 2, rev: 1, requestId: 'c2'});
  assert.equal(reply(h).ok, true);
  assert.equal(alertOf(h, 'bill-claim-2').station, null);
});

test('call routing and dedupe: one alert per table and type until ack, ding at the request station', () => {
  const h = v2();
  h.site.service.requestStation = 'kitchen';
  let r = h.send({type: 'call', point: 'T03', what: 'staff', requestId: '1'});
  assert.equal(alertOf(h, 'call-staff-T03').station, 'kitchen');
  assert.deepEqual(dings(r).map(e => e.point), ['kitchen']);
  const logs = h.st.log.length;
  r = h.send({type: 'call', point: 'T03', what: 'staff', requestId: '2'});   // a new tap while the alert is open
  assert.deepEqual([reply(h).ok, reply(h).duplicate], [true, undefined]);
  assert.deepEqual([h.st.alerts.filter(a => a.key === 'call-staff-T03').length, dings(r).length, h.st.log.length], [1, 0, logs]);
  h.send({type: 'call', point: 'T03', what: 'bill', requestId: '3'});
  assert.equal(h.st.alerts.length, 2, 'staff and bill are separate alerts');
  h.send({type: 'ack', alert: alertOf(h, 'call-staff-T03').id});
  h.send({type: 'call', point: 'T03', what: 'staff', requestId: '4'});
  assert.ok(alertOf(h, 'call-staff-T03'), 'a new request after ack alerts again');
});

test('call receipts: a retry within 24 h never re-alerts, even after ack; another payload conflicts', () => {
  const h = v2();
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'a'});
  h.send({type: 'ack', alert: alertOf(h, 'call-staff-T01').id});
  const r = h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'a'});
  let rep = reply(h);
  assert.deepEqual([rep.ok, rep.duplicate, rep.requestId], [true, true, 'a']);
  assert.deepEqual([h.st.alerts.length, dings(r).length], [0, 0]);
  h.send({type: 'call', point: 'T01', what: 'bill', requestId: 'a'});
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.code], [false, 'request-conflict']);
  assert.equal(h.st.alerts.length, 0);
  assert.deepEqual(h.st.requests.map(q => q.id), ['a'], 'only accepted requests leave a receipt');
  // receipts survive a restart (persisted st)
  const h2 = v2();
  for (const k of Object.keys(h2.st)) delete h2.st[k];
  Object.assign(h2.st, JSON.parse(JSON.stringify(h.st)));
  h2.send({type: 'call', point: 'T01', what: 'staff', requestId: 'a'});
  assert.deepEqual([h2.replies()[0].duplicate, h2.st.alerts.length], [true, 0]);
  // pruned after 24 h: the same id is a new request again
  h.tick(DAY);
  assert.deepEqual(h.st.requests, []);
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'a'});
  assert.deepEqual([reply(h).duplicate, !!alertOf(h, 'call-staff-T01')], [undefined, true]);
});

test('call receipts: refusals and requests without requestId leave none', () => {
  const h = v2();
  h.site.features.callStaff = false;
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'x'});
  assert.equal(reply(h).code, 'disabled');
  h.site.features.callStaff = true;
  h.send({type: 'call', point: 'T01', what: 'staff', requestId: 'x'});
  assert.deepEqual([reply(h).duplicate, !!alertOf(h, 'call-staff-T01')], [undefined, true], 'a refused id is not a receipt');
  h.send({type: 'ack', alert: alertOf(h, 'call-staff-T01').id});
  h.send({type: 'call', point: 'T01', what: 'staff'});   // old cached client: processed, no receipt
  assert.ok(alertOf(h, 'call-staff-T01'));
  assert.deepEqual(h.st.requests.map(q => q.id), ['x']);
});

test('returnRequest: alert keyed by mission/stop/table, mission untouched, works with callStaff off under both policies', () => {
  for (const policy of ['request', 'direct']) {
    const h = v2();
    Object.assign(h.site, {customerCancel: policy});
    Object.assign(h.site.features, {callStaff: false, requestBill: false});
    const m = deliver(h);
    const before = JSON.stringify(h.st.missions), kpi = JSON.stringify(h.st.kpi);
    const r = h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T05', reason: 'wrong-item', requestId: 'r1', by: 'Khách Bàn 05 (QR)'});
    const rep = reply(h);
    assert.deepEqual([rep.ok, rep.requestId], [true, 'r1'], policy);
    assert.equal(JSON.stringify(h.st.missions), before, 'never changes the mission');
    assert.equal(JSON.stringify(h.st.kpi), kpi);
    const a = alertOf(h, `return-${m.id}-1-T05`);
    assert.deepEqual([a.ref, a.station, a.level], [{mission: m.id, stop: 1, table: 'T05', reason: 'wrong-item'}, 'kitchen', 'warn']);
    assert.ok(a.text.includes('Bàn 05'), a.text);
    assert.deepEqual(dings(r).map(e => e.point), ['kitchen'], 'the station that loaded the trip');
    h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T05', reason: 'wrong-item', requestId: 'r1'});
    assert.deepEqual([reply(h).duplicate, h.st.alerts.length], [true, 1]);
    h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T05', reason: 'need-help', requestId: 'r1'});
    assert.equal(reply(h).code, 'request-conflict');
    h.send({type: 'ack', alert: a.id});
    h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T05', reason: 'wrong-item', requestId: 'r1'});
    assert.deepEqual([reply(h).duplicate, h.st.alerts.length], [true, 0], 'retry after ack: no new alert');
  }
});

test('returnRequest refuses a stale or invalid stop and routes to a fallback station', () => {
  const h = v2();
  const m = deliver(h);
  const refused = (d, code) => {
    const before = JSON.stringify([h.st.missions, h.st.alerts, h.st.requests]);
    h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T05', reason: 'need-help', requestId: 'q' + Math.random(), ...d});
    const rep = reply(h);
    assert.deepEqual([rep.ok, rep.code], [false, code], JSON.stringify(d));
    assert.ok(rep.text, 'a refusal says why');
    assert.equal(JSON.stringify([h.st.missions, h.st.alerts, h.st.requests]), before);
  };
  refused({reason: 'refund'}, 'invalid');
  refused({mission: 999}, 'stale');
  refused({stop: 0}, 'stale');   // the load stop is not a handoff
  refused({stop: '1'}, 'stale');   // alert.ref.stop is always the stop index
  h.send({type: 'retarget', mission: m.id, stop: 1, to: 'T09'});
  refused({table: 'T05'}, 'stale');   // QR of the old table after the kitchen moved the stop
  h.send({type: 'cancelStop', mission: m.id, stop: 2});   // staff dropped T07
  refused({stop: 2, table: 'T07'}, 'stale');
  // load point no longer a station -> request station -> first station -> refuse
  m.stops[0].p = 'dish';
  h.site.service.requestStation = 'kitchen';
  let r = h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T09', reason: 'need-help', requestId: 'f1'});
  assert.deepEqual([alertOf(h, `return-${m.id}-1-T09`).station, dings(r)[0].point], ['kitchen', 'kitchen']);
  h.st.alerts = [];
  delete h.site.service;
  r = h.send({type: 'returnRequest', mission: m.id, stop: 1, table: 'T09', reason: 'need-help', requestId: 'f2'});
  assert.deepEqual([alertOf(h, `return-${m.id}-1-T09`).station, dings(r)[0].point], ['bar', 'bar']);
  h.st.alerts = [];
  for (const p of Object.values(h.site.points)) if (p.kind === 'station') p.kind = 'entrance';
  refused({table: 'T09'}, 'no-station');
});

test('customer cancel: refused under the request policy (old clients too), table required, staff unaffected', () => {
  const h = v2();
  h.site.customerCancel = 'request';
  const m = deliver(h);
  const before = JSON.stringify(h.st.missions);
  h.send({type: 'cancelStop', mission: m.id, stop: 1, why: 'customer', table: 'T05', requestId: 'c1'});
  let rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId], [false, 'policy', 'c1']);
  h.send({type: 'cancelStop', mission: m.id, stop: 1, why: 'customer'});   // old robot screen: no table
  assert.equal(reply(h).ok, false);
  assert.equal(JSON.stringify(h.st.missions), before);
  delete h.site.customerCancel;   // v2 site that skipped normalize: new-site default 'request'
  h.send({type: 'cancelStop', mission: m.id, stop: 1, why: 'customer', table: 'T05'});
  assert.equal(reply(h).code, 'policy');
  h.send({type: 'cancelStop', mission: m.id, stop: 1});   // staff recall keeps working
  assert.equal(m.stops[1].status, 'skipped');
  assert.equal(h.st.kpi.cancelledStaff, 1);
});

test('customer cancel under direct: needs the table, refuses a stop moved to another table', () => {
  const h = v2();
  assert.equal(h.site.customerCancel, 'direct');   // migrated demo
  const m = deliver(h);
  h.send({type: 'cancelStop', mission: m.id, stop: 1, why: 'customer'});
  assert.deepEqual([reply(h).code, m.stops[1].status], ['invalid', 'pending']);
  h.send({type: 'retarget', mission: m.id, stop: 1, to: 'T09'});
  h.send({type: 'cancelStop', mission: m.id, stop: 1, why: 'customer', table: 'T05', requestId: 'old'});
  assert.deepEqual([reply(h).code, m.stops[1].status], ['stale', 'pending']);
  h.send({type: 'cancelStop', mission: m.id, stop: 2, why: 'customer', table: 'T07', requestId: 'ok'});
  assert.deepEqual([reply(h).ok, m.stops[2].status, h.st.kpi.cancelledCustomer], [true, 'skipped', 1]);
});

test('busRobot off: the robot screen cannot start a bus trip, the station still can', () => {
  const h = v2();
  h.site.features.busRobot = false;
  const m = standby(h, 'R3', 'kitchen');
  assert.equal(h.st.robots.R3.phase, 'atStop');
  h.send({type: 'dispatch', robot: 'R3', mission: m.id, tables: ['T05'], bus: true, requestId: 'b'});
  let rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId, m.kind, m.stops.length], [false, 'disabled', 'b', 'summon', 1]);
  const t = standby(h, 'R2', 'T03');
  h.send({type: 'dispatch', robot: 'R2', mission: t.id, toDish: true});
  assert.deepEqual([reply(h).code, t.kind, t.stops.length], ['disabled', 'summon', 1]);
  h.send({type: 'dispatch', robot: 'R3', mission: m.id, tables: ['T06']});   // deliver from the robot screen: not a bus
  assert.equal(m.kind, 'deliver');
  const w = standby(h, 'R1');
  h.send({type: 'dispatch', robot: 'R1', mission: w.id, release: true});   // "Xong · Cho robot về" is never gated
  assert.equal(w.status, 'done');
  h.send({type: 'create', kind: 'bus', table: 'T05', robot: 'any'});
  assert.ok(h.st.missions.some(x => x.kind === 'bus' && x.stops[0].p === 'T05'), 'station bus is not gated');
  h.site.features.busRobot = true;
  h.send({type: 'dispatch', robot: 'R2', mission: t.id, toDish: true});
  assert.deepEqual([h.replies().length, t.kind], [0, 'bus']);
  h.site.features.busRobot = false;   // the bus trip already running still unloads
  h.arrive('R2');
  h.send({type: 'confirm', robot: 'R2', mission: t.id, stop: t.cur});
  assert.equal(t.status, 'done');
});

test('busRobot on but not ready: the robot screen gets the reason', () => {
  const h = v2();
  h.site.dishPoint = 'nowhere';
  const m = standby(h, 'R3', 'kitchen');
  h.send({type: 'dispatch', robot: 'R3', mission: m.id, tables: ['T05'], bus: true});
  const rep = reply(h);
  assert.deepEqual([rep.code, rep.text, m.kind], ['not-ready', 'Chưa có khu rửa chén hợp lệ', 'summon']);
});

test('speed: simulator robot changes speed, Valetudo robot in the same site is refused without touching state', () => {
  const h = v2();
  Object.assign(h.site.robots[1], {driver: 'valetudo', valetudo: {topic: 'v/R2', points: {bar: {x: 10, y: 10}, D2: {x: 0, y: 0}}}});
  standby(h, 'R1'); standby(h, 'R2');
  let r = h.send({type: 'speed', robot: 'R1', slow: true});
  assert.deepEqual([r.cmds, h.st.robots.R1.slow, h.replies()], [[{cmd: 'speed', robot: 'R1', factor: 0.5}], true, []]);
  const logs = h.st.log.length;
  r = h.send({type: 'speed', robot: 'R2', slow: true, requestId: 'sp'});
  const rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId], [false, 'unsupported', 'sp']);
  assert.deepEqual([r.cmds, h.st.robots.R2.slow, h.st.log.length], [[], undefined, logs], 'no r.slow, no cmd, no success log');
});

test('speed: malformed or missing robot config fails closed', () => {
  const h = v2();
  standby(h, 'R3');
  const refused = what => {
    const r = h.send({type: 'speed', robot: 'R3', slow: true});
    assert.deepEqual([reply(h).code, r.cmds, h.st.robots.R3.slow], ['unsupported', [], undefined], what);
  };
  h.site.robots[2].driver = 'valetudo'; h.site.robots[2].speedControl = true;
  refused('a config boolean never claims speed support');
  h.site.robots[2] = {id: 'R3', dock: 'D3', driver: 'acme'};
  refused('unknown driver');
  h.site.robots.splice(2, 1);   // removed from setup while it still has a job
  refused('no config');
});

test('guide: refused when off or not reachable; a guide accepted before the toggle still finishes', () => {
  const h = v2();
  Object.assign(h.site.robots[1], {driver: 'valetudo', valetudo: {topic: 'v/R2', points: {bar: {x: 10, y: 10}, D2: {x: 0, y: 0}}}});
  standby(h, 'R1'); const s2 = standby(h, 'R2');
  h.site.features.guide = false;
  h.send({type: 'create', kind: 'guide', to: 'T07', robot: 'R1', requestId: 'g0'});
  assert.deepEqual([reply(h).code, h.st.missions.some(m => m.kind === 'guide')], ['disabled', false]);
  h.site.features.guide = true;
  delete h.st.map.nodes.T07;   // simulator: no route node for this table
  h.send({type: 'create', kind: 'guide', to: 'T07', robot: 'R1', requestId: 'g1'});
  assert.deepEqual([reply(h).code, h.st.missions.some(m => m.kind === 'guide')], ['unreachable', false]);
  h.send({type: 'create', kind: 'guide', to: 'T08', robot: 'R2', requestId: 'g2'});   // Valetudo: T08 never taught
  assert.deepEqual([reply(h).code, s2.status], ['unreachable', 'active'], 'standby job kept on refusal');
  h.site.robots[1].valetudo.points.T08 = {x: 50, y: 50};
  h.send({type: 'create', kind: 'guide', to: 'T08', robot: 'R2'});
  assert.ok(h.st.missions.some(m => m.kind === 'guide' && m.robot === 'R2'));
  h.send({type: 'create', kind: 'guide', to: 'T01', robot: 'R1'});
  const g = h.st.missions.find(m => m.kind === 'guide' && m.robot === 'R1');
  h.site.features.guide = false;   // turned off mid-trip: speed, arrival and confirm still work
  assert.deepEqual(h.send({type: 'speed', robot: 'R1', slow: true}).cmds, [{cmd: 'speed', robot: 'R1', factor: 0.5}]);
  h.arrive('R1');
  h.send({type: 'confirm', robot: 'R1', mission: g.id, stop: g.cur});
  assert.equal(g.status, 'done');
  assert.equal(h.st.robots.R1.slow, false);
});

test('order: off or not ready answers the robot screen and records nothing; accepted orders are confirmed', () => {
  const h = v2();
  h.site.features.order = false;
  h.send({type: 'order', table: 'T05', items: [{id: 'pho', qty: 1}], requestId: 'o1'});
  let rep = reply(h);
  assert.deepEqual([rep.ok, rep.code, rep.requestId, h.st.orders.length, h.st.alerts.length], [false, 'disabled', 'o1', 0, 0]);
  h.site.features.order = true;
  h.send({type: 'order', table: 'T05', items: [{id: 'pho', qty: 1}], requestId: 'o2'});
  rep = reply(h);
  assert.deepEqual([rep.ok, rep.requestId, h.st.orders.length], [true, 'o2', 1]);
  h.site.menu.items[0].price = -1;
  h.send({type: 'order', table: 'T06', items: [{id: 'pho', qty: 1}], requestId: 'o3'});
  rep = reply(h);
  assert.deepEqual([rep.code, rep.text, h.st.orders.length], ['not-ready', 'Có món giá không hợp lệ', 1]);
});

test('order with an item gone from the menu or a bad quantity is refused, never dropped silently', () => {
  const h = v2();
  h.site.features.order = true;
  for (const items of [[{id: 'gone', qty: 1}], [{id: 'pho', qty: 0}], [{id: 'pho', qty: 1.5}], [], undefined]) {
    h.send({type: 'order', table: 'T05', items, requestId: 'o'});
    const rep = reply(h);
    assert.deepEqual([rep.ok, rep.code, rep.requestId, typeof rep.text, h.st.orders.length, h.st.alerts.length], [false, 'invalid', 'o', 'string', 0, 0], JSON.stringify(items));
  }
});
