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
const STALE_MS = 1500, STOP_WAIT_MS = 3000, POS_WAIT_MS = 5000, SLOW_RETRY = 4, LINK_GRACE_MS = 5000;
const MQTT_DOWN_TEXT = 'Broker MQTT trong máy không chạy — robot thật không điều khiển được. Mở Termux, chạy lại install hoặc mosquitto -c ~/robot/mosquitto.conf -d';
// Per-robot knobs in robots[].valetudo (defaults in lib/site.js KNOBS): arriveCm, nomoveSec, tripSec,
// retrySec, retryMax, stuckSec, progressCm, acceptCm, retryErr.
const knob = (r, k, d) => (r.valetudo && Number.isFinite(r.valetudo[k]) ? r.valetudo[k] : d);
const arriveCm = (site, r) => knob(r, 'arriveCm', 40);
const RETRY_ERR = 'unreach|target|navigat|path';

// Saved state outlives the process (flow context on disk): after a restart nothing is "online" until the
// broker (re)delivers $state, so a robot that went away meanwhile shows up as offline.
const BOOT = Date.now() + Math.random();
const ours = r => r.driver === 'valetudo' && !!r.valetudo && typeof r.valetudo.topic === 'string' && !!r.valetudo.topic;
const robotsKey = site => JSON.stringify(site.robots.filter(ours).map(r => [r.id, r.dock, r.valetudo]));   // topic or a knob edited -> rebuild

// What the robot has told us, and the trip in progress: both survive a rebuild (knob / point edited in setup.html,
// which happens during service) as long as the topic is the same robot. A rebuild only swaps the knobs.
const INGESTED = ['status', 'err', 'errRetry', 'battery', 'pos', 'online', 'stateSeen', 'mapMeta', 'seenAt', 'mapAt', 'wifi'];
const TRIP = ['goal', 'pending', 'pendingSince', 'sentAt', 'seenMoving', 'checkUntil', 'paused', 'blocked', 'why', 'waiting', 'tries', 'retryAt', 'lastPos', 'progressAt', 'waitPos'];
function init(site, old) {
  const st = { key: robotsKey(site), boot: BOOT, link: old && old.link !== undefined ? old.link : true,
    downSince: (old && old.downSince) || 0, linkAlert: old ? old.linkAlert ?? old.link === false : false, robots: {} };
  for (const r of site.robots) {
    if (r.driver !== 'valetudo') continue;
    if (!ours(r)) { console.warn(`[valetudo] ${r.id}: thiếu "valetudo": { "topic": "<prefix>/<identifier>" } trong site.json — bỏ qua robot này`); continue; }
    let retryRe; try { retryRe = String(r.valetudo.retryErr || RETRY_ERR); new RegExp(retryRe, 'i'); } catch (e) { retryRe = RETRY_ERR; }
    const b = st.robots[r.id] = { topic: r.valetudo.topic, dock: r.dock, arriveCm: arriveCm(site, r),
      nomoveMs: knob(r, 'nomoveSec', 10) * 1000, tripMs: knob(r, 'tripSec', 180) * 1000,
      retryMs: knob(r, 'retrySec', 15) * 1000, retryMax: knob(r, 'retryMax', 4), stuckMs: knob(r, 'stuckSec', 20) * 1000,
      progressCm: knob(r, 'progressCm', 15), acceptCm: knob(r, 'acceptCm', 80), retryRe,
      status: null, err: null, errRetry: false, battery: null, pos: null, online: false, seenAt: 0, mapAt: 0, wifi: null,
      goal: null, pending: false, pendingSince: 0, sentAt: 0, seenMoving: false, checkUntil: 0,
      paused: false, blocked: false, why: null, waiting: false, tries: 0, retryAt: 0, lastPos: null, progressAt: 0, waitPos: null, ...calib(site, r) };
    const prev = old && old.robots && old.robots[r.id];
    if (prev && prev.topic === b.topic) {
      for (const k of INGESTED.concat(TRIP)) if (prev[k] !== undefined) b[k] = prev[k];
      if (b.goal && !b.goal.home) {   // the goal's point may have been re-taught: drive to the new spot
        const c = b.points[b.goal.to] || null, was = b.goal.coords;
        b.goal.coords = c;
        if (!c) { b.blocked = true; b.why = 'noroute'; b.waiting = false; }
        else if (!was || was.x !== c.x || was.y !== c.y) b.retaught = true;
      }
    }
  }
  return st;
}

