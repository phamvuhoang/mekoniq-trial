// Scenario test for orchestrator + simulator with a fake clock: node scripts/test.js
const assert = require('assert');
const O = require('../data/lib/orchestrator'), S = require('../data/lib/simulator'), site = require("../data/site.demo.json");

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

scenario('xong lệnh mà còn lệnh chờ -> đi thẳng, không ghé dock', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'R2' });
  until('load', atStop('R2', 'load'), 60); confirm('R2');
  until('handoff', atStop('R2', 'handoff', 'T01'), 60);
  send({ type: 'create', kind: 'summon', to: 'bar', robot: 'R2' });   // queued: R2 is busy
  const q = last(); assert.strictEqual(q.status, 'queued');
  const r = O.handle(st, site, { source: 'ui', data: { by: 'test', type: 'confirm', robot: 'R2', mission: R('R2').mission, stop: stopOf('R2') && M(R('R2').mission).cur } }, now);
  const gotos = r.cmds.filter(c => c.cmd === 'goto' && c.robot === 'R2');
  assert.deepStrictEqual(gotos.map(c => c.to), ['bar'], 'no detour via the dock: ' + JSON.stringify(gotos));
  assert.strictEqual(R('R2').phase, 'toStop');
  for (const cmd of r.cmds) for (const e of S.handle(sim, site, cmd, now)) pump({ source: 'adapter', data: e });
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


