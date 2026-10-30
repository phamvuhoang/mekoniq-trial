// Unit tests for lib/billing.js (staff-verified bills, spec §7): node scripts/test-billing.js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Billing = require('../data/lib/billing');
const site = require('../data/site.demo.json');
function fixture() {
  const st={orders:[{id:1,table:'T01',status:'new',total:1000,
    items:[{id:'test',qty:1,price:1000}],t:100}],missions:[]};
  Billing.init(st); return st;
}
test('claim is not settlement; closing uses the prepared snapshot', () => {
  const st=fixture();
  const prepared=Billing.handle(st,site,{type:'billPrepare',table:'T01',
    orderIds:[1],total:1000,note:'Đã kiểm tra',by:'Thu ngân',requestId:'p1'},1000);
  assert.equal(prepared.ok,true);
  const b=prepared.bill;
  const claim=Billing.handle(st,site,{type:'billClaim',bill:b.id,rev:b.rev,requestId:'c1'},2000);
  assert.equal(claim.bill.status,'claimed');
  assert.notEqual(st.orders[0].status,'closed');
  const settled=Billing.handle(st,site,{type:'billSettle',bill:b.id,rev:claim.bill.rev,
    method:'transfer',by:'Thu ngân',requestId:'s1'},3000);
  assert.equal(settled.bill.status,'settled');
  assert.notEqual(st.orders[0].status,'closed');
  const closed=Billing.handle(st,site,{type:'billClose',bill:b.id,rev:settled.bill.rev,
    by:'Thu ngân',requestId:'x1'},4000);
  assert.equal(closed.bill.status,'closed');
  assert.equal(st.orders[0].status,'closed');
});
test('retry after serialize/restart does not prepare a second bill', () => {
  let st=fixture();
  const cmd={type:'billPrepare',table:'T01',orderIds:[1],total:1000,note:'',by:'Staff',requestId:'p2'};
  Billing.handle(st,site,cmd,1000);
  st=JSON.parse(JSON.stringify(st)); Billing.init(st);
  assert.equal(Billing.handle(st,site,cmd,2000).duplicate,true);
  assert.equal(st.bills.length,1);
});

const DAY = 24 * 3600 * 1000;
const H = (st, cmd, now = 1000) => Billing.handle(st, site, cmd, now);
const prep = (st, extra = {}) => H(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, note: '', by: 'Thu ngân', requestId: 'p', ...extra});
// Every failure must leave st byte-identical.
function rejects(st, cmd, code) {
  const before = JSON.stringify(st);
  const r = H(st, cmd);
  assert.equal(r.ok, false, JSON.stringify(cmd));
  assert.equal(r.code, code, JSON.stringify(cmd));
  assert.equal(typeof r.text, 'string');
  assert.equal(JSON.stringify(st), before, 'error mutated st: ' + JSON.stringify(cmd));
}

test('init adds billing metadata, keeps the bill sequence monotonic and never touches orders', () => {
  const st = {orders: [{id: 7, table: 'T02', status: 'paid-claimed', total: 5, items: [], t: 1}], missions: [],
    bills: [{id: 9, table: 'T03', status: 'closed', closedAt: 1, receipts: []}], billSeq: 3};
  const orders = JSON.stringify(st.orders);
  Billing.init(st);
  assert.equal(st.billingVersion, 1);
  assert.equal(st.billSeq, 9);
  assert.equal(JSON.stringify(st.orders), orders);
  const fresh = {orders: [], missions: []};
  Billing.init(fresh);
  assert.deepEqual([fresh.billSeq, fresh.bills], [0, []]);
});

test('prepare stores a staff-verified bill with the exact fields', () => {
  const st = fixture();
  const r = prep(st, {note: '  Đã kiểm tra  '});
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
  const b = r.bill;
  assert.deepEqual({id: b.id, table: b.table, rev: b.rev, status: b.status, source: b.source, total: b.total, suggested: b.suggested,
    note: b.note, orderIds: b.orderIds, preparedBy: b.preparedBy, preparedAt: b.preparedAt, requestId: b.requestId},
  {id: 1, table: 'T01', rev: 1, status: 'prepared', source: 'staff-verified', total: 1000, suggested: 1000,
    note: 'Đã kiểm tra', orderIds: [1], preparedBy: 'Thu ngân', preparedAt: 1000, requestId: 'p'});
  assert.equal(b.receipts.length, 1);
  assert.deepEqual({requestId: b.receipts[0].requestId, type: b.receipts[0].type, at: b.receipts[0].at}, {requestId: 'p', type: 'billPrepare', at: 1000});
  assert.equal(st.orders[0].status, 'new');
});

