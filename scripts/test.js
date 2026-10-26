// Scenario test for orchestrator + simulator with a fake clock: node scripts/test.js
const assert = require('assert');
const O = require('../data/lib/orchestrator'), S = require('../data/lib/simulator'), site = require('../data/site.json');

let now = 1e12;
const st = O.init(site, now), sim = S.init(site);
let events = [];
function pump(input) {
  const r = O.handle(st, site, input, now);
  for (const u of r.ui) { const p = JSON.parse(u.payload); if (p.type === 'event') events.push(p); }
  for (const cmd of r.cmds) for (const e of S.handle(sim, site, cmd, now)) pump({ source: 'adapter', data: e });
}
function run(sec) {
  for (let i = 0; i < sec * 2; i++) {
    now += 500;
    for (const e of S.handle(sim, site, { cmd: 'tick' }, now)) pump({ source: 'adapter', data: e });
  }
}
const send = d => pump({ source: 'ui', data: { by: 'test', ...d } });
const R = id => st.robots[id];
const M = id => st.missions.find(m => m.id === id) || st.history.find(m => m.id === id);
const last = () => st.missions[st.missions.length - 1];
function until(what, pred, max = 120) {
  for (let i = 0; i < max * 2; i++) { if (pred()) return; run(0.5); }
  throw new Error('timeout waiting: ' + what);
}
const stopOf = id => { const r = R(id), m = M(r.mission); return m && m.stops[m.cur]; };
const atStop = (id, a, p) => () => R(id).phase === 'atStop' && stopOf(id).a === a && (!p || stopOf(id).p === p);
const confirm = id => { const m = M(R(id).mission); send({ type: 'confirm', robot: id, mission: m.id, stop: m.cur }); };
function scenario(name, fn) { send({ type: 'reset' }); run(1); events = []; fn(); console.log('✓', name); }

scenario('giao 2 bàn, khách bàn 07 huỷ khi robot tới -> mang về bếp', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T05', 'T07'], robot: 'any' });
  const id = last().id;
  assert.strictEqual(M(id).robot, 'R1', 'nearest robot');
  until('load', atStop('R1', 'load', 'kitchen'));
  confirm('R1');
  confirm('R1');   // double tap ignored
  until('T05', atStop('R1', 'handoff', 'T05'));
  assert(events.some(e => e.robotSound === 'arrived' && e.table === 'T05'));
  confirm('R1');
  until('T07', atStop('R1', 'handoff', 'T07'));
  send({ type: 'cancelStop', mission: id, stop: 2, why: 'customer', by: 'Khách Bàn 07' });
  until('return', atStop('R1', 'return', 'kitchen'));
  assert.deepStrictEqual(stopOf('R1').trays, [{ tray: 2, table: 'T07' }]);
  confirm('R1');
  assert.strictEqual(M(id).status, 'done');
  assert.strictEqual(st.kpi.delivered, 1);
  assert.strictEqual(st.kpi.cancelledCustomer, 1);
  until('dock', () => R('R1').phase === 'idle' && R('R1').at === 'D1');
});

scenario('trạm huỷ trước khi xếp đồ -> robot về luôn', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'R2' });
  const id = last().id;
  run(2);
  assert.strictEqual(R('R2').phase, 'toStop');
  send({ type: 'cancel', mission: id });
  assert.strictEqual(M(id).status, 'cancelled');
  assert.strictEqual(R('R2').phase, 'toDock');
});

scenario('trạm huỷ giữa đường khi đã xếp đồ -> mang về quầy pha chế', () => {
  send({ type: 'create', kind: 'deliver', from: 'bar', tables: ['T12'], robot: 'any' });
  const id = last().id, rid = M(id).robot;
  until('load', atStop(rid, 'load', 'bar'));
  confirm(rid);
  run(3);
  send({ type: 'cancel', mission: id });
  assert.strictEqual(M(id).stops[1].status, 'cancelled');
  assert.strictEqual(R(rid).target, 'bar');
  until('return', atStop(rid, 'return', 'bar'));
  confirm(rid);
  assert.strictEqual(M(id).status, 'cancelled');
});

scenario('khách huỷ trước khi bếp xếp -> cả nhiệm vụ huỷ', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T09'], robot: 'any' });
  const id = last().id;
  send({ type: 'cancelStop', mission: id, stop: 1, why: 'customer' });
  assert.strictEqual(M(id).status, 'cancelled');
});

scenario('gọi robot tới bàn 03 rồi gửi chén đĩa về khu rửa', () => {
  send({ type: 'create', kind: 'summon', to: 'T03', robot: 'any' });
  const id = last().id, rid = M(id).robot;
  until('standby', atStop(rid, 'standby', 'T03'));
  send({ type: 'dispatch', robot: rid, mission: id, toDish: true });
  until('dish', atStop(rid, 'unload', 'dish'));
  send({ type: 'cancel', mission: id });   // dirty dishes on board: cancel refused
  assert.strictEqual(M(id).status, 'active');
  confirm(rid);
  assert.strictEqual(M(id).status, 'done');
  assert.strictEqual(M(id).kind, 'bus');
});

