// Unit tests for the Valetudo MQTT adapter (lib/valetudo.js) with a fake clock: node scripts/test-valetudo.js
const assert = require('assert');
const V = require('../data/lib/valetudo');
// handle() results compared exactly: drop the adapter's human-readable log events first
const noLog = r => ({ ...r, events: r.events.filter(e => e.event !== 'log') });

// robot cm = site m * 100, rotated 90° (x_r = y_m*100, y_r = -x_m*100), shifted by (1000, 3000)
const pairs = [{ site: { x: 3, y: 11.5 }, robot: { x: 1000 + 1150, y: 3000 - 300 } },
               { site: { x: 11.5, y: 4.5 }, robot: { x: 1000 + 450, y: 3000 - 1150 } }];
const T = V.fit(pairs);
assert.deepStrictEqual(V.toSite(T, { x: 1000 + 800, y: 3000 - 1450 }), { x: 14.5, y: 8 });
assert.strictEqual(V.fit(pairs.slice(0, 1)), null);
console.log('✓ fit/toSite');

const SITE = {
  points: { kitchen: { x: 3, y: 11.5 }, T01: { x: 11.5, y: 4.5 }, T06: { x: 14.5, y: 8 }, D1: { x: 7.5, y: 1.2 } },
  robots: [{ id: 'R1', dock: 'D1', driver: 'valetudo', valetudo: { topic: 'valetudo/Bot', points: { kitchen: { x: 2150, y: 2700 }, T01: { x: 1450, y: 1850 } } } }, { id: 'R2', dock: 'D1' }],
};
const PTS = SITE.robots[0].valetudo.points;
{
  const st = V.init(SITE); let now = 1e12;
  const H = (i) => V.handle(st, SITE, i, now);
  assert.deepStrictEqual(Object.keys(st.robots), ['R1']);                        // R2 is not ours
  assert.deepStrictEqual(H({ cmd: 'tick' }).events, [{ event: 'telemetry', robots: [] }]);   // nothing heard yet -> absent
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '87' });
  let t = H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0];
  assert.deepStrictEqual(t, { id: 'R1', x: 7.5, y: 1.2, battery: 87, moving: false, blocked: false, nav: 'idle', why: null, path: [], rem: 0, pos: null }); // no position yet -> dock
  let r = H({ cmd: 'goto', robot: 'R1', to: 'kitchen', x: 3, y: 11.5, token: 1 });
  assert.deepStrictEqual(r.mqtt, [{ topic: 'valetudo/Bot/GoToLocationCapability/go/set', payload: '{"coordinates":{"x":2150,"y":2700}}' }]);
  assert.strictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0].nav, 'moving');
  assert.deepStrictEqual(H({ cmd: 'stop', robot: 'R1' }).mqtt, [{ topic: 'valetudo/Bot/BasicControlCapability/operation/set', payload: 'STOP' }]);
  now += 2000;
  assert.strictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt[0].payload, '{"coordinates":{"x":2150,"y":2700}}');   // resend goal
  r = H({ cmd: 'goto', robot: 'R1', to: 'T06', x: 14.5, y: 8, token: 2 });                 // not calibrated
  assert.deepStrictEqual(r.mqtt, []);
  t = H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0];
  assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'noroute');
  now += 2000;
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'idle' });   // left the dock
  assert.strictEqual(H({ cmd: 'goto', robot: 'R1', to: 'D1', x: 7.5, y: 1.2, token: 3 }).mqtt[0].payload, 'HOME');
  assert.strictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0].blocked, false);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'lost' });
  assert.deepStrictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots, []);
  assert.deepStrictEqual(H({ cmd: 'map', map: {}, v: 2 }), { events: [], mqtt: [], maps: {} });       // ignored
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
  const tel = () => H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0];
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
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [], maps: {} });
  assert.strictEqual(tel().nav, 'moving');

  // c) stops far away -> blocked 'object'; resume resends go/set; later arrives
  now += 3000; status('moving'); pos(3000, 3000);
  assert.deepStrictEqual(noLog(status('idle')).events, []);
  assert.strictEqual(tel().blocked, false);   // waits up to 5 s for a fresh position
  now += 5000;
  t = tel(); assert.strictEqual(t.blocked, false); assert.strictEqual(t.nav, 'wait'); assert.strictEqual(t.why, 'object');   // soft: retries by itself
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
  assert.deepStrictEqual(goto('D1', 30), { events: [{ event: 'arrived', robot: 'R1', token: 30 }], mqtt: [], maps: {} });

  // f) already standing at the target -> arrived immediately, no publish
  fresh(); pos(2150, 2700); status('idle');
  assert.deepStrictEqual(goto('kitchen', 4), { events: [{ event: 'arrived', robot: 'R1', token: 4 }], mqtt: [], maps: {} });

  // g) redirect while moving: STOP, then the new goal once idle; no 'arrived' from that idle
  fresh(); goto('T01', 5); now += 2000; status('moving');
  assert.deepStrictEqual(goto('kitchen', 6).mqtt, [{ topic: OP, payload: 'STOP' }]);
  now += 1000;
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [{ topic: GO, payload: KITCHEN }], maps: {} });
  status('moving'); now += 3000;
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 6 }]);   // no pos -> trust status

  // h) redirect timeout: no idle within 3 s -> send anyway on tick
  fresh(); goto('T01', 5); now += 2000; status('moving');
  goto('kitchen', 6); now += 1000;
  assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, []);
  now += 2000;
  assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, [{ topic: GO, payload: KITCHEN }]);

  // i) second goto while waiting replaces the goal, no extra STOP
  fresh(); goto('T01', 5); now += 2000; status('moving');
  assert.deepStrictEqual(goto('kitchen', 6).mqtt, [{ topic: OP, payload: 'STOP' }]);
  assert.deepStrictEqual(goto('T01', 7).mqtt, []);
  assert.deepStrictEqual(status('idle').mqtt, [{ topic: GO, payload: T01 }]);
  // pause while waiting: nothing is sent on idle, resume sends the latest goal
  fresh(); goto('kitchen', 5); now += 2000; status('moving'); goto('T01', 6);
  assert.deepStrictEqual(H({ cmd: 'stop', robot: 'R1' }).mqtt, [{ topic: OP, payload: 'STOP' }]);
  assert.deepStrictEqual(status('idle'), { events: [], mqtt: [], maps: {} });
  now += 5000; assert.deepStrictEqual(H({ cmd: 'tick' }).mqtt, []);
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt, [{ topic: GO, payload: T01 }]);

  // same destination resent (orchestrator re-syncs goals after a map change) -> keep driving, new token
  fresh(); goto('T01', 10); now += 2000; status('moving');
  assert.deepStrictEqual(goto('T01', 11), { events: [], mqtt: [], maps: {} });
  now += 3000; pos(1450, 1850);
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 11 }]);

  // staff pressed 'Đã dọn lối đi' (orchestrator ignores pause/resume while blocked: this is the way on)
  fresh(); goto('T01', 12); status('moving'); now += 3000; pos(3000, 3000); status('idle'); now += 5000;
  assert.strictEqual(tel().why, 'object');
  assert.deepStrictEqual(H({ cmd: 'sim', robot: 'R1', fault: 'clear' }).mqtt, [{ topic: GO, payload: T01 }]);
  assert.strictEqual(tel().blocked, false);
  assert.deepStrictEqual(H({ cmd: 'sim', robot: 'R1', fault: 'clear' }).mqtt, []);   // not blocked -> nothing

  // j) no position at all: moving -> idle after 3 s -> arrived (trust status)
  fresh(); goto('T01', 8); status('moving'); now += 3000;
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 8 }]);
  // status 'error' mid-trip -> blocked, never 'arrived'
  goto('kitchen', 9); now += 3000;
  assert.deepStrictEqual(noLog(status('error')).events, []);
  assert.strictEqual(tel().why, 'object');
  // --- final review fixes ---
  // C1) goto while paused / e-stopped (cancel -> back to dock) must not drive the robot; resume does
  fresh(); goto('kitchen', 1); now += 2000;
  H({ cmd: 'stop', robot: 'R1' });
  assert.deepStrictEqual(goto('T01', 2).mqtt, []);
  assert.strictEqual(tel().moving, false);
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt, [{ topic: GO, payload: T01 }]);
  // I2) state restored after a Node-RED restart: offline until the broker re-delivers $state
  fresh(); st.boot = 'previous process';
  assert.deepStrictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots, []);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  assert.strictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots.length, 1);
  //     broker connection lost -> offline
  H({ cmd: 'link', up: false });
  assert.deepStrictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots, []);
  // I3) no battery level yet -> not reported (0 % would lock it into charging)
  st = V.init(SITE);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' }); status('docked');
  assert.deepStrictEqual(H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots, []);
  // I4) map-data lags the status: stopped "far" waits for a fresh position before blocking
  const zlib = require('zlib');
  const mapAt = (x, y) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/MapData/map-data',
    payload: zlib.deflateSync(JSON.stringify({ entities: [{ type: 'robot_position', points: [x, y] }] })) });
  fresh(); pos(3000, 3000); goto('T01', 3); status('moving'); now += 3000;
  assert.deepStrictEqual(noLog(status('idle')).events, []);
  assert.strictEqual(tel().blocked, false);
  assert.deepStrictEqual(mapAt(1450, 1850).events, [{ event: 'arrived', robot: 'R1', token: 3 }]);
  fresh(); pos(3000, 3000); goto('T01', 4); status('moving'); now += 3000; status('idle');
  now += 5000; mapAt(3000, 3000);
  assert.strictEqual(tel().why, 'object');
  // I5) resume when the robot reached the goal while paused -> arrived, nothing sent
  fresh(); goto('kitchen', 5); status('moving'); now += 3000;
  H({ cmd: 'stop', robot: 'R1' }); pos(2150, 2700); status('idle');
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }), { events: [{ event: 'arrived', robot: 'R1', token: 5 }], mqtt: [], maps: {} });
  // I6) reset stops a robot that was on a trip
  fresh(); goto('kitchen', 6);
  assert.deepStrictEqual(H({ cmd: 'reset' }).mqtt, [{ topic: OP, payload: 'STOP' }]);
  assert.deepStrictEqual(H({ cmd: 'reset' }).mqtt, []);

  // --- review 2 ---
  const err = (s) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/error_description', payload: s });
  // 1) leaving the dock: docked -> idle -> moving. The idle before 'moving' is not a trip end.
  fresh(); goto('kitchen', 20); now += 2000;
  assert.deepStrictEqual(noLog(status('idle')).events, []);                       // no map data: no fake arrival
  status('moving'); now += 3000; pos(2150, 2700);
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 20 }]);
  fresh(); pos(1000, 1000); goto('kitchen', 21); now += 2000;
  status('idle'); status('moving');                                        // far idle before moving: no blocked later
  now += 6000; H({ cmd: 'tick' });
  assert.strictEqual(tel().blocked, false);
  // 2) go/set silently rejected (or a trip shorter than the stale window): no status at all
  fresh(); goto('kitchen', 22);
  now += 9000; H({ cmd: 'tick' }); assert.strictEqual(tel().blocked, false);
  now += 1000; H({ cmd: 'tick' });
  t = tel(); assert.strictEqual(t.nav, 'wait'); assert.strictEqual(t.why, 'object');   // never moved, no position: not "arrived", retried
  fresh(); goto('kitchen', 23); pos(2150, 2700); now += 10000;             // short trip ended inside the window
  assert.deepStrictEqual(H({ cmd: 'tick' }).events.filter(e => e.event === 'arrived'), [{ event: 'arrived', robot: 'R1', token: 23 }]);
  //    trip that never ends -> blocked after 3 min
  fresh(); goto('kitchen', 24); now += 2000; status('moving');
  now += 177000; H({ cmd: 'tick' }); assert.strictEqual(tel().blocked, false);
  now += 1000; H({ cmd: 'tick' }); assert.strictEqual(tel().why, 'object');
  // 3) blocked stays blocked: staff lifts a stuck robot, Valetudo reports No error + idle -> no fake arrival
  fresh(); goto('T01', 25); now += 2000; status('moving'); now += 3000;
  err('Wheel stuck'); status('error');
  assert.strictEqual(tel().blocked, true);
  assert.deepStrictEqual(err('No error').mqtt, [{ topic: GO, payload: T01 }]);   // fault fixed at the robot: trip resumes by itself
  assert.deepStrictEqual(noLog(status('idle')).events, []);                              // stale idle right after the resend: no fake arrival
  assert.strictEqual(tel().blocked, false);
  // 5) empty / junk battery payload (retained message cleared) keeps the last level
  fresh();
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: 'n/a' });
  assert.strictEqual(tel().battery, 90);

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
  // Task 8: compact map beside the state, robot pos (cm) in telemetry
  const zlib = require('zlib');
  const full = { size: { x: 2500, y: 2000 }, pixelSize: 5,
    layers: [{ type: 'floor', compressedPixels: [1, 1, 3], metaData: {} }, { type: 'segment', compressedPixels: [4, 1, 2], metaData: { segmentId: '7', name: 'Sảnh' } }],
    entities: [{ type: 'robot_position', points: [120, 340], metaData: { angle: 90 } }, { type: 'charger_location', points: [100, 300] }] };
  const r = V.parseMapData(zlib.deflateSync(JSON.stringify(full)));
  assert.deepStrictEqual(r.pos, { x: 120, y: 340, angle: 90 });
  assert.deepStrictEqual(r.map.size, { x: 2500, y: 2000 }); assert.strictEqual(r.map.pixelSize, 5);
  assert.deepStrictEqual(r.map.layers, [{ type: 'floor', px: [1, 1, 3] }, { type: 'segment', segmentId: '7', name: 'Sảnh', px: [4, 1, 2] }]);
  assert.deepStrictEqual(r.map.charger, { x: 100, y: 300 });
  assert.deepStrictEqual(V.parseMapData(Buffer.from('garbage')), { pos: null, map: null });
  const noRobot = { ...full, entities: [full.entities[1]] };
  const r2 = V.parseMapData(zlib.deflateSync(JSON.stringify(noRobot)));
  assert.strictEqual(r2.pos, null); assert.strictEqual(r2.map.layers.length, 2); assert.strictEqual(r2.map.charger.x, 100);
  const noLayers = { ...full, layers: [] };
  assert.deepStrictEqual(V.parseMapData(zlib.deflateSync(JSON.stringify(noLayers))).map.layers, []);

  const st = V.init(SITE), topic = 'valetudo/Bot/MapData/map-data';
  H0 = (i) => V.handle(st, SITE, i, 5000);
  H0({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H0({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  H0({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '80' });
  let out = H0({ cmd: 'mqtt', topic, payload: zlib.deflateSync(JSON.stringify(full)) });
  assert.strictEqual(out.maps.R1.size.x, 2500); assert.strictEqual(out.maps.R1.t, 5000);
  assert.deepStrictEqual(st.robots.R1.mapMeta, { size: { x: 2500, y: 2000 }, charger: { x: 100, y: 300 } });
  assert.strictEqual(JSON.stringify(st).includes('"px"'), false, 'map layers never stored in state');
  out = H0({ cmd: 'tick' });
  assert.deepStrictEqual(out.maps, {});
  assert.deepStrictEqual(out.events.find(e => e.event === 'telemetry').robots[0].pos, { x: 120, y: 340, angle: 90 });
  assert.deepStrictEqual(H0({ cmd: 'mqtt', topic, payload: Buffer.from('garbage') }).maps, {});
  console.log('✓ compact map / telemetry pos');
}

{
  // Task 11: probe = drive an idle robot to a spot to check a taught point; no goal, no arrival bookkeeping
  const st = V.init(SITE); let now = 1e12;
  const H = (i) => V.handle(st, SITE, i, now);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  assert.deepStrictEqual(H({ cmd: 'probe', robot: 'R1', x: 123, y: 456 }).mqtt, [{ topic: 'valetudo/Bot/GoToLocationCapability/go/set', payload: '{"coordinates":{"x":123,"y":456}}' }]);
  assert.strictEqual(st.robots.R1.goal, null);
  H({ cmd: 'goto', robot: 'R1', to: 'kitchen', token: 1 });
  assert.deepStrictEqual(H({ cmd: 'probe', robot: 'R1', x: 1, y: 2 }).mqtt, []);   // busy: ignored
  console.log('✓ probe');
}

{
  // Task 13: blocked auto-recovery — wait / retry / blocked / stuck watchdog / retryable errors / acceptCm
  const GO = 'valetudo/Bot/GoToLocationCapability/go/set', OP = 'valetudo/Bot/BasicControlCapability/operation/set';
  const T01 = '{"coordinates":{"x":1450,"y":1850}}', KITCHEN = '{"coordinates":{"x":2150,"y":2700}}';
  let st, now, site = SITE;
  const H = (i) => V.handle(st, site, i, now);
  const status = (s) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: s });
  const err = (s) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/error_description', payload: s });
  const goto = (to, token) => H({ cmd: 'goto', robot: 'R1', to, x: 0, y: 0, token });
  const tick = () => H({ cmd: 'tick' });
  const tel = () => tick().events.find(e => e.event === 'telemetry').robots[0];
  const logs = r => r.events.filter(e => e.event === 'log').map(e => e.text);
  const pos = (x, y) => { st.robots.R1.pos = { x, y }; };
  const fresh = (s = SITE) => {
    site = s; st = V.init(site); now = 1e12;
    H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' }); status('docked');
    H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '90' });
  };
  const farStop = () => { status('moving'); now += 3000; pos(3000, 3000); status('idle'); now += 5000; tick(); };   // ends 200+ cm away -> waiting

  // (B) idle away from the goal -> wait, retry every 15 s, blocked after 4 tries, keeps retrying every 60 s, then arrives
  fresh(); goto('T01', 1); now += 2000; farStop();
  let r = tick(); let t = r.events.find(e => e.event === 'telemetry').robots[0];
  assert.strictEqual(t.nav, 'wait'); assert.strictEqual(t.blocked, false); assert.strictEqual(t.why, 'object');
  assert.deepStrictEqual(tick().mqtt, []);
  now += 15000; r = tick();
  assert.deepStrictEqual(r.mqtt, [{ topic: GO, payload: T01 }]);
  assert.ok(logs(r).some(x => /lần 1/.test(x)), 'retry logged');
  for (let i = 2; i <= 4; i++) { now += 15000; r = tick(); assert.deepStrictEqual(r.mqtt, [{ topic: GO, payload: T01 }], 'retry ' + i); assert.strictEqual(tel().blocked, false); }
  now += 15000; r = tick();   // 5th attempt: give up -> blocked, but still resent
  assert.deepStrictEqual(r.mqtt, [{ topic: GO, payload: T01 }]);
  t = tel(); assert.strictEqual(t.blocked, true); assert.strictEqual(t.why, 'object');
  now += 15000; assert.deepStrictEqual(tick().mqtt, []);   // slow retries now
  now += 45000; assert.deepStrictEqual(tick().mqtt, [{ topic: GO, payload: T01 }]);
  status('moving'); assert.strictEqual(tel().blocked, false); assert.strictEqual(tel().nav, 'moving');   // the way is clear: back to normal
  now += 3000; pos(1455, 1850);
  assert.deepStrictEqual(status('idle').events, [{ event: 'arrived', robot: 'R1', token: 1 }]);
  console.log('✓ wait / retry / blocked / self-clear');

  // acceptCm: stopped short at the same spot retryMax times (chair over the stop) -> within 80 cm counts as arrived (0 = off)
  const shortStops = (n) => { for (let i = 0; i < n; i++) { status('moving'); now += 3000; pos(1500, 1850); status('idle'); now += 5000; tick(); now += 15000; tick(); } };
  fresh(); goto('T01', 2); now += 2000; shortStops(4);
  assert.strictEqual(st.robots.R1.tries, 4);
  status('moving'); now += 3000; pos(1500, 1850); status('idle'); now += 5000; r = tick();
  assert.deepStrictEqual(r.events.filter(e => e.event === 'arrived'), [{ event: 'arrived', robot: 'R1', token: 2 }]);
  assert.ok(logs(r).some(x => /coi là đã tới/.test(x)));
  const OFF = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, acceptCm: 0 } }, SITE.robots[1]] };
  fresh(OFF); goto('T01', 3); now += 2000; shortStops(4);
  status('moving'); now += 3000; pos(1500, 1850); status('idle'); now += 5000; r = tick();
  assert.deepStrictEqual(r.events.filter(e => e.event === 'arrived'), []);
  assert.strictEqual(tel().nav, 'wait');
  console.log('✓ acceptCm');

  // (A) moving but not getting anywhere for 20 s -> STOP, wait, retry
  fresh(); pos(1000, 1000); goto('T01', 4); now += 2000; status('moving'); pos(1010, 1005);
  now += 19000; assert.deepStrictEqual(tick().mqtt, []);
  now += 1000; r = tick();
  assert.deepStrictEqual(r.mqtt, [{ topic: OP, payload: 'STOP' }]);
  assert.ok(logs(r).some(x => /đứng yên/.test(x)));
  assert.strictEqual(tel().nav, 'wait');
  // progress resets the watchdog
  fresh(); pos(1000, 1000); goto('T01', 5); now += 2000; status('moving');
  now += 15000; pos(1100, 1000); tick(); now += 15000; assert.deepStrictEqual(tick().mqtt, []);
  console.log('✓ stuck watchdog');

  // (C) retryable Valetudo errors wait; others block; error cleared -> resend
  fresh(); goto('T01', 6); now += 2000; status('moving'); now += 3000;
  err('Cannot reach target'); status('error');
  t = tel(); assert.strictEqual(t.nav, 'wait'); assert.strictEqual(t.blocked, false);
  fresh(); goto('T01', 7); now += 2000; status('moving'); now += 3000;
  err('Wheel lost floor contact'); status('error');
  assert.strictEqual(tel().blocked, true);
  assert.deepStrictEqual(err('No error').mqtt, [{ topic: GO, payload: T01 }]);
  console.log('✓ retryable errors');

  // Review Focus 4: a new goal while waiting resets the retries; no stale retry of the old goal
  fresh(); goto('T01', 8); now += 2000; farStop();
  now += 15000; tick(); now += 15000; tick();
  assert.strictEqual(st.robots.R1.tries, 2);
  assert.deepStrictEqual(goto('kitchen', 9).mqtt, [{ topic: GO, payload: KITCHEN }]);
  assert.strictEqual(st.robots.R1.tries, 0); assert.strictEqual(tel().nav, 'moving');
  now += 15000; assert.deepStrictEqual(tick().mqtt, []);
  // paused while waiting: no retry; resume retries at once
  fresh(); goto('T01', 10); now += 2000; farStop();
  H({ cmd: 'stop', robot: 'R1' });
  now += 30000; assert.deepStrictEqual(tick().mqtt, []);
  assert.deepStrictEqual(H({ cmd: 'resume', robot: 'R1' }).mqtt, [{ topic: GO, payload: T01 }]);
  // abnormal trip end is logged with status / position / distance
  fresh(); goto('T01', 11); now += 2000; status('moving'); now += 3000; pos(3000, 3000); status('idle'); now += 5000; r = tick();
  assert.ok(logs(r).some(x => /dừng ở 3000,3000/.test(x) && /status=idle/.test(x)), JSON.stringify(logs(r)));
  console.log('✓ new goal / paused / trip-end log');

  // Review fix 1: a config save mid-trip (knob / point taught -> adapter rebuild) must not drop the trip
  fresh(); goto('T01', 30); now += 2000; status('moving');
  const taught = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, points: { ...PTS, T02: { x: 500, y: 500 } } } }, SITE.robots[1]] };
  site = taught;
  assert.strictEqual(tel().nav, 'moving');
  now += 3000; pos(1455, 1850);
  assert.deepStrictEqual(status('idle').events.filter(e => e.event === 'arrived'), [{ event: 'arrived', robot: 'R1', token: 30 }]);
  // the goal's own coordinates re-taught mid-trip -> resent
  fresh(); goto('T01', 31); now += 2000; status('moving');
  site = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, points: { ...PTS, T01: { x: 1600, y: 1850 } } } }, SITE.robots[1]] };
  r = tick();
  assert.deepStrictEqual(r.mqtt, [{ topic: OP, payload: 'STOP' }]);   // stop, then the new coordinates once idle
  assert.deepStrictEqual(status('idle').mqtt, [{ topic: GO, payload: '{"coordinates":{"x":1600,"y":1850}}' }]);
  // paused survives too
  fresh(); goto('T01', 32); now += 2000; status('moving'); H({ cmd: 'stop', robot: 'R1' });
  site = taught; now += 20000;
  assert.deepStrictEqual(tick().mqtt, []); assert.strictEqual(st.robots.R1.paused, true);
  console.log('✓ rebuild keeps the trip');

  // Review fix 3: short stops with real progress in between are not "4 tries at the same spot"
  fresh(); pos(100, 1850); goto('T01', 40); now += 2000;
  for (let i = 1; i <= 6; i++) {   // each stop is 200 cm further along, still short of T01 (1450)
    status('moving'); now += 3000; pos(100 + 200 * i, 1850); status('idle'); now += 5000; tick();
    assert.strictEqual(tel().blocked, false, 'stop ' + i);
    now += 15000; tick();   // retry
  }
  console.log('✓ progress between stops resets the tries');
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
  const val = V.init(SITE), SITE2 = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { topic: 'valetudo/Real', points: PTS } }] };
  V.handle(val, SITE2, { cmd: 'mqtt', topic: 'valetudo/Real/$state', payload: 'ready' }, 0);
  assert.strictEqual(val.robots.R1.online, true);
  console.log('✓ valetudo state rebuilt when site.json changes');
}

