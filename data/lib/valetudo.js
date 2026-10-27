'use strict';
// MEKONIQ Serve S1 — Robot Adapter (VALETUDO). Same contract as lib/simulator.js, for a robot vacuum running
// Valetudo, spoken to over MQTT (<topic> = robots[].valetudo.topic, e.g. valetudo/InsecureYellowishGoldfish):
//   publish   <topic>/GoToLocationCapability/go/set      {"coordinates":{"x":cm,"y":cm}}
//             <topic>/BasicControlCapability/operation/set HOME | STOP
//   subscribe <topic>/StatusStateAttribute/status|error_description, BatteryStateAttribute/level, $state,
//             MapData/map-data (zlib-deflated JSON, robot_position entity)
// The robot plans its own path on its own map; goals are site.valetudo.points[id] in robot cm.
// Robot cm -> site m (for the UI only) is a similarity transform fitted on the points known in both.
// ponytail: no path/rem/reroute/obstacles (Valetudo does not report them); one goal at a time.

// Least-squares 2-D similarity robot(cm) -> site(m): X = a*x - b*y + tx, Y = b*x + a*y + ty. null if < 2 pairs.
function fit(pairs) {
  if (pairs.length < 2) return null;
  const n = pairs.length, avg = (f) => pairs.reduce((s, p) => s + f(p), 0) / n;
  const mx = avg(p => p.robot.x), my = avg(p => p.robot.y), MX = avg(p => p.site.x), MY = avg(p => p.site.y);
  let sa = 0, sb = 0, ss = 0;
  for (const { site: S, robot: P } of pairs) {
    const ux = P.x - mx, uy = P.y - my, Ux = S.x - MX, Uy = S.y - MY;
    sa += ux * Ux + uy * Uy; sb += ux * Uy - uy * Ux; ss += ux * ux + uy * uy;
  }
  if (!ss) return null;
  const a = sa / ss, b = sb / ss;
  return { a, b, tx: MX - a * mx + b * my, ty: MY - b * mx - a * my };
}

const r2 = v => Math.round(v * 100) / 100 || 0;
const toSite = (T, p) => ({ x: r2(T.a * p.x - T.b * p.y + T.tx), y: r2(T.b * p.x + T.a * p.y + T.ty) });

function calib(site) {
  const points = (site.valetudo && site.valetudo.points) || {};
  const pairs = Object.keys(points).filter(id => site.points[id]).map(id => ({ site: site.points[id], robot: points[id] }));
  return { T: fit(pairs), points };
}

const MOVING = ['moving', 'returning'];
const arriveCm = (site, r) => (r.valetudo && r.valetudo.arriveCm) ?? 40;

function init(site) {
  const st = { robots: {} };
  for (const r of site.robots) if (r.driver === 'valetudo')
    st.robots[r.id] = { topic: r.valetudo.topic, dock: r.dock, status: null, flag: null, err: null, battery: null, pos: null,
      online: false, goal: null, pending: null, pendingSince: 0, sentAt: 0, paused: false, blocked: false, why: null };
  return st;
}

const op = (b, cmd) => ({ topic: b.topic + '/BasicControlCapability/operation/set', payload: cmd });
// The publish that drives the robot to its goal.
function send(b, goal, now) {
  b.sentAt = now;
  return goal.home ? op(b, 'HOME')
    : { topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(goal.coords.x), y: Math.round(goal.coords.y) } }) };
}

// input: orchestrator cmd | {cmd:'tick'} | {cmd:'mqtt', topic, payload}. Returns {events, mqtt}.
function handle(st, site, input, now) {
  const events = [], mqtt = [], b = st.robots[input.robot];
  switch (input.cmd) {
    case 'goto': {
      if (!b) break;
      const { points } = calib(site);
      const goal = { to: input.to, token: input.token, home: input.to === b.dock, coords: points[input.to] || null };
      b.goal = goal; b.paused = false; b.blocked = false; b.why = null;
      if (!goal.home && !goal.coords) { b.blocked = true; b.why = 'noroute'; break; }
      mqtt.push(send(b, goal, now));
      break;
    }
    case 'stop': if (b) { b.paused = true; mqtt.push(op(b, 'STOP')); } break;
    case 'resume':
      if (!b) break;
      b.paused = false;
      if (b.goal && b.why !== 'noroute') mqtt.push(send(b, b.goal, now));
      break;
    case 'reset': for (const r of Object.values(st.robots)) Object.assign(r, { goal: null, pending: null, paused: false, blocked: false, why: null }); break;
    case 'mqtt': ingest(st, site, input, now, events, mqtt); break;
    case 'tick': events.push(telemetry(st, site)); break;
    // map / obstacle / sim: the robot uses its own map and sensors.
  }
  return { events, mqtt };
}

function ingest(st, site, input, now, events, mqtt) {
  for (const [id, b] of Object.entries(st.robots)) {
    if (!input.topic.startsWith(b.topic + '/')) continue;
    const key = input.topic.slice(b.topic.length + 1), v = String(input.payload);
    if (key === '$state') b.online = v === 'ready';
    else if (key === 'StatusStateAttribute/status') b.status = v;
    else if (key === 'StatusStateAttribute/flag') b.flag = v;
    else if (key === 'BatteryStateAttribute/level') b.battery = +v;
  }
}

function telemetry(st, site) {
  const { T } = calib(site), robots = [];
  for (const [id, b] of Object.entries(st.robots)) {
    if (!b.online || b.status === null) continue;
    const p = b.pos && T ? toSite(T, b.pos) : site.points[b.dock] || { x: 0, y: 0 };
    const moving = !!b.goal && !b.paused && !b.blocked;
    robots.push({ id, x: p.x, y: p.y, battery: b.battery ?? 0, moving, blocked: b.blocked, nav: moving ? 'moving' : 'idle',
      why: b.why, path: [], rem: 0 });
  }
  return { event: 'telemetry', robots };
}

module.exports = { fit, toSite, calib, init, handle, arriveCm };
