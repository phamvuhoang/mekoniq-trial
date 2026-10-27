'use strict';
const zlib = require('zlib');
// MEKONIQ Serve S1 — Robot Adapter (VALETUDO). Same contract as lib/simulator.js, for a robot vacuum running
// Valetudo, spoken to over MQTT (<topic> = robots[].valetudo.topic, e.g. valetudo/InsecureYellowishGoldfish):
//   publish   <topic>/GoToLocationCapability/go/set      {"coordinates":{"x":cm,"y":cm}}
//             <topic>/BasicControlCapability/operation/set HOME | STOP
//   subscribe <topic>/StatusStateAttribute/status|error_description, BatteryStateAttribute/level, $state,
//             MapData/map-data (zlib-deflated JSON, robot_position entity)
// The robot plans its own path on its own map; goals are robots[].valetudo.points[id] in robot cm (each robot has
// its own map, taught in setup.html). Robot cm -> site m (only for the hand-drawn floor plan of the web demo) is a
// similarity transform (mirrored if that fits better, >= 3 points) fitted on the points that have m coordinates too.
// Trip end = a stopped status after 'moving' was seen: near the goal (or no position known) -> arrived, else blocked.
// Never seen moving nomoveSec (10 s) after the command (rejected, or a trip inside the 1.5 s stale window) -> judged by position.
// Blocked stays blocked until resume / "Đã dọn lối đi"; any trip still running after tripSec (3 min) -> blocked.
// New goal while moving -> STOP, wait for a stopped status (max 3 s), then send: not every model accepts go/set mid-trip.
// ponytail: no path/rem/reroute/obstacles (Valetudo does not report them); one goal at a time.

// Least-squares 2-D similarity robot(cm) -> site(m): X = a*x - b*y + tx, Y = b*x + a*y + ty (y negated first when
// T.m, i.e. the Valetudo map is mirrored). Two points cannot tell a mirror apart, so it is only tried from 3. null if < 2.
function fit(pairs) {
  const T = fit1(pairs);
  if (!T || pairs.length < 3) return T;
  const M = fit1(pairs.map(p => ({ site: p.site, robot: { x: p.robot.x, y: -p.robot.y } })));
  M.m = true;
  const err = (T) => pairs.reduce((s, p) => { const q = toSite(T, p.robot); return s + (q.x - p.site.x) ** 2 + (q.y - p.site.y) ** 2; }, 0);
  return err(M) < err(T) ? M : T;
}
function fit1(pairs) {
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
  return { a, b, tx: MX - a * mx + b * my, ty: MY - b * mx - a * my, m: false };
}

const r2 = v => Math.round(v * 100) / 100 || 0;
function toSite(T, p) {
  const y = T.m ? -p.y : p.y;
  return { x: r2(T.a * p.x - T.b * y + T.tx), y: r2(T.b * p.x + T.a * y + T.ty) };
}

// Per-robot: its taught points (cm) and, when the site also has m coordinates, the cm -> m transform.
function calib(site, r) {
  const points = (r.valetudo && r.valetudo.points) || {};
  const pairs = Object.keys(points).filter(id => site.points[id] && Number.isFinite(site.points[id].x)).map(id => ({ site: site.points[id], robot: points[id] }));
  return { T: fit(pairs), points };
}