const op = (b, cmd) => ({ topic: b.topic + '/BasicControlCapability/operation/set', payload: cmd });
const dist = (b) => (b.pos && b.goal && b.goal.coords ? Math.hypot(b.pos.x - b.goal.coords.x, b.pos.y - b.goal.coords.y) : null);
const where = (b) => (b.pos ? `${Math.round(b.pos.x)},${Math.round(b.pos.y)}` : '?');
const say = (events, id, text) => events.push({ event: 'log', robot: id, text: `${id}: ${text}` });
// The publish that drives the robot to its goal.
function send(b, now) {
  b.sentAt = now; b.seenMoving = false; b.checkUntil = 0; b.waiting = false; b.retryAt = 0;
  b.lastPos = b.pos && { x: b.pos.x, y: b.pos.y }; b.progressAt = now;
  const g = b.goal;
  return g.home ? op(b, 'HOME')
    : { topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(g.coords.x), y: Math.round(g.coords.y) } }) };
}
const near = (b) => { const d = dist(b); return d !== null && d <= b.arriveCm; };
function arrive(id, b, events) {
  events.push({ event: 'arrived', robot: id, token: b.goal.token });
  Object.assign(b, { goal: null, blocked: false, why: null, checkUntil: 0, waiting: false, tries: 0, retryAt: 0, waitPos: null });
}
// Hard stop: a fault only a person fixes (wheel, lifted, bin…) or the retries are used up. Stays until resume / clear /
// the fault clears — or, when still 'waiting', the slow retry gets the robot moving again.
const block = (b) => { b.blocked = true; b.why = 'object'; b.checkUntil = 0; };
// Soft stop: the way is blocked (idle away from the goal, no progress, "cannot reach target"). The robot asks for room
// (nav 'wait') and the trip is resent after retrySec; after retryMax tries it is reported blocked and retried slowly.
function wait(id, b, now, events, why) {
  if (b.waiting) return;
  // Got well past the last place it waited: a fresh blockage, not the same one — the tries start over.
  if (b.waitPos && b.pos && Math.hypot(b.pos.x - b.waitPos.x, b.pos.y - b.waitPos.y) > Math.max(100, 2 * b.arriveCm)) b.tries = 0;
  b.waitPos = b.pos && { x: b.pos.x, y: b.pos.y };
  b.waiting = true; b.why = 'object'; b.checkUntil = 0; b.retryAt = now + b.retryMs;
  const d = dist(b);
  say(events, id, `chuyến tới ${b.goal.to} ${why} ở ${where(b)}${d !== null ? ` (cách ${Math.round(d)} cm)` : ''}, status=${b.status}, lỗi=${b.err || '-'}`);
}
// Stopped away from the goal by the last known position: arrived after all if a fresh position says so.
function check(id, b, now, events) {
  if (near(b)) arrive(id, b, events);
  else if (now >= b.checkUntil) stopped(id, b, now, events);
}
// Stopped short of the goal, no fault: close enough after the tries are used up, else wait and retry.
function stopped(id, b, now, events) {
  const d = dist(b);
  const samePlace = !b.waitPos || !b.pos || Math.hypot(b.pos.x - b.waitPos.x, b.pos.y - b.waitPos.y) <= Math.max(100, 2 * b.arriveCm);
  if (samePlace && b.tries >= b.retryMax && b.acceptCm > 0 && d !== null && d <= b.acceptCm) {
    say(events, id, `dừng cách ${b.goal.to} ~${Math.round(d)} cm sau ${b.tries} lần thử — coi là đã tới`);
    return arrive(id, b, events);
  }
  wait(id, b, now, events, 'dừng');
}
// The robot stopped (trust: after it was seen moving): arrived, blocked / waiting, or wait for a fresh position.
function end(id, b, now, events, trust) {
  if (b.status === 'error' || b.err) fault(id, b, now, events);
  else if (b.goal.home) b.status === 'docked' ? arrive(id, b, events) : wait(id, b, now, events, 'dừng');
  else if (near(b) || (trust && !b.pos)) arrive(id, b, events);   // no position (map data off): trust status
  else if (b.pos) b.checkUntil = now + POS_WAIT_MS;   // map-data may lag the status
  else wait(id, b, now, events, 'không chạy');
}
// A Valetudo error while on a trip: "cannot reach target"-like errors are retried, anything else needs a person.
function fault(id, b, now, events) {
  if (b.err && b.errRetry) wait(id, b, now, events, 'báo lỗi');
  else { if (!b.blocked) say(events, id, `chuyến tới ${b.goal.to} dừng ở ${where(b)}, status=${b.status}, lỗi=${b.err || '-'} — cần nhân viên`); block(b); }
}
// Sets off towards b.goal (goto / resume / clear / retry): stop first if moving, arrive at once if already there.
function start(id, b, now, events, mqtt) {
  if (MOVING.includes(b.status)) { b.pending = true; b.pendingSince = now; mqtt.push(op(b, 'STOP')); }
  else if (b.goal.home ? b.status === 'docked' : near(b)) arrive(id, b, events);
  else mqtt.push(send(b, now));
}
// Progress watchdog bookkeeping: remember when the robot last moved more than progressCm.
const progress = (b, now) => { if (b.pos && (!b.lastPos || Math.hypot(b.pos.x - b.lastPos.x, b.pos.y - b.lastPos.y) > b.progressCm)) { b.lastPos = { x: b.pos.x, y: b.pos.y }; b.progressAt = now; } };
const restart = (b) => { b.blocked = false; b.why = null; b.waiting = false; b.tries = 0; b.retryAt = 0; b.waitPos = null; };