scenario('gọi robot về bếp rồi giao từ màn robot', () => {
  send({ type: 'create', kind: 'summon', to: 'kitchen', robot: 'R3' });
  const id = last().id;
  until('standby', atStop('R3', 'standby', 'kitchen'));
  send({ type: 'dispatch', robot: 'R3', mission: id, tables: ['T06'] });
  until('T06', atStop('R3', 'handoff', 'T06'));
  confirm('R3');
  assert.strictEqual(M(id).status, 'done');
});

scenario('thu dọn bàn: khu rửa', () => {
  send({ type: 'create', kind: 'bus', table: 'T08', robot: 'any' });
  const id = last().id, rid = M(id).robot;
  until('collect', atStop(rid, 'collect', 'T08'));
  confirm(rid);
  until('dish', atStop(rid, 'unload', 'dish'));
  confirm(rid);
  assert.strictEqual(M(id).status, 'done');
});

scenario('E-stop: dừng hẳn, trạm không nhả được, chỉ nhả tại robot', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T04'], robot: 'R1' });
  run(2);
  send({ type: 'estop', robot: 'R1' });
  const pos = () => R('R1').x + ',' + R('R1').y, x = pos();
  run(5);
  assert.strictEqual(pos(), x);
  send({ type: 'resume', robot: 'R1' });
  assert.strictEqual(R('R1').halt, 'estop');
  send({ type: 'resume', robot: 'R1', atRobot: true });
  run(2);
  assert.notStrictEqual(pos(), x);
  assert.strictEqual(st.alerts.filter(a => a.key === 'es-R1').length, 0);
});

// Every telemetry point must lie on an open edge of the route network (no driving through tables).
const onRoute = (x, y) => st.map.edges.some(e => {
  if (e.closed) return false;
  const a = st.map.nodes[e.a], b = st.map.nodes[e.b], L = Math.hypot(b.x - a.x, b.y - a.y);
  const u = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (L * L)));
  return Math.hypot(a.x + u * (b.x - a.x) - x, a.y + u * (b.y - a.y) - y) < 0.02;
});
function watch(sec, check) { for (let i = 0; i < sec * 2; i++) { run(0.5); check(); } }

scenario('đi theo lối đi đã thiết kế, không cắt ngang bàn', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T12'], robot: 'R1' });
  watch(40, () => assert(onRoute(R('R1').x, R('R1').y), `R1 off route at ${R('R1').x},${R('R1').y}`));
  assert(R('R1').path.length > 0 || R('R1').phase === 'atStop');
});

scenario('vật cản cố định -> dừng, xin nhường đường, đi vòng', () => {
  send({ type: 'create', kind: 'summon', to: 'T11', robot: 'R1' });
  until('on west corridor', () => R('R1').y > 4 && R('R1').nav === 'go');
  send({ type: 'sim', robot: 'R1', fault: 'block' });
  until('wait', () => R('R1').nav === 'wait');
  assert(events.some(e => e.robotSound === 'excuse'));
  assert.strictEqual(R('R1').halt, null, 'waiting is not yet an alarm');
  until('rerouted', () => st.kpi.reroutes === 1);
  until('T11', atStop('R1', 'standby', 'T11'));
  assert(!st.alerts.some(a => a.key === 'blk-R1'));
});

scenario('người đi ngang -> chờ rồi đi tiếp, không đổi lộ trình', () => {
  send({ type: 'create', kind: 'summon', to: 'T04', robot: 'R1' });
  until('on top aisle', () => R('R1').x > 9 && R('R1').nav === 'go');
  const [, x, y] = [0, R('R1').path[1][0], R('R1').path[1][1]];
  send({ type: 'obstacle', x, y, kind: 'person' });
  until('wait', () => R('R1').nav === 'wait');
  until('T04', atStop('R1', 'standby', 'T04'));
  assert.strictEqual(st.kpi.reroutes, 0);
});

scenario('lối duy nhất bị chặn -> báo nhân viên, dọn lối -> chạy tiếp', () => {
  send({ type: 'create', kind: 'summon', to: 'T01', robot: 'R1' });
  const t = st.map.nodes.T01;
  send({ type: 'obstacle', x: t.x, y: t.y - 0.1, kind: 'object' });   // chair in the table spur: no way around
  until('blocked', () => R('R1').halt === 'blocked', 30);
  assert(st.alerts.some(a => a.key === 'blk-R1'));
  send({ type: 'clear', robot: 'R1' });
  run(1);
  assert.strictEqual(R('R1').halt, null);
  until('T01', atStop('R1', 'standby', 'T01'));
});

