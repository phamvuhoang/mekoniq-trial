// Fake Valetudo robot on a local broker, for testing the Valetudo adapter without hardware (dev only, run from
// the repo: needs the `mqtt` devDependency):
//   mosquitto -p 1884 &   # the port Node-RED's mqtt-broker node uses
//   node scripts/fake-valetudo.js [valetudo/Bot] [mqtt://127.0.0.1:1884]
// go/set -> moving, 4 s later idle at the target; HOME -> returning, 4 s later docked; STOP -> idle.
const mqtt = require('mqtt'), zlib = require('zlib');
const T = process.argv[2] || 'valetudo/Bot';
const c = mqtt.connect(process.argv[3] || 'mqtt://127.0.0.1:1884', { will: { topic: T + '/$state', payload: 'lost', retain: true } });
const dock = { x: 1000, y: 1000 };
let pos = { ...dock }, status = 'docked', timer = null;
const pub = (k, v) => c.publish(`${T}/${k}`, v, { retain: true });
const state = (s) => { status = s; pub('StatusStateAttribute/status', s); console.log(new Date().toISOString(), s, pos); };
// Map like a real robot's (cm, 5 cm pixels): a 30 m x 20 m floor, its wall border, one named room, the charger.
const PX = 5, rows = (x0, x1, y0, y1) => { const px = []; for (let y = y0; y <= y1; y++) px.push(x0, y, x1 - x0 + 1); return px; };
const LAYERS = [
  { type: 'floor', compressedPixels: rows(20, 580, 20, 380), metaData: {} },
  { type: 'wall', compressedPixels: [...rows(19, 581, 19, 19), ...rows(19, 581, 381, 381), ...rows(19, 19, 20, 380), ...rows(581, 581, 20, 380)], metaData: {} },
  { type: 'segment', compressedPixels: rows(300, 560, 60, 200), metaData: { segmentId: '1', name: 'Sảnh' } },
];
let angle = 0;
const map = () => pub('MapData/map-data', zlib.deflateSync(JSON.stringify({ size: { x: 3000, y: 2000 }, pixelSize: PX, layers: LAYERS, metaData: { version: 2 },
  entities: [{ type: 'robot_position', points: [pos.x, pos.y], metaData: { angle } }, { type: 'charger_location', points: [dock.x, dock.y] }] })));
function drive(moving, to, end) {
  clearTimeout(timer); state(moving);
  timer = setTimeout(() => { pos = { ...to }; map(); state(end); }, 4000);
}
c.on('connect', () => {
  pub('$state', 'ready'); pub('StatusStateAttribute/error_description', 'No error'); state(status); map();
  c.subscribe([T + '/GoToLocationCapability/go/set', T + '/BasicControlCapability/operation/set']);
  setInterval(() => pub('BatteryStateAttribute/level', '95'), 2000);
  console.log('fake Valetudo robot on', T);
});
c.on('message', (topic, buf) => {
  const v = buf.toString();
  console.log('<-', topic.slice(T.length + 1), v);
  if (topic.endsWith('go/set')) drive('moving', JSON.parse(v).coordinates, 'idle');
  else if (v === 'HOME') drive('returning', dock, 'docked');
  else if (v === 'STOP') { clearTimeout(timer); state('idle'); }
});