// input: orchestrator cmd | {cmd:'tick'} | {cmd:'mqtt', topic, payload} | {cmd:'link', up}.
// Returns {events, mqtt, maps}; maps[robotId] = compact map when one arrived in this call (kept out of st: it is big).
function handle(st, site, input, now) {
  const events = [], mqtt = [], maps = {}, id = input.robot;
  if (st.key !== robotsKey(site)) {   // config edited
    const fresh = init(site, st); for (const k of Object.keys(st)) delete st[k]; Object.assign(st, fresh);
    for (const [rid, r] of Object.entries(st.robots)) if (r.retaught) { delete r.retaught; if (!r.paused && !r.pending && r.why !== 'noroute') { r.waiting = false; start(rid, r, now, events, mqtt); } }
  }
  if (st.boot !== BOOT) { st.boot = BOOT; st.link = true; st.downSince = 0; for (const r of Object.values(st.robots)) r.online = false; }   // link: the MQTT node reports at start
  const b = st.robots[id];
  switch (input.cmd) {
    case 'goto': {
      if (!b) break;
      // same destination resent (orchestrator re-syncs goals after a map change): keep driving, no STOP
      if (b.goal && b.goal.to === input.to && !b.blocked && !b.waiting) { b.goal.token = input.token; break; }
      const enRoute = !!b.goal && !b.blocked && !b.waiting && !b.paused;   // a command is out, even if 'moving' was not reported yet
      b.goal = { to: input.to, token: input.token, home: input.to === b.dock, coords: b.points[input.to] || null };
      restart(b); b.checkUntil = 0;
      if (!b.goal.home && !b.goal.coords) { b.pending = false; b.blocked = true; b.why = 'noroute'; break; }
      if (b.paused) { b.pending = false; break; }   // paused / e-stopped: only resume may drive it
      if (b.pending) break;   // already waiting for the robot to stop: the latest goal wins
      if (enRoute && !MOVING.includes(b.status)) { b.pending = true; b.pendingSince = now; mqtt.push(op(b, 'STOP')); }
      else start(id, b, now, events, mqtt);
      break;
    }
    case 'probe':   // setup.html: check a taught point by driving there; only an idle robot with no goal, no state kept
      if (b && !b.goal && !b.paused && !MOVING.includes(b.status) && Number.isFinite(input.x) && Number.isFinite(input.y))
        mqtt.push({ topic: b.topic + '/GoToLocationCapability/go/set', payload: JSON.stringify({ coordinates: { x: Math.round(input.x), y: Math.round(input.y) } }) });
      break;
    case 'speed':   // guide slow mode: Valetudo has no speed control
      if (b) events.push({ event: 'log', robot: id, text: `${id}: ${input.factor < 1 ? 'đi chậm' : 'đi bình thường'} — robot Valetudo không hỗ trợ, bỏ qua` });
      break;
    case 'stop': if (b) { b.paused = true; b.pending = false; b.checkUntil = 0; mqtt.push(op(b, 'STOP')); } break;
    case 'resume':
      if (!b) break;
      b.paused = false;
      if (b.goal && b.why !== 'noroute') { restart(b); start(id, b, now, events, mqtt); }
      break;
    case 'sim':   // 'clear' = staff cleared the way ("Đã dọn lối đi"): try again now. Other faults are simulator-only.
      if (b && input.fault === 'clear' && b.goal && b.why === 'object' && !b.paused) { restart(b); start(id, b, now, events, mqtt); }
      break;
    case 'reset':   // demo reset: forget the trip and stop the robot where it is
      for (const r of Object.values(st.robots)) {
        if (r.goal || MOVING.includes(r.status)) mqtt.push(op(r, 'STOP'));
        Object.assign(r, { goal: null, pending: false, checkUntil: 0, paused: false, blocked: false, why: null, waiting: false, tries: 0, retryAt: 0 });
      }
      break;
    case 'mqtt': ingest(st, input, now, events, mqtt, maps); break;
    case 'link': {   // broker connection lost / back. The alert waits LINK_GRACE_MS (tick): every start reports 'connecting' first.
      const up = !!input.up;
      if (up) { if (st.linkAlert) events.push({ event: 'resolve', key: 'mqtt-down' }); st.linkAlert = false; st.downSince = 0; }
      else { if (!st.downSince) st.downSince = now; for (const r of Object.values(st.robots)) r.online = false; }
      st.link = up;
      break;
    }
    case 'tick':
      if (!st.link && !st.linkAlert && st.downSince && now - st.downSince >= LINK_GRACE_MS) {   // one alert per outage
        st.linkAlert = true; events.push({ event: 'alert', key: 'mqtt-down', level: 'error', text: MQTT_DOWN_TEXT });
      }
      for (const [rid, r] of Object.entries(st.robots)) {
        if (r.pending && now - r.pendingSince >= STOP_WAIT_MS) { r.pending = false; mqtt.push(send(r, now)); }
        if (!r.goal || r.paused || r.pending) continue;
        if (r.waiting) {   // retry: every retrySec, then every retrySec x 4 once reported blocked
          if (now < r.retryAt) continue;
          r.tries++;
          if (r.tries > r.retryMax && !r.blocked) { block(r); say(events, rid, `vẫn không đi được tới ${r.goal.to} sau ${r.retryMax} lần thử — cần nhân viên dọn lối`); }
          else if (!r.blocked) say(events, rid, `thử đi tiếp lần ${r.tries} tới ${r.goal.to}`);
          const slow = r.blocked;
          mqtt.push(send(r, now));
          r.waiting = true; r.retryAt = now + r.retryMs * (slow ? SLOW_RETRY : 1);
          continue;
        }
        if (r.blocked) continue;   // hard blocked: resume / clear / the fault clearing restart it
        progress(r, now);
        if (r.checkUntil) { if (now >= r.checkUntil) check(rid, r, now, events); }
        else if (!r.seenMoving && STOPPED.includes(r.status) && now - r.sentAt >= r.nomoveMs) end(rid, r, now, events, false);
        else if (r.seenMoving && MOVING.includes(r.status) && r.pos && now - r.progressAt >= r.stuckMs) {   // driving but going nowhere
          mqtt.push(op(r, 'STOP'));
          say(events, rid, `đứng yên ${Math.round(r.stuckMs / 1000)} s trên đường tới ${r.goal.to}`);
          wait(rid, r, now, events, 'kẹt');
        }
        else if (now - r.sentAt >= r.tripMs) { mqtt.push(op(r, 'STOP')); wait(rid, r, now, events, 'quá giờ'); }
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
    if (!input.retain) b.seenAt = now;   // retained = redelivered on (re)subscribe, not heard from now
    if (key === '$state') { b.online = v === 'ready'; b.stateSeen = true; }
    else if (!b.stateSeen) b.online = true;   // $state is only (re)sent on connect; a robot configured after the subscription never gets it
    if (key === '$state') continue;
    if (key === 'StatusStateAttribute/error_description') {
      const was = b.err;
      b.err = v && v !== 'No error' ? v : null;
      b.errRetry = !!b.err && new RegExp(b.retryRe, 'i').test(b.err);
      if (!b.goal || b.paused) continue;
      if (b.err) { if (b.errRetry) { if (b.blocked && !b.waiting) { b.blocked = false; } wait(id, b, now, events, 'báo lỗi'); } else { if (!b.blocked) say(events, id, `lỗi "${b.err}" trên đường tới ${b.goal.to} — cần nhân viên`); b.waiting = false; block(b); } }
      else if (was && b.blocked && !b.waiting) { restart(b); start(id, b, now, events, mqtt); }   // fault fixed at the robot: carry on
    }
    else if (key === 'BatteryStateAttribute/level') { if (v.trim() !== '' && Number.isFinite(Number(v))) b.battery = Number(v); }   // '' = retained cleared
    else if (key === 'MapData/map-data') {
      const { pos, map } = parseMapData(input.payload);
      b.pos = pos || b.pos;
      if (map) { maps[id] = { ...map, t: now }; b.mapMeta = { size: map.size, charger: map.charger }; b.mapAt = now; }
      progress(b, now);
      if (b.checkUntil && b.goal && !b.blocked && !b.waiting) check(id, b, now, events);
    }
    else if (key.startsWith('WifiConfigurationCapability/')) wifi(b, key.slice(28), v);
    else if (key === 'StatusStateAttribute/status') {
      b.status = v;
      if (!b.goal || b.paused) continue;
      if (b.pending) { if (STOPPED.includes(v)) { b.pending = false; mqtt.push(send(b, now)); } continue; }
      if (MOVING.includes(v)) {   // on its way (again): any wait / blocked is over
        if (!b.seenMoving) b.progressAt = now;
        b.seenMoving = true; b.checkUntil = 0;
        if ((b.waiting || b.blocked) && b.why !== 'noroute') { b.waiting = false; b.blocked = false; b.why = null; b.retryAt = 0; }   // tries are kept until it arrives: acceptCm needs them
        continue;
      }
      if (b.why === 'noroute') continue;
      if (now - b.sentAt < STALE_MS) continue;   // a stopped status this soon may be the old one
      if (v === 'error') fault(id, b, now, events);
      else if (b.waiting || b.blocked) continue;   // already handled; the retry timer / a person restarts it
      else if (STOPPED.includes(v) && b.seenMoving) end(id, b, now, events, true);   // idle before 'moving' (leaving the dock) is no trip end
    }
  }
}

// Wi-Fi facts for setup.html "Hệ thống" (topic names from Valetudo's WifiConfigurationCapabilityMqttHandle, not yet
// seen on real firmware). Garbage keeps the previous value.
function wifi(b, k, v) {
  let val;
  if (k === 'ips') {
    let a; try { a = JSON.parse(v); } catch (e) { a = v.split(','); }
    if (!Array.isArray(a)) return;
    val = a.map(x => String(x).trim()).filter(x => /^[0-9a-f.:]+$/i.test(x));
    if (!val.length) return;
  }
  else if (k === 'ssid') { if (!v.trim()) return; val = v; }
  else if (k === 'signal') { if (v.trim() === '' || !Number.isFinite(Number(v))) return; val = Number(v); }
  else return;
  b.wifi = { ...(b.wifi || { ips: [], ssid: null, signal: null }), [k]: val };
}

// GET /api/health: what each real robot last told us (lib/health.js wraps it).
function health(st) {
  const robots = {};
  for (const [id, b] of Object.entries(st.robots))
    robots[id] = { topic: b.topic, online: b.online, status: b.status, battery: b.battery, seenAt: b.seenAt || 0, mapAt: b.mapAt || 0, wifi: b.wifi || null };
  return { link: st.link !== false, robots };   // state saved by an older adapter has none of these
}

function telemetry(st, site) {
  const robots = [];
  for (const [id, b] of Object.entries(st.robots)) {
    if (!b.online || b.status === null || b.battery === null) continue;   // not heard from (yet): orchestrator shows offline
    const d = site.points[b.dock] || {};
    const p = b.pos && b.T ? toSite(b.T, b.pos) : { x: d.x || 0, y: d.y || 0 };
    const blocked = b.blocked || (!!b.err && !b.errRetry), waiting = !!b.goal && b.waiting && !blocked && !b.paused;
    const moving = !!b.goal && !b.paused && !blocked && !waiting;
    robots.push({ id, x: p.x, y: p.y, battery: b.battery, moving, blocked, nav: waiting ? 'wait' : moving ? 'moving' : 'idle',
      why: b.err && !b.errRetry ? 'object' : b.why, path: [], rem: 0, pos: b.pos ? { x: b.pos.x, y: b.pos.y, angle: b.pos.angle ?? null } : null });
  }
  return { event: 'telemetry', robots };
}

module.exports = { fit, toSite, calib, init, handle, arriveCm, parseMap, parseMapData, health };
