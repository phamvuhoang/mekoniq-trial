// Unit tests for the Valetudo MQTT adapter (lib/valetudo.js) with a fake clock: node scripts/test-valetudo.js
const assert = require('assert');
const V = require('../data/lib/valetudo');

// robot cm = site m * 100, rotated 90° (x_r = y_m*100, y_r = -x_m*100), shifted by (1000, 3000)
const pairs = [{ site: { x: 3, y: 11.5 }, robot: { x: 1000 + 1150, y: 3000 - 300 } },
               { site: { x: 11.5, y: 4.5 }, robot: { x: 1000 + 450, y: 3000 - 1150 } }];
const T = V.fit(pairs);
assert.deepStrictEqual(V.toSite(T, { x: 1000 + 800, y: 3000 - 1450 }), { x: 14.5, y: 8 });
assert.strictEqual(V.fit(pairs.slice(0, 1)), null);
console.log('✓ fit/toSite');

const SITE = {
  points: { kitchen: { x: 3, y: 11.5 }, T01: { x: 11.5, y: 4.5 }, T06: { x: 14.5, y: 8 }, D1: { x: 7.5, y: 1.2 } },
  robots: [{ id: 'R1', dock: 'D1', driver: 'valetudo', valetudo: { topic: 'valetudo/Bot' } }, { id: 'R2', dock: 'D1' }],
  valetudo: { points: { kitchen: { x: 2150, y: 2700 }, T01: { x: 1450, y: 1850 } } },
};
{
  const st = V.init(SITE); let now = 1e12;
  const H = (i) => V.handle(st, SITE, i, now);
  assert.deepStrictEqual(Object.keys(st.robots), ['R1']);                        // R2 is not ours
  assert.deepStrictEqual(H({ cmd: 'tick' }).events, [{ event: 'telemetry', robots: [] }]);   // nothing heard yet -> absent
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '87' });
  let t = H({ cmd: 'tick' }).events[0].robots[0];
  assert.deepStrictEqual(t, { id: 'R1', x: 7.5, y: 1.2, battery: 87, moving: false, blocked: false, nav: 'idle', why: null, path: [], rem: 0 }); // no position yet -> dock
  let r = H({ cmd: 'goto', robot: 'R1', to: 'kitchen', x: 3, y: 11.5, token: 1 });
  assert.deepStrictEqual(r.mqtt, [{ topic: 'valetudo/Bot/GoToLocationCapability/go/set', payload: '{"coordinates":{"x":2150,"y":2700}}' }]);
  assert.strictEqual(H({ cmd: 'tick' }).events[0].robots[0].nav, 'moving');
  assert.deepStrictEqual(H({ cmd: 'stop', robot: 'R1' }).mqtt, [{ topic: 'valetudo/Bot/BasicControlCapability/operation/set', payload: 'STOP' }]);
  now += 2000;
  assert.strictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt[0].payload, '{"coordinates":{"x":2150,"y":2700}}');   // resend goal
  r = H({ cmd: 'goto', robot: 'R1', to: 'T06', x: 14.5, y: 8, token: 2 });                 // not calibrated
  assert.deepStrictEqual(r.mqtt, []);
  t = H({ cmd: 'tick' }).events[0].robots[0];
  assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'noroute');
  now += 2000;
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'idle' });   // left the dock
  assert.strictEqual(H({ cmd: 'goto', robot: 'R1', to: 'D1', x: 7.5, y: 1.2, token: 3 }).mqtt[0].payload, 'HOME');
  assert.strictEqual(H({ cmd: 'tick' }).events[0].robots[0].blocked, false);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'lost' });
  assert.deepStrictEqual(H({ cmd: 'tick' }).events[0].robots, []);
  assert.deepStrictEqual(H({ cmd: 'map', map: {}, v: 2 }), { events: [], mqtt: [] });       // ignored
  console.log('✓ ingest / telemetry / publishes');
}