test('prepare validates input, table, open bill, order set and note without mutating', () => {
  const st = fixture();
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000}, 'invalid');                 // no requestId
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, requestId: '   '}, 'invalid');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, requestId: 'x'.repeat(101)}, 'invalid');
  rejects(st, {type: 'billNope', requestId: 'q'}, 'invalid');
  rejects(st, {type: 'billPrepare', table: 'bar', orderIds: [], total: 0, note: 'x', requestId: 'q'}, 'invalid');   // station, not table
  rejects(st, {type: 'billPrepare', table: 'T99', orderIds: [], total: 0, note: 'x', requestId: 'q'}, 'invalid');
  for (const total of [-1, 10.5, '1000', NaN, Infinity, null])
    rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total, note: 'x', requestId: 'q'}, 'invalid');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, note: 'x'.repeat(201), requestId: 'q'}, 'invalid');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: 1, total: 1000, requestId: 'q'}, 'invalid');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [], total: 1000, note: 'x', requestId: 'q'}, 'orders-changed');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1, 2], total: 1000, note: 'x', requestId: 'q'}, 'orders-changed');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1, 1], total: 1000, note: 'x', requestId: 'q'}, 'orders-changed');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 900, note: '  ', requestId: 'q'}, 'note-required');
  rejects(st, {type: 'billPrepare', table: 'T02', orderIds: [], total: 0, requestId: 'q'}, 'note-required');   // no robot orders
  assert.equal(prep(st).ok, true);
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, requestId: 'q'}, 'open-bill');
  // POS-only table: total + checked description, no robot orders.
  const pos = H(st, {type: 'billPrepare', table: 'T02', orderIds: [], total: 250000, note: 'Gọi tại quầy, đã kiểm tra', requestId: 'pos'});
  assert.deepEqual([pos.ok, pos.bill.id, pos.bill.suggested, pos.bill.orders], [true, 2, 0, []]);
});

test('closed orders are not part of the open set; paid-claimed legacy orders are open and never auto-settled', () => {
  const st = {orders: [
    {id: 1, table: 'T01', status: 'closed', closedAt: 1, total: 10, items: [], t: 1},
    {id: 2, table: 'T01', status: 'paid-claimed', total: 2000, items: [{id: 'pho', qty: 1, price: 2000}], t: 1}], missions: []};
  Billing.init(st);
  assert.equal(st.orders[1].status, 'paid-claimed');
  assert.deepEqual(st.bills, []);
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1, 2], total: 2000, requestId: 'q'}, 'orders-changed');
  const r = H(st, {type: 'billPrepare', table: 'T01', orderIds: [2], total: 2000, requestId: 'q'});
  assert.equal(r.bill.status, 'prepared');
  assert.equal(st.orders[1].status, 'paid-claimed');
});

test('snapshot keeps names and order prices, survives menu edits, falls back to id for removed items', () => {
  const st = {orders: [{id: 1, table: 'T01', status: 'new', total: 100000,
    items: [{id: 'pho', qty: 2, price: 40000}, {id: 'gone', qty: 1, price: 20000}], t: 1}], missions: []};
  Billing.init(st);
  const menu = structuredClone(site);
  const b = Billing.handle(st, menu, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 100000, requestId: 'p'}, 5).bill;
  assert.deepEqual(b.orders, [{id: 1, total: 100000, items: [
    {id: 'pho', vi: 'Phở bò', en: 'Beef pho', qty: 2, price: 40000},
    {id: 'gone', vi: 'gone', en: 'gone', qty: 1, price: 20000}]}]);
  const snap = JSON.stringify(b.orders);
  menu.menu.items[0].price = 99999; menu.menu.items[0].vi = 'Đổi tên';
  st.orders[0].items[0].qty = 5;   // even a later edit of the live order leaves the bill alone
  assert.equal(JSON.stringify(b.orders), snap);
});

test('stale rev, missing bill and wrong status are refused without mutating', () => {
  const st = fixture();
  const b = prep(st).bill;
  rejects(st, {type: 'billClaim', bill: 99, rev: 1, requestId: 'c'}, 'not-found');
  rejects(st, {type: 'billClaim', bill: b.id, rev: 0, requestId: 'c'}, 'stale');
  rejects(st, {type: 'billClaim', bill: b.id, requestId: 'c'}, 'stale');
  rejects(st, {type: 'billClose', bill: b.id, rev: 1, requestId: 'c'}, 'status');
  assert.equal(H(st, {type: 'billClaim', bill: b.id, rev: 1, requestId: 'c'}).bill.rev, 2);
  rejects(st, {type: 'billClaim', bill: b.id, rev: 1, requestId: 'c2'}, 'stale');      // old rev after the claim
  rejects(st, {type: 'billClaim', bill: b.id, rev: 2, requestId: 'c2'}, 'status');     // already claimed
  assert.equal(H(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'cash', requestId: 's'}).ok, true);
  rejects(st, {type: 'billVoid', bill: b.id, rev: 3, reason: 'x', requestId: 'v'}, 'status');   // settled cannot be voided
});