{
  // robot marked driver 'valetudo' but its valetudo block forgotten -> skipped (with a warning), no throw
  const BAD = { ...SITE, robots: [{ id: 'R1', dock: 'D1', driver: 'valetudo' }] };
  const warn = console.warn; let warned = 0; console.warn = () => warned++;
  const st = V.init(BAD);
  assert.deepStrictEqual(V.handle(st, BAD, { cmd: 'tick' }, 0).events, [{ event: 'telemetry', robots: [] }]);
  console.warn = warn;
  assert.strictEqual(warned, 1);
  // map-data with a robot entity but no usable coordinates
  const zlib = require('zlib');
  assert.strictEqual(V.parseMap(zlib.deflateSync(JSON.stringify({ entities: [{ type: 'robot_position', points: [] }] }))), null);
  // mirrored Valetudo map (x_r = 100x + 1000, y_r = -100y + 3000): needs >= 3 points to tell
  const mir = [[3, 11.5], [11.5, 4.5], [7.5, 1.2]].map(([x, y]) => ({ site: { x, y }, robot: { x: 100 * x + 1000, y: -100 * y + 3000 } }));
  assert.deepStrictEqual(V.toSite(V.fit(mir), { x: 2450, y: 2200 }), { x: 14.5, y: 8 });
  assert.deepStrictEqual(V.toSite(V.fit(pairs.concat([{ site: { x: 14.5, y: 8 }, robot: { x: 1800, y: 1550 } }])), { x: 1000 + 120, y: 3000 - 750 }), { x: 7.5, y: 1.2 });   // not mirrored stays so
  console.log('✓ config / parse robustness, mirrored map');
}