// ---- Live site config (Task 3): save / reset / probe / pos / log; works without site.map ----
{
  const seed = require('../data/site.json');
  const clone = o => JSON.parse(JSON.stringify(o));
  const site2 = clone(site); site2.rev = 5;
  const st2 = O.init(site2, now);
  const H = (d, s = site2) => O.handle(st2, s, { source: 'ui', data: { by: 'test', ...d }, session: 'S1', seed }, now);
  const evText = r => r.ui.filter(u => u.session === 'S1').map(u => JSON.parse(u.payload)).filter(p => p.type === 'event').map(p => p.text);

  let r = H({ type: 'siteSave', site: { ...clone(site2), rev: 4 } });
  assert.ok(evText(r)[0].startsWith('Không lưu: máy khác'), 'rev mismatch refused');
  assert.strictEqual(r.site, undefined);

  H({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'R1' });
  const noT01 = clone(site2); delete noT01.points.T01;
  r = H({ type: 'siteSave', site: noT01 });
  assert.ok(evText(r)[0].includes('đang có lệnh'), 'deleting a point in use refused');
  const noR1 = clone(site2); noR1.robots = noR1.robots.filter(x => x.id !== 'R1');
  assert.ok(evText(H({ type: 'siteSave', site: noR1, seed }))[0].includes('đang có lệnh'), 'deleting a busy robot refused');

  const withT13 = clone(site2); withT13.points.T13 = { name: 'Bàn 13', kind: 'table' };
  r = H({ type: 'siteSave', site: withT13 });
  assert.deepStrictEqual(evText(r), []);
  assert.strictEqual(r.site.rev, 6);
  assert.ok(r.ui.some(u => !u.session && JSON.parse(u.payload).type === 'site'), 'site broadcast');
  const live = r.site;
  r = H({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T13'], robot: 'R2' }, live);
  const go = r.cmds.find(c => c.cmd === 'goto' && c.robot === 'R2');
  assert.ok(go && go.to === 'kitchen');
  // advance R2 to kitchen by faking arrival, then it must head to T13 (no route node) without throwing
  O.handle(st2, live, { source: 'adapter', data: { event: 'arrived', robot: 'R2', token: st2.robots.R2.token } }, now);
  const m2 = st2.missions.find(m => m.robot === 'R2');
  r = H({ type: 'confirm', robot: 'R2', mission: m2.id, stop: 0 }, live);
  const go13 = r.cmds.find(c => c.cmd === 'goto' && c.to === 'T13');
  assert.deepStrictEqual([go13.x, go13.y], [0, 0]);

  r = H({ type: 'siteReset' }, live);
  assert.ok(evText(r)[0].includes('đang có lệnh'), 'reset refused while missions run');
  H({ type: 'reset' }, live);   // demo reset clears all missions
  r = H({ type: 'siteReset' }, live);
  assert.strictEqual(r.site.rev, 7);
  assert.strictEqual(Object.values(r.site.points).filter(p => p.kind === 'table').length, 0);
  console.log('✓ siteSave / siteReset / point without route node');

  // probe only when idle and free
  const st3 = O.init(site2, now);
  const H3 = d => O.handle(st3, site2, { source: 'ui', data: { by: 'test', ...d } }, now);
  assert.deepStrictEqual(H3({ type: 'probe', robot: 'R1', x: 100, y: 200 }).cmds, [{ cmd: 'probe', robot: 'R1', x: 100, y: 200 }]);
  H3({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'R1' });
  assert.deepStrictEqual(H3({ type: 'probe', robot: 'R1', x: 100, y: 200 }).cmds, []);
  // pos passthrough + log event
  O.handle(st3, site2, { source: 'adapter', data: { event: 'telemetry', robots: [{ id: 'R2', x: 1, y: 1, battery: 90, moving: false, blocked: false, nav: 'idle', pos: { x: 1, y: 2, angle: 90 } }] } }, now);
  assert.deepStrictEqual(st3.robots.R2.pos, { x: 1, y: 2, angle: 90 });
  const snap = JSON.parse(O.handle(st3, site2, { source: 'ui', data: { type: 'hello' }, session: 'S' }, now).ui.find(u => JSON.parse(u.payload).type === 'state').payload);
  assert.deepStrictEqual(snap.robots.find(x => x.id === 'R2').pos, { x: 1, y: 2, angle: 90 });
  O.handle(st3, site2, { source: 'adapter', data: { event: 'log', robot: 'R1', text: 'hello' } }, now);
  assert.strictEqual(st3.log[0].text, 'hello');
  console.log('✓ probe / pos / log');

  // seed site: no map, no floor, dock without x,y
  const st4 = O.init(seed, now);
  assert.strictEqual(st4.robots.R1.x, 0);
  assert.deepStrictEqual(st4.map.nodes, {});
  O.handle(st4, seed, { source: 'ui', data: { type: 'hello' }, session: 'S' }, now);
  // robots gone from site (no mission) are dropped
  const seed2 = clone(seed); seed2.robots = [];
  O.handle(st4, seed2, { source: 'ui', data: { type: 'hello' }, session: 'S' }, now);
  assert.deepStrictEqual(Object.keys(st4.robots), []);
  // valetudo robot nearest-by-cm assignment: only robots taught the point may take it
  const two = clone(seed); two.points.T01 = { name: 'Bàn 01', kind: 'table' };
  two.robots = [{ id: 'R1', dock: 'D1', driver: 'valetudo', valetudo: { topic: 'a', points: { kitchen: { x: 100, y: 100 }, T01: { x: 500, y: 500 } } } },
                { id: 'R2', dock: 'D1', driver: 'valetudo', valetudo: { topic: 'b', points: { kitchen: { x: 100, y: 100 } } } }];
  const st5 = O.init(two, now);
  const tel = id => ({ id, x: 0, y: 0, battery: 90, moving: false, blocked: false, nav: 'idle', pos: { x: id === 'R1' ? 2000 : 110, y: 100, angle: 0 } });
  O.handle(st5, two, { source: 'adapter', data: { event: 'telemetry', robots: [tel('R1'), tel('R2')] } }, now);
  O.handle(st5, two, { source: 'ui', data: { by: 't', type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'any' } }, now);
  assert.strictEqual(st5.missions[0].robot, 'R1', 'R2 is nearer but was never taught T01');
  // review fix 2: a table no robot was taught still gets a robot, which then reports noroute (alert) — never waits silently
  const one = clone(seed); one.points.T01 = { name: 'Bàn 01', kind: 'table' };
  one.robots[0].valetudo = { topic: 'a', points: { kitchen: { x: 1, y: 1 } } };
  const st6 = O.init(one, now);
  O.handle(st6, one, { source: 'adapter', data: { event: 'telemetry', robots: [tel('R1')] } }, now);
  const r6 = O.handle(st6, one, { source: 'ui', data: { by: 't', type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'any' } }, now);
  assert.strictEqual(st6.missions[0].robot, 'R1');
  assert.ok(r6.cmds.some(c => c.cmd === 'goto' && c.robot === 'R1'));
  console.log('✓ seed site / robots removed / nearest-by-cm assignment');
}

// ---- Task 4: points without a route node are Valetudo-only ----
{
  const RT = require('../data/lib/route');
  const seed = require('../data/site.json');
  const s13 = JSON.parse(JSON.stringify(site)); s13.points.T13 = { name: 'Bàn 13', kind: 'table' };
  const cleaned = RT.clean({ nodes: site.map.nodes, edges: site.map.edges }, s13);
  assert.ok(cleaned && cleaned.nodes.T01, 'clean keeps working with a node-less point');
  assert.ok(!RT.unreachable(site.map, s13).includes('T13'));
  assert.deepStrictEqual(S.init(seed).robots, {});
  assert.deepStrictEqual(Object.keys(S.init(site).robots), ['R1', 'R2', 'R3']);
  console.log('✓ route/simulator ignore points without a node');
}

{
  pump({ source: 'adapter', data: { event: 'alert', key: 'mqtt-down', level: 'error', text: 'Broker MQTT trong máy không chạy' } });
  let a = st.alerts.find(a => a.key === 'mqtt-down');
  assert.ok(a && a.level === 'error' && a.robot === undefined && a.text === 'Broker MQTT trong máy không chạy');
  pump({ source: 'adapter', data: { event: 'alert', key: 'mqtt-down', level: 'error', text: 'again' } });
  assert.strictEqual(st.alerts.filter(a => a.key === 'mqtt-down').length, 1);           // dedup by key
  pump({ source: 'adapter', data: { event: 'alert', key: 'ip-changed', level: 'bogus', text: 'x'.repeat(300) } });
  a = st.alerts.find(a => a.key === 'ip-changed'); assert.strictEqual(a.level, 'warn'); assert.strictEqual(a.text.length, 200);
  pump({ source: 'adapter', data: { event: 'alert', text: 'no key' } });                 // ignored
  pump({ source: 'adapter', data: { event: 'alert', key: 'k2', text: 42 } });            // coerced
  assert.strictEqual(st.alerts.find(a => a.key === 'k2').text, '42');
  pump({ source: 'adapter', data: { event: 'resolve', key: 'mqtt-down' } });
  assert.ok(!st.alerts.some(a => a.key === 'mqtt-down'));
  send({ type: 'ack', alert: st.alerts.find(a => a.key === 'ip-changed').id });
  assert.ok(!st.alerts.some(a => a.key === 'ip-changed'));
  pump({ source: 'adapter', data: { event: 'resolve', key: 'k2' } });
  console.log('✓ adapter alert / resolve events');
}

// ---- Phase 2 Task 1: call staff / bill / paid ----
scenario('khách gọi nhân viên: 1 cảnh báo tới khi Đã biết, rồi gọi lại được', () => {
  const calls = () => st.alerts.filter(a => a.key === 'call-staff-T05');
  send({ type: 'call', point: 'T05', what: 'staff', by: 'Khách Bàn 05 (QR)' });
  assert.strictEqual(calls().length, 1);
  assert.strictEqual(calls()[0].text, 'Bàn 05 gọi nhân viên');
  assert.ok(events.some(e => e.stationSound === 'ding' && e.point === undefined), 'every station hears it');
  events = [];
  for (let i = 0; i < 9; i++) send({ type: 'call', point: 'T05', what: 'staff' });
  assert.strictEqual(calls().length, 1, 'ten taps, one alert');
  assert.ok(!events.some(e => e.stationSound), 'no extra ding while the alert is open');
  send({ type: 'ack', alert: calls()[0].id });
  send({ type: 'call', point: 'T05', what: 'staff' });
  assert.strictEqual(calls().length, 1, 'new alert after ack');
  send({ type: 'call', point: 'T05', what: 'bill' });
  assert.ok(st.alerts.some(a => a.key === 'call-bill-T05' && a.text === 'Bàn 05 xin hoá đơn'));
  send({ type: 'call', point: 'T05', what: 'paid', amount: '120.000đ' });
  assert.ok(st.alerts.some(a => a.key === 'call-paid-T05' && a.text === 'Bàn 05 báo đã chuyển khoản · 120.000đ'));
  const n = st.alerts.length;
  send({ type: 'call', point: 'kitchen', what: 'staff' });   // not a table
  send({ type: 'call', point: 'T05', what: 'beer' });
  assert.strictEqual(st.alerts.length, n, 'invalid point / what ignored');
});

{
  const off = JSON.parse(JSON.stringify(site)); off.features = { ...off.features, call: false };
  const st7 = O.init(off, now);
  O.handle(st7, off, { source: 'ui', data: { by: 'QR', type: 'call', point: 'T05', what: 'staff' } }, now);
  assert.strictEqual(st7.alerts.length, 0, 'feature off: no alert');
  assert.strictEqual(st7.log[0].level, 'warn');
  const none = JSON.parse(JSON.stringify(site)); delete none.features;
  const st8 = O.init(none, now);
  O.handle(st8, none, { source: 'ui', data: { by: 'QR', type: 'call', point: 'T05', what: 'staff' } }, now);
  assert.strictEqual(st8.alerts.length, 0, 'no features block = all off');
  console.log('✓ call refused when features.call is off');
}

// ---- Phase 2 Task 2: retarget a delivery while the robot is on its way ----
scenario('đổi bàn khi robot đang đi: tới bàn mới, không về bếp', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T05', 'T07'], robot: 'R1' });
  const id = last().id;
  until('load', atStop('R1', 'load', 'kitchen'));
  confirm('R1');
  run(1);
  assert.strictEqual(R('R1').target, 'T05');
  const H = d => O.handle(st, site, { source: 'ui', data: { by: 'Bếp', type: 'retarget', mission: id, ...d }, session: 'S' }, now);
  const reply = r => r.ui.filter(u => u.session === 'S').map(u => JSON.parse(u.payload).text);
  assert.deepStrictEqual(reply(H({ stop: 1, to: 'T07' })), ['Không đổi được: bàn đã có trong chuyến']);
  assert.strictEqual(M(id).stops[1].p, 'T05');
  H({ stop: 2, to: 'T09' });   // pending second stop: only the stop changes
  assert.strictEqual(M(id).stops[2].p, 'T09');
  assert.strictEqual(R('R1').target, 'T05');
  const staff = st.kpi.cancelledStaff;
  events = [];
  send({ type: 'retarget', mission: id, stop: 1, to: 'T03' });
  assert.strictEqual(R('R1').target, 'T03');
  assert.strictEqual(M(id).label, `#${id} Giao Bếp → Bàn 03, 09`);
  assert.strictEqual(st.kpi.cancelledStaff, staff);
  assert.ok(events.some(e => e.table === 'T05') && events.some(e => e.table === 'T03'));
  assert.ok(!events.some(e => e.robotSound || e.stationSound), 'no sounds');
  until('T03', atStop('R1', 'handoff', 'T03'));
  assert.deepStrictEqual(reply(H({ stop: 1, to: 'T08' })), ['Không đổi được: robot đã tới bàn']);
  assert.strictEqual(M(id).stops[1].p, 'T03');
  confirm('R1');
  until('T09', atStop('R1', 'handoff', 'T09'));
});

// ---- Phase 2 Task 5: bus a table from the robot standby screen ----
scenario('robot chờ ở bếp -> thu dọn Bàn 05 từ màn robot', () => {
  send({ type: 'create', kind: 'summon', to: 'kitchen', robot: 'R3' });
  const id = last().id;
  until('standby', atStop('R3', 'standby', 'kitchen'));
  send({ type: 'dispatch', robot: 'R3', mission: id, tables: ['T05', 'T07'], bus: true });   // one table only
  assert.strictEqual(R('R3').phase, 'atStop');
  send({ type: 'dispatch', robot: 'R3', mission: id, tables: ['dish'], bus: true });          // not a table
  assert.strictEqual(R('R3').phase, 'atStop');
  send({ type: 'dispatch', robot: 'R3', mission: id, tables: ['T05'], bus: true });
  assert.strictEqual(R('R3').phase, 'toStop');
  assert.strictEqual(R('R3').target, 'T05');
  assert.strictEqual(M(id).kind, 'bus');
  assert.strictEqual(M(id).label, `#${id} Thu dọn Bàn 05`);
  assert.ok(st.log.some(l => l.text === `test giao việc cho R3: #${id} Thu dọn Bàn 05`));
  until('collect', atStop('R3', 'collect', 'T05'));
  confirm('R3');
  until('dish', atStop('R3', 'unload', 'dish'));
  confirm('R3');
  assert.strictEqual(M(id).status, 'done');
});

scenario('thu dọn từ màn robot bị từ chối khi robot chờ ở bàn', () => {
  send({ type: 'create', kind: 'summon', to: 'T02', robot: 'R3' });
  const id = last().id;
  until('standby', atStop('R3', 'standby', 'T02'));
  send({ type: 'dispatch', robot: 'R3', mission: id, tables: ['T05'], bus: true });
  assert.strictEqual(R('R3').phase, 'atStop');
  assert.strictEqual(M(id).kind, 'summon');
});

// ---- Phase 2 Task 6: guide guests to a table + slow mode ----
scenario('dẫn khách từ bếp tới Bàn 07, đi chậm, khách xác nhận', () => {
  send({ type: 'create', kind: 'guide', to: 'T07', robot: 'R1' });   // idle at the dock: refused
  assert.strictEqual(st.missions.length, 0);
  send({ type: 'create', kind: 'summon', to: 'kitchen', robot: 'R1' });
  const sid = last().id;
  until('standby', atStop('R1', 'standby', 'kitchen'));
  send({ type: 'create', kind: 'guide', to: 'kitchen', robot: 'R1' });   // not a table
  send({ type: 'create', kind: 'guide', to: 'T07', robot: 'any' });      // only from a robot screen
  assert.strictEqual(st.missions.length, 1);
  send({ type: 'create', kind: 'guide', to: 'T07', robot: 'R1', by: 'Khách' });
  assert.strictEqual(M(sid).status, 'done', 'standby handed over');
  const g = last();
  assert.deepStrictEqual([g.kind, g.status, g.robot, R('R1').mission, R('R1').target], ['guide', 'active', 'R1', g.id, 'T07']);
  assert.strictEqual(g.label, `#${g.id} Dẫn khách tới Bàn 07`);
  // slow mode: one cmd per change, the simulator drives at half speed
  const H = d => O.handle(st, site, { source: 'ui', data: { by: 'Khách', type: 'speed', robot: 'R1', ...d } }, now);
  run(1);
  let r = H({ slow: true });
  assert.deepStrictEqual(r.cmds, [{ cmd: 'speed', robot: 'R1', factor: 0.5 }]);
  for (const cmd of r.cmds) S.handle(sim, site, cmd, now);
  assert.strictEqual(R('R1').slow, true);
  assert.deepStrictEqual(H({ slow: true }).cmds, [], 'no change, no cmd');
  const rem0 = R('R1').rem; run(2);
  const slowStep = rem0 - R('R1').rem;
  assert.ok(slowStep > 0 && slowStep <= site.sim.speed * 2 * 0.5 + 0.01, `half speed: moved ${slowStep}`);
  r = H({ slow: false });
  assert.deepStrictEqual(r.cmds, [{ cmd: 'speed', robot: 'R1', factor: 1 }]);
  for (const cmd of r.cmds) S.handle(sim, site, cmd, now);
  until('T07', atStop('R1', 'guide', 'T07'));
  confirm('R1');
  assert.strictEqual(M(g.id).status, 'done');
  assert.strictEqual(st.kpi.guides, 1);
  until('dock', () => R('R1').phase === 'idle' && R('R1').at === 'D1');
  assert.deepStrictEqual(O.handle(st, site, { source: 'ui', data: { type: 'speed', robot: 'R1', slow: true } }, now).cmds, [], 'no mission: speed ignored');
});

scenario('dẫn khách: không ai xác nhận -> nhắc, quá giờ robot tự về, không tính timeout giao món', () => {
  send({ type: 'create', kind: 'summon', to: 'bar', robot: 'R2' });
  until('standby', atStop('R2', 'standby', 'bar'));
  send({ type: 'create', kind: 'guide', to: 'T01', robot: 'R2' });
  const g = last();
  pump({ source: 'ui', data: { type: 'speed', robot: 'R2', slow: true } });
  until('T01', atStop('R2', 'guide', 'T01'));
  run(site.timing.handoffSec + 1);
  assert.ok(events.some(e => e.robotSound === 'remind' && e.robot === 'R2'));
  assert.strictEqual(M(g.id).status, 'timeout');
  assert.strictEqual(st.kpi.timeout, 0);
  assert.strictEqual(R('R2').slow, false, 'slow mode ends with the mission');
  assert.strictEqual(sim.robots.R2.factor, 1);
  assert.strictEqual(R('R2').phase, 'toDock');
});

{
  const off = JSON.parse(JSON.stringify(site)); off.features.guide = false;
  const st9 = O.init(off, now);
  st9.robots.R1.phase = 'atStop'; st9.robots.R1.at = 'kitchen';
  O.handle(st9, off, { source: 'ui', data: { by: 't', type: 'create', kind: 'summon', to: 'kitchen', robot: 'R1' } }, now);
  st9.robots.R1.phase = 'atStop';
  O.handle(st9, off, { source: 'ui', data: { by: 't', type: 'create', kind: 'guide', to: 'T07', robot: 'R1' } }, now);
  assert.ok(!st9.missions.some(m => m.kind === 'guide'), 'feature off: no guide');
  console.log('✓ guide refused when features.guide is off');
}

// ---- Phase 2 Task 7: order food on the robot ----
scenario('gọi món 2 danh mục -> mỗi trạm một cảnh báo, chỉ món của trạm đó', () => {
  events = [];
  send({ type: 'order', table: 'T05', items: [{ id: 'pho', qty: 2 }, { id: 'trada', qty: 2 }, { id: 'goicuon', qty: 1 }], by: 'Khách Bàn 05' });
  assert.strictEqual(st.orders.length, 1);
  const o = st.orders[0];
  assert.deepStrictEqual([o.table, o.total, o.status], ['T05', 2 * 65000 + 2 * 5000 + 45000, 'new']);
  assert.deepStrictEqual(o.items, [{ id: 'pho', qty: 2, price: 65000 }, { id: 'trada', qty: 2, price: 5000 }, { id: 'goicuon', qty: 1, price: 45000 }]);
  const k = st.alerts.find(a => a.key === `order-${o.id}-kitchen`), b = st.alerts.find(a => a.key === `order-${o.id}-bar`);
  assert.strictEqual(k.text, 'Bàn 05 gọi món: Phở bò ×2, Gỏi cuốn ×1 · 175.000đ');
  assert.strictEqual(b.text, 'Bàn 05 gọi món: Trà đá ×2 · 10.000đ');
  assert.deepStrictEqual(events.filter(e => e.stationSound === 'ding').map(e => e.point).sort(), ['bar', 'kitchen']);
  const snap = JSON.parse(O.handle(st, site, { source: 'ui', data: { type: 'hello' }, session: 'S' }, now).ui.find(u => JSON.parse(u.payload).type === 'state').payload);
  assert.strictEqual(snap.orders.length, 1);
  for (const bad of [[{ id: 'nope', qty: 1 }], [{ id: 'pho', qty: 0 }], [{ id: 'pho', qty: 21 }], [], 'pho'])
    send({ type: 'order', table: 'T05', items: bad });
  send({ type: 'order', table: 'kitchen', items: [{ id: 'pho', qty: 1 }] });
  assert.strictEqual(st.orders.length, 1, 'invalid orders ignored');
  now += 24 * 3600 * 1000 + 1000;
  run(1);
  assert.strictEqual(st.orders.length, 0, 'dropped after 24 h');
});

{
  const off = JSON.parse(JSON.stringify(site)); off.features.order = false;
  const st10 = O.init(off, now);
  O.handle(st10, off, { source: 'ui', data: { by: 'Khách', type: 'order', table: 'T05', items: [{ id: 'pho', qty: 1 }] } }, now);
  assert.deepStrictEqual([st10.orders.length, st10.alerts.length, st10.log[0].level], [0, 0, 'warn']);
  console.log('✓ order refused when features.order is off');
}

// ---- Phase 2 Task 8: pay on the robot ----
scenario('khách báo đã chuyển khoản -> đơn của bàn chuyển paid-claimed, cảnh báo kèm số tiền', () => {
  send({ type: 'order', table: 'T07', items: [{ id: 'pho', qty: 1 }, { id: 'cafe', qty: 2 }] });
  send({ type: 'order', table: 'T08', items: [{ id: 'bia', qty: 1 }] });
  send({ type: 'call', point: 'T07', what: 'paid', amount: 65000 + 2 * 29000 });
  assert.deepStrictEqual(st.orders.map(o => [o.table, o.status]), [['T07', 'paid-claimed'], ['T08', 'new']]);
  assert.ok(st.alerts.some(a => a.key === 'call-paid-T07' && a.text === 'Bàn 07 báo đã chuyển khoản · 123.000đ'));
  send({ type: 'call', point: 'T03', what: 'paid' });   // nothing ordered on the robot: still tell staff
  assert.ok(st.alerts.some(a => a.key === 'call-paid-T03' && a.text === 'Bàn 03 báo đã chuyển khoản'));
  assert.deepStrictEqual(st.orders.map(o => o.status), ['paid-claimed', 'new']);
});

// ---- Final review fixes ----
scenario('review: cảnh báo khách không đẩy mất cảnh báo dừng khẩn cấp', () => {
  send({ type: 'estop', robot: 'R1' });
  for (let i = 0; i < 25; i++) send({ type: 'order', table: 'T05', items: [{ id: 'pho', qty: 1 }, { id: 'trada', qty: 1 }] });
  assert.ok(st.alerts.some(a => a.key === 'es-R1'), 'e-stop alert kept');
  assert.ok(st.alerts.length <= 20);
});

scenario('review: Đã biết hoá đơn / chuyển khoản -> đóng đơn của bàn', () => {
  send({ type: 'order', table: 'T05', items: [{ id: 'pho', qty: 1 }] });
  send({ type: 'order', table: 'T06', items: [{ id: 'pho', qty: 1 }] });
  send({ type: 'call', point: 'T05', what: 'bill' });
  send({ type: 'ack', alert: st.alerts.find(a => a.key === 'call-bill-T05').id });
  assert.deepStrictEqual(st.orders.map(o => o.table), ['T06'], 'T05 closed, next party starts clean');
  send({ type: 'call', point: 'T06', what: 'paid', amount: 65000 });
  send({ type: 'ack', alert: st.alerts.find(a => a.key === 'call-paid-T06').id });
  assert.deepStrictEqual(st.orders, []);
});

scenario('review: khách huỷ món sau khi bếp đã đổi bàn -> không huỷ nhầm bàn mới', () => {
  send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T05'], robot: 'R1' });
  const id = last().id;
  send({ type: 'retarget', mission: id, stop: 1, to: 'T07' });
  send({ type: 'cancelStop', mission: id, stop: 1, why: 'customer', table: 'T05' });
  assert.strictEqual(M(id).stops[1].status, 'pending');
  send({ type: 'cancelStop', mission: id, stop: 1, why: 'customer', table: 'T07' });
  assert.strictEqual(M(id).status, 'cancelled');
});

console.log('OK — all scenarios pass');
