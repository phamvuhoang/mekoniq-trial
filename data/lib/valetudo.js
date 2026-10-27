'use strict';
const zlib = require('zlib');
// MEKONIQ Serve S1 — Robot Adapter (VALETUDO). Same contract as lib/simulator.js, for a robot vacuum running
// Valetudo, spoken to over MQTT (<topic> = robots[].valetudo.topic, e.g. valetudo/InsecureYellowishGoldfish):
//   publish   <topic>/GoToLocationCapability/go/set      {"coordinates":{"x":cm,"y":cm}}
//             <topic>/BasicControlCapability/operation/set HOME | STOP
//   subscribe <topic>/StatusStateAttribute/status|error_description, BatteryStateAttribute/level, $state,
//             MapData/map-data (zlib-deflated JSON, robot_position entity)
// The robot plans its own path on its own map; goals are site.valetudo.points[id] in robot cm.
// Robot cm -> site m (for the UI only) is a similarity transform fitted on the points known in both.
// Trip end = status leaves moving/returning: near the goal (or no position known) -> arrived, else blocked.
// New goal while moving -> STOP, wait for a stopped status (max 3 s), then send: not every model accepts go/set mid-trip.
// ponytail: no path/rem/reroute/obstacles (Valetudo does not report them); one goal at a time;
// a trip shorter than the 1.5 s stale-status window is never seen to end.

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

// Robot position {x, y, angle} (cm) from a MapData/map-data payload, or null if it is not one we can read.
function parseMap(payload) {
  try {
    const m = JSON.parse(zlib.inflateSync(Buffer.from(payload)));
    const e = m.entities.find(e => e.type === 'robot_position');
    return { x: e.points[0], y: e.points[1], angle: (e.metaData && e.metaData.angle) ?? null };
  } catch (e) { return null; }
}

const MOVING = ['moving', 'returning'], STOPPED = ['idle', 'docked', 'error', 'paused'];
const STALE_MS = 1500, STOP_WAIT_MS = 3000;
const arriveCm = (site, r) => (r.valetudo && r.valetudo.arriveCm) ?? 40;

const robotsKey = site => site.robots.filter(r => r.driver === 'valetudo').map(r => r.id + '@' + r.valetudo.topic).join();

function init(site) {
  const st = { key: robotsKey(site), robots: {} };
  for (const r of site.robots) if (r.driver === 'valetudo')
    st.robots[r.id] = { topic: r.valetudo.topic, dock: r.dock, arriveCm: arriveCm(site, r), status: null, flag: null, err: null,
      battery: null, pos: null, online: false, goal: null, pending: false, pendingSince: 0, sentAt: 0, paused: false, blocked: false, why: null };
  return st;
}

const op = (b, cmd) => ({ topic: b.topic + '/BasicControlCapability/operation/set', payload: cmd });
// The publish that drives the robot to its goal.
function send(b, now) {
  b.sentAt = now;
  const g = b.goal;
  return g.home ? op(b, 'HOME')
    : { topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(g.coords.x), y: Math.round(g.coords.y) } }) };
}
const near = (b) => !!b.pos && !!b.goal.coords && Math.hypot(b.pos.x - b.goal.coords.x, b.pos.y - b.goal.coords.y) <= b.arriveCm;
function arrive(id, b, events) {
  events.push({ event: 'arrived', robot: id, token: b.goal.token });
  b.goal = null; b.blocked = false; b.why = null;
}

// input: orchestrator cmd | {cmd:'tick'} | {cmd:'mqtt', topic, payload}. Returns {events, mqtt}.
function handle(st, site, input, now) {
  if (st.key !== robotsKey(site)) { for (const k of Object.keys(st)) delete st[k]; Object.assign(st, init(site)); }   // site.json edited
  const events = [], mqtt = [], id = input.robot, b = st.robots[id];
  switch (input.cmd) {
    case 'goto': {
      if (!b) break;
      // same destination resent (orchestrator re-syncs goals after a map change): keep driving, no STOP
      if (b.goal && b.goal.to === input.to && !b.paused && !b.blocked) { b.goal.token = input.token; break; }
      const { points } = calib(site);
      b.goal = { to: input.to, token: input.token, home: input.to === b.dock, coords: points[input.to] || null };
      b.paused = false; b.blocked = false; b.why = null;
      if (!b.goal.home && !b.goal.coords) { b.pending = false; b.blocked = true; b.why = 'noroute'; break; }
      if (b.pending) break;   // already waiting for the robot to stop: the latest goal wins
      if (MOVING.includes(b.status)) { b.pending = true; b.pendingSince = now; mqtt.push(op(b, 'STOP')); }
      else if (b.goal.home ? b.status === 'docked' : near(b)) arrive(id, b, events);
      else mqtt.push(send(b, now));
      break;
    }
    case 'stop': if (b) { b.paused = true; b.pending = false; mqtt.push(op(b, 'STOP')); } break;
    case 'resume':
      if (!b) break;
      b.paused = false;
      if (b.goal && b.why !== 'noroute') { b.blocked = false; b.why = null; mqtt.push(send(b, now)); }
      break;
    case 'reset': for (const r of Object.values(st.robots)) Object.assign(r, { goal: null, pending: false, paused: false, blocked: false, why: null }); break;
    case 'mqtt': ingest(st, input, now, events, mqtt); break;
    case 'tick':
      for (const r of Object.values(st.robots))
        if (r.pending && now - r.pendingSince >= STOP_WAIT_MS) { r.pending = false; mqtt.push(send(r, now)); }
      events.push(telemetry(st, site));
      break;
    // map / obstacle / sim: the robot uses its own map and sensors.
  }
  return { events, mqtt };
}

function ingest(st, input, now, events, mqtt) {
  for (const [id, b] of Object.entries(st.robots)) {
    if (!input.topic.startsWith(b.topic + '/')) continue;
    const key = input.topic.slice(b.topic.length + 1), v = String(input.payload);
    if (key === '$state') b.online = v === 'ready';
    else if (key === 'StatusStateAttribute/flag') b.flag = v;
    else if (key === 'StatusStateAttribute/error_description') b.err = v && v !== 'No error' ? v : null;
    else if (key === 'BatteryStateAttribute/level') b.battery = +v;
    else if (key === 'MapData/map-data') b.pos = parseMap(input.payload) || b.pos;
    else if (key === 'StatusStateAttribute/status') {
      b.status = v;
      if (!b.goal || b.paused || b.why === 'noroute' || !STOPPED.includes(v)) continue;
      if (b.pending) { b.pending = false; mqtt.push(send(b, now)); continue; }
      if (now - b.sentAt < STALE_MS) continue;   // the robot may still report its old state
      if (v !== 'error' && (b.goal.home ? v === 'docked' : !b.pos || near(b))) arrive(id, b, events);   // no position: trust status
      else { b.blocked = true; b.why = 'object'; }
    }
  }
}

function telemetry(st, site) {
  const { T } = calib(site), robots = [];
  for (const [id, b] of Object.entries(st.robots)) {
    if (!b.online || b.status === null) continue;
    const p = b.pos && T ? toSite(T, b.pos) : site.points[b.dock] || { x: 0, y: 0 };
    const blocked = b.blocked || !!b.err, moving = !!b.goal && !b.paused && !blocked;
    robots.push({ id, x: p.x, y: p.y, battery: b.battery ?? 0, moving, blocked, nav: moving ? 'moving' : 'idle',
      why: b.err ? 'object' : b.why, path: [], rem: 0 });
  }
  return { event: 'telemetry', robots };
}

module.exports = { fit, toSite, calib, init, handle, arriveCm, parseMap };