// A MapData/map-data payload (zlib-deflated Valetudo map): robot position {x, y, angle} (cm) and a compact copy of
// the map for the UI — {size, pixelSize, layers:[{type, segmentId?, name?, px}], charger}. px = Valetudo's
// compressedPixels ([xStart, y, count] triples, in pixels). Either part is null when it cannot be read.
function parseMapData(payload) {
  let m;
  try { m = JSON.parse(zlib.inflateSync(Buffer.from(payload))); } catch (e) { return { pos: null, map: null }; }
  const ents = Array.isArray(m.entities) ? m.entities : [];
  const pt = (type) => { const e = ents.find(e => e && e.type === type); const [x, y] = (e && e.points) || []; return Number.isFinite(x) && Number.isFinite(y) ? { x, y, e } : null; };
  const rp = pt('robot_position'), ch = pt('charger_location');
  const pos = rp ? { x: rp.x, y: rp.y, angle: (rp.e.metaData && rp.e.metaData.angle) ?? null } : null;
  let map = null;
  if (m.size && Number.isFinite(m.size.x) && Number.isFinite(m.size.y) && Number.isFinite(m.pixelSize)) {
    const layers = (Array.isArray(m.layers) ? m.layers : []).filter(l => l && Array.isArray(l.compressedPixels)).map(l => {
      const md = l.metaData || {};
      return { type: l.type, ...(md.segmentId !== undefined && { segmentId: String(md.segmentId) }), ...(md.name && { name: String(md.name) }), px: l.compressedPixels };
    });
    map = { size: { x: m.size.x, y: m.size.y }, pixelSize: m.pixelSize, layers, charger: ch ? { x: ch.x, y: ch.y } : null };
  }
  return { pos, map };
}
const parseMap = payload => parseMapData(payload).pos;

const MOVING = ['moving', 'returning'], STOPPED = ['idle', 'docked', 'error', 'paused'];
const STALE_MS = 1500, STOP_WAIT_MS = 3000, POS_WAIT_MS = 5000;
// Per-robot knobs in site.json robots[].valetudo: arriveCm, nomoveSec (no 'moving' after a command), tripSec.
const knob = (r, k, d) => (r.valetudo && Number.isFinite(r.valetudo[k]) ? r.valetudo[k] : d);
const arriveCm = (site, r) => knob(r, 'arriveCm', 40);

// Saved state outlives the process (flow context on disk): after a restart nothing is "online" until the
// broker (re)delivers $state, so a robot that went away meanwhile shows up as offline.
const BOOT = Date.now() + Math.random();
const ours = r => r.driver === 'valetudo' && !!r.valetudo && typeof r.valetudo.topic === 'string' && !!r.valetudo.topic;
const robotsKey = site => JSON.stringify(site.robots.filter(ours).map(r => [r.id, r.dock, r.valetudo]));   // topic or a knob edited -> rebuild

// What the robot has told us: survives a rebuild (knob / points edited) as long as the topic is the same robot.
const INGESTED = ['status', 'err', 'battery', 'pos', 'online'];
function init(site, old) {
  const st = { key: robotsKey(site), boot: BOOT, robots: {} };
  for (const r of site.robots) {
    if (r.driver !== 'valetudo') continue;
    if (!ours(r)) { console.warn(`[valetudo] ${r.id}: thiếu "valetudo": { "topic": "<prefix>/<identifier>" } trong site.json — bỏ qua robot này`); continue; }
    const b = st.robots[r.id] = { topic: r.valetudo.topic, dock: r.dock, arriveCm: arriveCm(site, r),
      nomoveMs: knob(r, 'nomoveSec', 10) * 1000, tripMs: knob(r, 'tripSec', 180) * 1000, status: null, err: null,
      battery: null, pos: null, online: false, goal: null, pending: false, pendingSince: 0, sentAt: 0, seenMoving: false, checkUntil: 0,
      paused: false, blocked: false, why: null, ...calib(site, r) };
    const prev = old && old.robots && old.robots[r.id];
    if (prev && prev.topic === b.topic) for (const k of INGESTED) b[k] = prev[k];
  }
  return st;
}