// Trip end / blocked / redirect. Position is set on the state directly (map-data parsing is tested below).
{
  const GO = 'valetudo/Bot/GoToLocationCapability/go/set', OP = 'valetudo/Bot/BasicControlCapability/operation/set';
  const KITCHEN = '{"coordinates":{"x":2150,"y":2700}}', T01 = '{"coordinates":{"x":1450,"y":1850}}';
  let st, now;
  const H = (i) => V.handle(st, SITE, i, now);
  const status = (s) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: s });
  const goto = (to, token) => H({ cmd: 'goto', robot: 'R1', to, x: 0, y: 0, token });
  const tel = () => H({ cmd: 'tick' }).events[0].robots[0];
  const pos = (x, y) => { st.robots.R1.pos = { x, y }; };
  const fresh = () => {
    st = V.init(SITE); now = 1e12;
    H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
    status('docked');
    H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '90' });
  };

  // a) normal trip: idle after moving, near target -> arrived with token
  fresh();
  assert.deepStrictEqual(goto('kitchen', 1).mqtt, [{ topic: GO, payload: KITCHEN }]);
  assert.deepStrictEqual(status('moving').events, []);
  now += 3000; pos(2160, 2690);
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 1 }]);
  assert.strictEqual(st.robots.R1.goal, null);
  let t = tel(); assert.strictEqual(t.moving, false); assert.strictEqual(t.blocked, false);
  // position shown in site metres
  assert.deepStrictEqual([t.x, t.y], [3.1, 11.6]);

  // b) stale idle within 1.5 s is ignored
  goto('T01', 2); now += 500;
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [] });
  assert.strictEqual(tel().nav, 'moving');

  // c) stops far away -> blocked 'object'; resume resends go/set; later arrives
  now += 3000; pos(3000, 3000);
  assert.deepStrictEqual(status('idle').events, []);
  t = tel(); assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'object');
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt, [{ topic: GO, payload: T01 }]);
  assert.strictEqual(tel().blocked, false);
  status('moving'); now += 3000; pos(1455, 1850);
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 2 }]);
  assert.strictEqual(tel().blocked, false);

  // d) error_description != 'No error' -> blocked 'object'; back to 'No error' -> cleared
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/error_description', payload: 'Wheel stuck' });
  t = tel(); assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'object');
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/error_description', payload: 'No error' });
  assert.strictEqual(tel().blocked, false);

  // e) HOME: returning -> docked = arrived, no position check
  assert.deepStrictEqual(goto('D1', 3).mqtt, [{ topic: OP, payload: 'HOME' }]);
  status('returning'); now += 3000;
  assert.deepStrictEqual(status('docked').events, [{ event: 'arrived', robot: 'R1', token: 3 }]);
  // already docked -> arrived at once, nothing published
  assert.deepStrictEqual(goto('D1', 30), { events: [{ event: 'arrived', robot: 'R1', token: 30 }], mqtt: [] });

  // f) already standing at the target -> arrived immediately, no publish
  fresh(); pos(2150, 2700); status('idle');
  assert.deepStrictEqual(goto('kitchen', 4), { events: [{ event: 'arrived', robot: 'R1', token: 4 }], mqtt: [] });

  // g) redirect while moving: STOP, then the new goal once idle; no 'arrived' from that idle
  fresh(); goto('T01', 5); now += 2000; status('moving');
  assert.deepStrictEqual(goto('kitchen', 6).mqtt, [{ topic: OP, payload: 'STOP' }]);
  now += 1000;
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [{ topic: GO, payload: KITCHEN }] });
  status('moving'); now += 3000;
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 6 }]);   // no pos -> trust status

  // h) redirect timeout: no idle within 3 s -> send anyway on tick
  fresh(); goto('T01', 5); now += 2000; status('moving');
  goto('kitchen', 6); now += 1000;
  assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, []);
  now += 2000;
  assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, [{ topic: GO, payload: KITCHEN }]);

  // i) second goto while waiting replaces the goal, no extra STOP
  fresh(); goto('kitchen', 5); now += 2000; status('moving');
  goto('kitchen', 6);
  assert.deepStrictEqual(goto('T01', 7).mqtt, []);
  assert.deepStrictEqual(status('idle').mqtt, [{ topic: GO, payload: T01 }]);
  // pause while waiting: nothing is sent on idle, resume sends the latest goal
  fresh(); goto('kitchen', 5); now += 2000; status('moving'); goto('T01', 6);
  assert.deepStrictEqual(H({ cmd: 'stop', robot: 'R1' }).mqtt, [{ topic: OP, payload: 'STOP' }]);
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [] });
  now += 5000; assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, []);
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt, [{ topic: GO, payload: T01 }]);

  // j) no position at all: moving -> idle after 3 s -> arrived (trust status)
  fresh(); goto('T01', 8); status('moving'); now += 3000;
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 8 }]);
  // status 'error' mid-trip -> blocked, never 'arrived'
  goto('kitchen', 9); now += 3000;
  assert.deepStrictEqual(status('error').events, []);
  assert.strictEqual(tel().why, 'object');
  console.log('✓ trip end / blocked / redirect');
}