{
  // per-robot knobs in site.json: valetudo.nomoveSec / tripSec (like arriveCm)
  const K = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { topic: 'valetudo/Bot', nomoveSec: 20, tripSec: 60, points: PTS } }] };
  let now = 1e12; const st = V.init(K);
  const H = (i) => V.handle(st, K, i, now), tel = () => H({ cmd: 'tick' }).events.find(e => e.event === 'telemetry').robots[0];
  const status = (s) => H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: s });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' }); status('docked');
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '90' });
  H({ cmd: 'goto', robot: 'R1', to: 'kitchen', token: 1 });
  now += 15000; assert.strictEqual(tel().nav, 'moving');   // default 10 s would have given up
  now += 5000; assert.strictEqual(tel().nav, 'wait');
  H({ cmd: 'sim', robot: 'R1', fault: 'clear' }); status('moving');
  now += 59000; assert.strictEqual(tel().nav, 'moving');
  now += 1000; assert.strictEqual(tel().nav, 'wait');   // tripSec: last-resort net
  // knob edited on the device + restart: saved state picks up the new value
  const K2 = { ...K, robots: [{ ...K.robots[0], valetudo: { ...K.robots[0].valetudo, arriveCm: 80 } }] };
  V.handle(st, K2, { cmd: 'tick' }, now);
  assert.strictEqual(st.robots.R1.arriveCm, 80);
  console.log('✓ nomoveSec / tripSec knobs');
}

{
  // Task 5: a knob edited in setup.html rebuilds the adapter state but keeps what the robot already told us
  let now = 1e12; const st = V.init(SITE);
  const H = (i, s = SITE) => V.handle(st, s, i, now);
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/$state', payload: 'ready' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/StatusStateAttribute/status', payload: 'docked' });
  H({ cmd: 'mqtt', topic: 'valetudo/Bot/BatteryStateAttribute/level', payload: '87' });
  const K2 = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, arriveCm: 80 } }, SITE.robots[1]] };
  const t = H({ cmd: 'tick' }, K2).events.find(e => e.event === 'telemetry').robots;
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0].battery, 87); assert.strictEqual(st.robots.R1.arriveCm, 80);
  // a new topic is a different robot: nothing known until it speaks
  const K3 = { ...SITE, robots: [{ ...SITE.robots[0], valetudo: { ...SITE.robots[0].valetudo, topic: 'valetudo/Other' } }, SITE.robots[1]] };
  assert.deepStrictEqual(H({ cmd: 'tick' }, K3).events.find(e => e.event === 'telemetry').robots, []);
  console.log('✓ knob edit keeps ingested state; topic change does not');
}
