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