{
  const zlib = require('zlib');
  const map = { entities: [{ type: 'charger_location', points: [1, 2] }, { type: 'robot_position', points: [1455, 1848], metaData: { angle: 90 } }] };
  assert.deepStrictEqual(V.parseMap(zlib.deflateSync(JSON.stringify(map))), { x: 1455, y: 1848, angle: 90 });
  assert.strictEqual(V.parseMap(Buffer.from('not zlib')), null);
  assert.strictEqual(V.parseMap(zlib.deflateSync('{"entities":[]}')), null);
  assert.strictEqual(V.parseMap(zlib.deflateSync('not json')), null);
  // through handle: pos updated, bad payload keeps the old pos
  const st = V.init(SITE), topic = 'valetudo/Bot/MapData/map-data';
  V.handle(st, SITE, { cmd: 'mqtt', topic, payload: zlib.deflateSync(JSON.stringify(map)) }, 0);
  assert.deepStrictEqual(st.robots.R1.pos, { x: 1455, y: 1848, angle: 90 });
  V.handle(st, SITE, { cmd: 'mqtt', topic, payload: Buffer.from('garbage') }, 0);
  assert.deepStrictEqual(st.robots.R1.pos, { x: 1455, y: 1848, angle: 90 });
  console.log('✓ map-data position');
}

{
  const S = require('../data/lib/simulator');
  assert.deepStrictEqual(Object.keys(S.init({ ...SITE, map: { nodes: { D1: { x: 7.5, y: 1.2 } }, edges: [] } }).robots), ['R2']);
  // state saved before R1 moved to Valetudo (flow context survives restarts) -> R1 dropped on the next input
  const SIM = { ...SITE, map: { nodes: { D1: { x: 7.5, y: 1.2 } }, edges: [] }, sim: { drainIdle: 0, charge: 0 } };
  const old = S.init({ ...SIM, robots: [{ id: 'R1', dock: 'D1' }, { id: 'R2', dock: 'D1' }] });
  assert.deepStrictEqual(S.handle(old, SIM, { cmd: 'tick' }, 1e12)[0].robots.map(r => r.id), ['R2']);
  console.log('✓ simulator ignores valetudo robots');
  // Valetudo state saved with another topic (placeholder -> real identifier) -> rebuilt
  const val = V.init(SITE), SITE2 = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { topic: 'valetudo/Real' } }] };
  V.handle(val, SITE2, { cmd: 'mqtt', topic: 'valetudo/Real/$state', payload: 'ready' }, 0);
  assert.strictEqual(val.robots.R1.online, true);
  console.log('✓ valetudo state rebuilt when site.json changes');
}