const op = (b, cmd) => ({ topic: b.topic + '/BasicControlCapability/operation/set', payload: cmd });
// The publish that drives the robot to its goal.
function send(b, now) {
  b.sentAt = now; b.seenMoving = false; b.checkUntil = 0;
  const g = b.goal;
  return g.home ? op(b, 'HOME')
    : { topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(g.coords.x), y: Math.round(g.coords.y) } }) };
}
const near = (b) => !!b.pos && !!b.goal.coords && Math.hypot(b.pos.x - b.goal.coords.x, b.pos.y - b.goal.coords.y) <= b.arriveCm;
function arrive(id, b, events) {
  events.push({ event: 'arrived', robot: id, token: b.goal.token });
  b.goal = null; b.blocked = false; b.why = null; b.checkUntil = 0;
}
const block = (b) => { b.blocked = true; b.why = 'object'; b.checkUntil = 0; };
// Stopped away from the goal by the last known position: arrived after all if a fresh position says so.
function check(id, b, now, events) {
  if (near(b)) arrive(id, b, events);
  else if (now >= b.checkUntil) block(b);
}
// The robot stopped (trust: after it was seen moving): arrived, blocked, or wait for a fresh position.
function end(id, b, now, events, trust) {
  if (b.status === 'error' || b.err) block(b);
  else if (b.goal.home) b.status === 'docked' ? arrive(id, b, events) : block(b);
  else if (near(b) || (trust && !b.pos)) arrive(id, b, events);   // no position (map data off): trust status
  else if (b.pos) b.checkUntil = now + POS_WAIT_MS;   // map-data may lag the status
  else block(b);
}
// Sets off towards b.goal (goto / resume / clear): stop first if moving, arrive at once if already there.
function start(id, b, now, events, mqtt) {
  if (MOVING.includes(b.status)) { b.pending = true; b.pendingSince = now; mqtt.push(op(b, 'STOP')); }
  else if (b.goal.home ? b.status === 'docked' : near(b)) arrive(id, b, events);
  else mqtt.push(send(b, now));
}

// input: orchestrator cmd | {cmd:'tick'} | {cmd:'mqtt', topic, payload} | {cmd:'link', up}.
// Returns {events, mqtt, maps}; maps[robotId] = compact map when one arrived in this call (kept out of st: it is big).
function handle(st, site, input, now) {
  if (st.key !== robotsKey(site)) { const fresh = init(site, st); for (const k of Object.keys(st)) delete st[k]; Object.assign(st, fresh); }   // config edited
  if (st.boot !== BOOT) { st.boot = BOOT; for (const r of Object.values(st.robots)) r.online = false; }
  const events = [], mqtt = [], maps = {}, id = input.robot, b = st.robots[id];
  switch (input.cmd) {
    case 'goto': {
      if (!b) break;
      // same destination resent (orchestrator re-syncs goals after a map change): keep driving, no STOP
      if (b.goal && b.goal.to === input.to && !b.blocked) { b.goal.token = input.token; break; }
      b.goal = { to: input.to, token: input.token, home: input.to === b.dock, coords: b.points[input.to] || null };
      b.blocked = false; b.why = null; b.checkUntil = 0;
      if (!b.goal.home && !b.goal.coords) { b.pending = false; b.blocked = true; b.why = 'noroute'; break; }
      if (b.paused) { b.pending = false; break; }   // paused / e-stopped: only resume may drive it
      if (b.pending) break;   // already waiting for the robot to stop: the latest goal wins
      start(id, b, now, events, mqtt);
      break;
    }
    case 'probe':   // setup.html: check a taught point by driving there; only an idle robot with no goal, no state kept
      if (b && !b.goal && !b.paused && !MOVING.includes(b.status) && Number.isFinite(input.x) && Number.isFinite(input.y))
        mqtt.push({ topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(input.x), y: Math.round(input.y) } }) });
      break;
    case 'stop': if (b) { b.paused = true; b.pending = false; b.checkUntil = 0; mqtt.push(op(b, 'STOP')); } break;
    case 'resume':
      if (!b) break;
      b.paused = false;
      if (b.goal && b.why !== 'noroute') { b.blocked = false; b.why = null; start(id, b, now, events, mqtt); }
      break;
    case 'sim':   // 'clear' = staff cleared the way ("Đã dọn lối đi"): try again. Other faults are simulator-only.
      if (b && input.fault === 'clear' && b.goal && b.why === 'object' && !b.paused) { b.blocked = false; b.why = null; start(id, b, now, events, mqtt); }
      break;
    case 'reset':   // demo reset: forget the trip and stop the robot where it is
      for (const r of Object.values(st.robots)) {
        if (r.goal || MOVING.includes(r.status)) mqtt.push(op(r, 'STOP'));
        Object.assign(r, { goal: null, pending: false, checkUntil: 0, paused: false, blocked: false, why: null });
      }
      break;
    case 'mqtt': ingest(st, input, now, events, mqtt, maps); break;
    case 'link': if (!input.up) for (const r of Object.values(st.robots)) r.online = false; break;   // broker connection lost
    case 'tick':
      for (const [rid, r] of Object.entries(st.robots)) {
        if (r.pending && now - r.pendingSince >= STOP_WAIT_MS) { r.pending = false; mqtt.push(send(r, now)); }
        if (!r.goal || r.paused || r.blocked || r.pending) continue;
        if (r.checkUntil) { if (now >= r.checkUntil) check(rid, r, now, events); }
        else if (!r.seenMoving && STOPPED.includes(r.status) && now - r.sentAt >= r.nomoveMs) end(rid, r, now, events, false);
        else if (now - r.sentAt >= r.tripMs) block(r);
      }
      events.push(telemetry(st, site));
      break;
    // map / obstacle: the robot uses its own map and sensors.
  }
  return { events, mqtt, maps };
}

