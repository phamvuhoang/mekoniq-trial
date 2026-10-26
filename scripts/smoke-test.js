// Live smoke test against a running Node-RED: node scripts/smoke-test.js [ws://127.0.0.1:1880/ws]
// Resets the demo, delivers kitchen -> T01 through the real flow, checks the full round trip. ~30s.
const assert = require('assert');
const ws = new WebSocket(process.argv[2] || 'ws://127.0.0.1:1880/ws');
let site, state;
const sounds = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'site') site = m.site;
  if (m.type === 'state') state = m;
  if (m.type === 'event' && m.robotSound) sounds.push(m.robotSound);
};
const send = o => ws.send(JSON.stringify({ by: 'smoke-test', ...o }));
const wait = s => new Promise(r => setTimeout(r, s * 1000));
async function until(what, pred, sec = 40) {
  for (let i = 0; i < sec * 4; i++) { if (state && pred()) return; await wait(0.25); }
  throw new Error('timeout: ' + what);
}
const mission = () => state.missions[0];
const robot = id => state.robots.find(r => r.id === id);
ws.onopen = async () => {
  try {
    send({ type: 'hello' });
    send({ type: 'reset' });
    await until('site', () => site && state.missions.length === 0);
    send({ type: 'create', kind: 'deliver', from: 'kitchen', tables: ['T01'], robot: 'any' });
    await until('assigned', () => mission() && mission().status === 'active');
    const rid = mission().robot;
    await until('at kitchen', () => robot(rid).phase === 'atStop');
    send({ type: 'confirm', robot: rid, mission: mission().id, stop: 0 });
    await until('at T01', () => robot(rid).phase === 'atStop' && mission().cur === 1);
    send({ type: 'confirm', robot: rid, mission: mission().id, stop: 1 });
    await until('done', () => state.missions.length === 0 && state.kpi.delivered === 1);
    assert.deepStrictEqual(sounds, ['load', 'arrived', 'thanks']);
    console.log('OK live round trip via', rid, '·', state.log.length, 'log entries');
    process.exit(0);
  } catch (e) { console.error(e.message, JSON.stringify(state && state.robots)); process.exit(1); }
};