scenario('đóng lối đi -> robot tự tìm đường khác; đóng hết -> báo không có lộ trình', () => {
  const map = JSON.parse(JSON.stringify(st.map));
  for (const e of map.edges) if (['jT05', 'jT06'].includes(e.a) && ['jT05', 'jT06'].includes(e.b)) e.closed = true;
  send({ type: 'map', map });
  assert.strictEqual(st.map.v, 2);
  send({ type: 'create', kind: 'summon', to: 'T06', robot: 'R1' });
  watch(30, () => assert(onRoute(R('R1').x, R('R1').y)));
  until('T06', atStop('R1', 'standby', 'T06'));
  for (const e of map.edges) if (e.a === 'jT07' || e.b === 'jT07') e.closed = true;
  send({ type: 'map', map });
  send({ type: 'create', kind: 'summon', to: 'T07', robot: 'R2' });
  until('noroute', () => R('R2').halt === 'blocked');
  assert(st.alerts.some(a => a.key === 'blk-R2' && /không có lộ trình/.test(a.text)));
  send({ type: 'mapReset' });
  until('T07', atStop('R2', 'standby', 'T07'));
});

scenario('lối hẹp chỉ cho 1 robot, robot kia chờ ở đầu lối', () => {
  const narrow = st.map.edges.filter(e => e.narrow);
  const inLane = id => narrow.some(e => {
    const a = st.map.nodes[e.a], b = st.map.nodes[e.b];
    return Math.abs(R(id).x - 16) < 0.01 && R(id).y > Math.min(a.y, b.y) + 0.01 && R(id).y < Math.max(a.y, b.y) - 0.01;
  });
  // Only the narrow cross aisle stays open between the top and the lower aisles.
  const map = JSON.parse(JSON.stringify(st.map));
  for (const e of map.edges) if (['w1', 'e1'].includes(e.a) && ['w2', 'e2'].includes(e.b)) e.closed = true;
  send({ type: 'map', map });
  send({ type: 'create', kind: 'summon', to: 'T10', robot: 'R2' });
  send({ type: 'create', kind: 'summon', to: 'T11', robot: 'R3' });
  let yielded = false;
  watch(60, () => {
    assert(!(inLane('R2') && inLane('R3')), 'two robots in the narrow lane');
    yielded = yielded || R('R2').nav === 'yield' || R('R3').nav === 'yield';
  });
  assert(yielded, 'one robot waited');
  assert(atStop('R2', 'standby', 'T10')() && atStop('R3', 'standby', 'T11')());
});

scenario('khách không nhận -> nhắc, quá giờ mang về', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T05'], robot: 'R1' });
  until('load', atStop('R1', 'load'));
  confirm('R1');
  until('T05', atStop('R1', 'handoff', 'T05'));
  run(site.timing.handoffSec + 1);
  assert(events.some(e => e.robotSound === 'remind'));
  assert.strictEqual(st.kpi.timeout, 1);
  until('return', atStop('R1', 'return', 'kitchen'));
});

scenario('mất kết nối và kết nối lại', () => {
  send({ type: 'sim', robot: 'R3', fault: 'offline' });
  run(4);
  assert.strictEqual(R('R3').offline, true);
  send({ type: 'create', kind: 'summon', to: 'bar', robot: 'R3' });
  run(1);
  assert.strictEqual(last().status, 'queued');
  send({ type: 'sim', robot: 'R3', fault: 'online' });
  run(1);
  assert.strictEqual(R('R3').offline, false);
  assert.strictEqual(last().robot, 'R3');
});

scenario('pin yếu -> không nhận việc, robot khác nhận', () => {
  send({ type: 'sim', robot: 'R1', fault: 'lowbat' });
  run(1);
  assert.strictEqual(R('R1').charging, true);
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'any' });
  assert.notStrictEqual(last().robot, 'R1');
});

scenario('chỉ định robot bận -> chờ, ưu tiên GẤP lên trước', () => {
  send({ type: 'create', kind: 'summon', to: 'bar', robot: 'R2' });
  send({ type: 'create', kind: 'summon', to: 'T01', robot: 'R2' });
  send({ type: 'create', kind: 'summon', to: 'T02', robot: 'R2', urgent: true });
  const [a, b, c] = st.missions;
  assert.strictEqual(b.status, 'queued');
  send({ type: 'cancel', mission: a.id });
  assert.strictEqual(c.status, 'active', 'urgent first');
  assert.strictEqual(b.status, 'queued');
});

scenario('chuyển xử lý thủ công', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T02'], robot: 'R1' });
  const id = last().id;
  run(2);
  send({ type: 'manual', robot: 'R1' });
  assert.strictEqual(M(id).status, 'failed');
  assert.strictEqual(st.kpi.failed, 1);
});

console.log('OK — all scenarios pass');