function ingest(st, input, now, events, mqtt, maps) {
  for (const [id, b] of Object.entries(st.robots)) {
    if (!input.topic.startsWith(b.topic + '/')) continue;
    const key = input.topic.slice(b.topic.length + 1), v = String(input.payload);
    if (key === '$state') b.online = v === 'ready';
    else if (key === 'StatusStateAttribute/error_description') b.err = v && v !== 'No error' ? v : null;
    else if (key === 'BatteryStateAttribute/level') { if (v.trim() !== '' && Number.isFinite(Number(v))) b.battery = Number(v); }   // '' = retained cleared
    else if (key === 'MapData/map-data') {
      const { pos, map } = parseMapData(input.payload);
      b.pos = pos || b.pos;
      if (map) { maps[id] = { ...map, t: now }; b.mapMeta = { size: map.size, charger: map.charger }; }
      if (b.checkUntil && b.goal && !b.blocked) check(id, b, now, events);
    }
    else if (key === 'StatusStateAttribute/status') {
      b.status = v;
      if (!b.goal || b.paused || b.blocked) continue;   // blocked (incl. noroute): only resume / clear restart the trip
      if (b.pending) { if (STOPPED.includes(v)) { b.pending = false; mqtt.push(send(b, now)); } continue; }
      if (MOVING.includes(v)) { b.seenMoving = true; b.checkUntil = 0; continue; }
      if (now - b.sentAt < STALE_MS) continue;   // a stopped status this soon may be the old one
      if (v === 'error') block(b);
      else if (STOPPED.includes(v) && b.seenMoving) end(id, b, now, events, true);   // idle before 'moving' (leaving the dock) is no trip end
    }
  }
}

function telemetry(st, site) {
  const robots = [];
  for (const [id, b] of Object.entries(st.robots)) {
    if (!b.online || b.status === null || b.battery === null) continue;   // not heard from (yet): orchestrator shows offline
    const d = site.points[b.dock] || {};
    const p = b.pos && b.T ? toSite(b.T, b.pos) : { x: d.x || 0, y: d.y || 0 };
    const blocked = b.blocked || !!b.err, moving = !!b.goal && !b.paused && !blocked;
    robots.push({ id, x: p.x, y: p.y, battery: b.battery, moving, blocked, nav: moving ? 'moving' : 'idle',
      why: b.err ? 'object' : b.why, path: [], rem: 0, pos: b.pos ? { x: b.pos.x, y: b.pos.y, angle: b.pos.angle ?? null } : null });
  }
  return { event: 'telemetry', robots };
}

module.exports = { fit, toSite, calib, init, handle, arriveCm, parseMap, parseMapData };
