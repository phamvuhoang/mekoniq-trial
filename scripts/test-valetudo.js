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
  assert.strictEqual(H({ cmd: 'goto', robot: 'R1', to: 'D1', x: 7.5, y: 1.2, token: 3 }).mqtt[0].payload, 'HOME');
  assert.strictEqual(H({ cmd: 'tick' }).events[0].robots[0].blocked, false);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'lost' });
  assert.deepStrictEqual(H({ cmd: 'tick' }).events[0].robots, []);
  assert.deepStrictEqual(H({ cmd: 'map', map: {}, v: 2 }), { events: [], mqtt: [] });       // ignored
  console.log('✓ ingest / telemetry / publishes');
}