test('same requestId + same payload replays, different payload conflicts, failures leave no receipt', () => {
  const st = fixture();
  const b = prep(st).bill;
  const claim = {type: 'billClaim', bill: b.id, rev: 1, requestId: 'c'};
  const first = H(st, claim);
  const after = JSON.stringify(st);
  const again = H(st, {...claim, requestId: ' c '}, 9999);
  assert.deepEqual([again.ok, again.duplicate, again.bill.id, again.bill.rev], [true, true, b.id, 2]);
  assert.equal(first.duplicate, false);
  assert.equal(JSON.stringify(st), after);
  rejects(st, {...claim, by: 'Khách khác'}, 'request-conflict');
  rejects(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'cash', requestId: 'c'}, 'request-conflict');
  rejects(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 1000, note: '', by: 'Thu ngân', requestId: 'c'}, 'request-conflict');
  assert.equal(prep(st).duplicate, true);                // prepare receipt lives in the bill it created
  rejects(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'zero', requestId: 's'}, 'method');
  assert.equal(H(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'card', requestId: 's'}).ok, true);   // failed 's' left no receipt
  assert.equal(b.receipts.length, 3);
});

test('claim never takes an amount; zero bills are settled with method zero only', () => {
  const st = fixture();
  const b = prep(st).bill;
  const r = H(st, {type: 'billClaim', bill: b.id, rev: 1, total: 1, amount: 1, by: 'Khách', requestId: 'c'}, 2000);
  assert.deepEqual([r.bill.total, r.bill.claimedAt, r.bill.claimedBy, 'amount' in r.bill], [1000, 2000, 'Khách', false]);
  rejects(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'zero', requestId: 's'}, 'method');
  rejects(st, {type: 'billSettle', bill: b.id, rev: 2, method: 'bitcoin', requestId: 's'}, 'invalid');

  const z = fixture();
  const zb = prep(z, {total: 0, note: 'Mời'}).bill;
  assert.equal(zb.suggested, 1000);
  rejects(z, {type: 'billClaim', bill: zb.id, rev: 1, requestId: 'c'}, 'zero');
  for (const method of ['transfer', 'cash', 'card'])
    rejects(z, {type: 'billSettle', bill: zb.id, rev: 1, method, requestId: 's'}, 'method');
  const s = H(z, {type: 'billSettle', bill: zb.id, rev: 1, method: 'zero', by: 'Quản lý', requestId: 's'}, 3000).bill;
  assert.deepEqual([s.status, s.method, s.settledAt, s.settledBy, s.rev], ['settled', 'zero', 3000, 'Quản lý', 2]);
});

test('void keeps the orders open and needs a reason', () => {
  const st = fixture();
  const b = prep(st).bill;
  rejects(st, {type: 'billVoid', bill: b.id, rev: 1, requestId: 'v'}, 'invalid');
  rejects(st, {type: 'billVoid', bill: b.id, rev: 1, reason: '   ', requestId: 'v'}, 'invalid');
  rejects(st, {type: 'billVoid', bill: b.id, rev: 1, reason: 'x'.repeat(201), requestId: 'v'}, 'invalid');
  const v = H(st, {type: 'billVoid', bill: b.id, rev: 1, reason: ' Khách gọi thêm ', by: 'Thu ngân', requestId: 'v'}, 5000).bill;
  assert.deepEqual([v.status, v.voidAt, v.voidBy, v.voidReason, v.rev], ['void', 5000, 'Thu ngân', 'Khách gọi thêm', 2]);
  assert.equal(st.orders[0].status, 'new');
  const again = prep(st, {requestId: 'p2'});
  assert.deepEqual([again.ok, again.bill.id, again.bill.orderIds], [true, 2, [1]]);
});

