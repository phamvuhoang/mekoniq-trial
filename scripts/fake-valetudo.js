// Fake Valetudo robot on a local broker, for testing the Valetudo adapter without hardware:
//   node scripts/fake-valetudo.js [valetudo/Bot] [mqtt://127.0.0.1:1883]
// go/set -> moving, 4 s later idle at the target; HOME -> returning, 4 s later docked; STOP -> idle.
const mqtt = require('mqtt'), zlib = require('zlib');
const T = process.argv[2] || 'valetudo/Bot';
const c = mqtt.connect(process.argv[3] || 'mqtt://127.0.0.1:1883', { will: { topic: T + '/$state', payload: 'lost', retain: true } });
const dock = { x: 1000, y: 1000 };
let pos = { ...dock }, status = 'docked', timer = null;
const pub = (k, v) => c.publish(`${T}/${k}`, v, { retain: true });
const state = (s) => { status = s; pub('StatusStateAttribute/status', s); console.log(new Date().toISOString(), s, pos); };
const map = () => pub('MapData/map-data', zlib.deflateSync(JSON.stringify({ entities: [{ type: 'robot_position', points: [pos.x, pos.y], metaData: { angle: 0 } }] })));
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
