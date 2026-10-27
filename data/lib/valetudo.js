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

module.exports = { fit, toSite, calib };
