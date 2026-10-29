const assert = require('assert');
const H = require('../data/lib/health');
let finished = false;   // localIp checks are async: a swallowed assertion must not look like a pass
process.on('exit', () => { if (!finished) { console.error('FAIL — localIp checks did not finish'); process.exitCode = 1; } });
const base = { link: true, clients: 2, robots: {}, now: 1e12 + 60000, started: 1e12 };
let h = H.build({ ...base, ip: '192.168.1.23', lastIp: '192.168.1.23' });
assert.deepStrictEqual(h.server, { ip: '192.168.1.23', port: H.PORT, lastIp: '192.168.1.23', ipChanged: null, firstRun: false, uptimeSec: 60 });
assert.deepStrictEqual(h.mqtt, { link: true, clients: 2, host: '192.168.1.23', port: 1883, user: H.MQTT_USER });
assert.strictEqual(h.t, base.now);
console.log('✓ steady state');
h = H.build({ ...base, ip: '192.168.1.50', lastIp: '192.168.1.23' });
assert.deepStrictEqual(h.server.ipChanged, { from: '192.168.1.23', to: '192.168.1.50' });
console.log('✓ ip changed');
h = H.build({ ...base, ip: null, lastIp: '192.168.1.23' });
assert.strictEqual(h.server.ipChanged, null); assert.strictEqual(h.server.firstRun, false); assert.strictEqual(h.mqtt.host, null);
console.log('✓ ip null');
h = H.build({ ...base, ip: '192.168.1.23', lastIp: undefined });
assert.strictEqual(h.server.ipChanged, null); assert.strictEqual(h.server.firstRun, true);
console.log('✓ first run');
h = H.build({ ...base, clients: undefined, link: undefined });
assert.strictEqual(h.mqtt.clients, null); assert.strictEqual(h.mqtt.link, false);
console.log('✓ missing broker facts');
assert.ok(!JSON.stringify(h).toLowerCase().includes('pass'));
console.log('✓ no password field');
// ip-changed alert transitions (Health node): restart, change, change again before ack, ack
{
  const at = (ip, lastIp) => H.build({ ...base, ip, lastIp });
  const ev = (prev, h) => H.ipEvents(prev, h).map(e => e.event + (e.text ? ':' + e.text.match(/sang (\S+)/)[1] : ''));
  const A = at('10.0.0.2', '10.0.0.1'), B = at('10.0.0.3', '10.0.0.1'), OK = at('10.0.0.1', '10.0.0.1');
  assert.deepStrictEqual(ev(OK, A), ['alert:10.0.0.2']);
  assert.deepStrictEqual(ev(A, A), []);
  assert.deepStrictEqual(ev(A, B), ['resolve', 'alert:10.0.0.3']);      // changed again: the station must show the new IP
  assert.deepStrictEqual(ev(B, OK), ['resolve']);
  assert.deepStrictEqual(ev(OK, OK), []);
  assert.deepStrictEqual(ev(undefined, OK), ['resolve']);                // restart: an alert saved on disk may be stale
  assert.deepStrictEqual(ev(undefined, A), ['resolve', 'alert:10.0.0.2']);  // and the saved text is replaced
  console.log('✓ ipEvents transitions');
}
// connect() fails (no route): the error goes to the callback and the socket reads 0.0.0.0 — must be null
{
  const dgram = require('dgram'), real = dgram.createSocket;
  const fake = (err, addr) => () => ({ on() {}, close() {}, connect(port, host, cb) { setImmediate(() => cb(err)); }, address: () => ({ address: addr }) });
  dgram.createSocket = fake(Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }), '0.0.0.0');
  H.localIp(ip => {
    assert.strictEqual(ip, null); console.log('✓ localIp no route → null');
    dgram.createSocket = fake(null, '0.0.0.0');
    H.localIp(ip => { assert.strictEqual(ip, null); console.log('✓ localIp unbound 0.0.0.0 → null'); dgram.createSocket = real; probe(); });
  });
}
function probe() { H.localIp(ip => { assert.ok(ip === null || /^\d+\.\d+\.\d+\.\d+$/.test(ip)); console.log('✓ localIp', ip); finished = true; console.log('OK — health'); }); }