test('close is refused while the table has new orders or a delivery still heading there', () => {
  const settle = st => {
    const b = prep(st).bill;
    H(st, {type: 'billSettle', bill: b.id, rev: 1, method: 'cash', requestId: 's'});
    return b;
  };
  const late = fixture();
  const b = settle(late);
  late.orders.push({id: 2, table: 'T01', status: 'new', total: 5, items: [], t: 2});
  rejects(late, {type: 'billClose', bill: b.id, rev: 2, requestId: 'x'}, 'busy');

  for (const status of ['queued', 'active']) {
    const st = fixture();
    const bb = settle(st);
    st.missions.push({id: 1, kind: 'deliver', status, stops: [{p: 'T01', a: 'handoff', status: status === 'active' ? 'active' : 'pending'}]});
    rejects(st, {type: 'billClose', bill: bb.id, rev: 2, requestId: 'x'}, 'busy');
  }
  // Done/skipped stops, finished missions and other tables do not block.
  const ok = fixture();
  const ob = settle(ok);
  ok.missions.push({id: 1, status: 'active', stops: [{p: 'T01', a: 'handoff', status: 'done'}, {p: 'T02', a: 'handoff', status: 'pending'}]},
    {id: 2, status: 'done', stops: [{p: 'T01', a: 'handoff', status: 'pending'}]});
  ok.orders.push({id: 3, table: 'T02', status: 'new', total: 5, items: [], t: 2});
  const c = H(ok, {type: 'billClose', bill: ob.id, rev: 2, by: 'Thu ngân', requestId: 'x'}, 7000).bill;
  assert.deepEqual([c.status, c.closedAt, c.closedBy, c.rev], ['closed', 7000, 'Thu ngân', 3]);
  assert.deepEqual(ok.orders.map(o => o.status), ['closed', 'new']);
  assert.deepEqual([ok.orders[0].closedAt, ok.orders[0].closedBy, ok.orders[0].bill], [7000, 'Thu ngân', ob.id]);
});

test('a robot parked on standby at the table (the pay screen) does not block close; handoff/collect/guide stops still do', () => {
  const settled = () => {
    const st = fixture(), b = prep(st).bill;
    H(st, {type: 'billSettle', bill: b.id, rev: 1, method: 'transfer', requestId: 's'});
    return [st, b];
  };
  for (const a of ['handoff', 'collect', 'guide']) {
    const [st, b] = settled();
    st.missions.push({id: 1, kind: 'x', status: 'active', stops: [{p: 'T01', a, status: 'active'}]});
    rejects(st, {type: 'billClose', bill: b.id, rev: 2, requestId: 'x'}, 'busy');
  }
  const [st, b] = settled();
  st.missions.push({id: 1, kind: 'summon', status: 'active', stops: [{p: 'T01', a: 'standby', status: 'active'}]});
  const c = H(st, {type: 'billClose', bill: b.id, rev: 2, requestId: 'x'});
  assert.deepEqual([c.ok, c.bill.status, st.orders[0].status], [true, 'closed', 'closed']);
});

test('close marks exactly the snapshot orderIds, never by table', () => {
  const st = {orders: [{id: 1, table: 'T01', status: 'new', total: 10, items: [], t: 1}], missions: []};
  Billing.init(st);
  const b = H(st, {type: 'billPrepare', table: 'T01', orderIds: [1], total: 10, requestId: 'p'}).bill;
  H(st, {type: 'billSettle', bill: b.id, rev: 1, method: 'cash', requestId: 's'});
  st.orders[0].table = 'T05';   // order moved after prepare (bill keeps it)
  assert.equal(H(st, {type: 'billClose', bill: b.id, rev: 2, requestId: 'x'}).ok, true);
  assert.equal(st.orders[0].status, 'closed');
});

test('cleanup drops terminal bills and closed orders at exactly 30 days, never open records', () => {
  const now = 100 * DAY, T = 30 * DAY;
  const st = {missions: [], billSeq: 6, orders: [
    {id: 1, table: 'T01', status: 'closed', closedAt: now - T, t: 0},
    {id: 2, table: 'T01', status: 'closed', closedAt: now - T + 1, t: 0},
    {id: 3, table: 'T02', status: 'new', t: now - 31 * DAY},
    {id: 4, table: 'T03', status: 'paid-claimed', t: now - 31 * DAY}],
  bills: [
    {id: 1, table: 'T01', status: 'closed', closedAt: now - T},
    {id: 2, table: 'T01', status: 'closed', closedAt: now - T + 1},
    {id: 3, table: 'T02', status: 'void', voidAt: now - T},
    {id: 4, table: 'T02', status: 'void', voidAt: now - T + 1, preparedAt: 0},
    {id: 5, table: 'T04', status: 'prepared', preparedAt: now - 31 * DAY},
    {id: 6, table: 'T05', status: 'settled', preparedAt: now - 31 * DAY, settledAt: now - 31 * DAY}]};
  Billing.init(st);
  Billing.cleanup(st, now);
  assert.deepEqual(st.orders.map(o => o.id), [2, 3, 4]);
  assert.deepEqual(st.bills.map(b => b.id), [2, 4, 5, 6]);
  assert.equal(st.billSeq, 6);
});
