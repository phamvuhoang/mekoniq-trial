// Isolated Node-RED + Mosquitto integration. Requires mosquitto on PATH.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict"),
  zlib = require("node:zlib"),
  mqtt = require("mqtt");
const root = path.resolve(__dirname, ".."),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "robot-review-")),
  children = [],
  clients = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(100);
  }
  throw Error("Timeout: " + label);
}
function run(cmd, args, env = {}) {
  const c = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env } });
  children.push(c);
  for (const stream of [c.stdout, c.stderr])
    stream.on("data", (b) =>
      fs.appendFileSync(path.join(temp, path.basename(cmd) + ".log"), b),
    );
  return c;
}
async function stop(c) {
  if (c.exitCode !== null || c.signalCode !== null) return;
  const done = new Promise((r) => c.once("exit", r));
  c.kill("SIGTERM");
  await done;
}
async function broker() {
  const b = run("mosquitto", ["-c", path.join(temp, "mosquitto.conf")]);
  await sleep(500);
  assert.equal(b.exitCode, null);
  return b;
}
async function pub() {
  const c = mqtt.connect("mqtt://127.0.0.1:1886");
  clients.push(c);
  await new Promise((r, j) => {
    c.once("connect", r);
    c.once("error", j);
  });
  return c;
}
async function publish(c, t, v) {
  await new Promise((r, j) =>
    c.publish(t, v, { retain: true, qos: 1 }, (e) => (e ? j(e) : r())),
  );
}
const map = (x) =>
  zlib.deflateSync(
    Buffer.from(
      JSON.stringify({
        size: { x: 1000, y: 1000 },
        pixelSize: 5,
        layers: [{ type: "floor", compressedPixels: [1, 1, 5] }],
        entities: [
          { type: "robot_position", points: [x, 100] },
          { type: "charger_location", points: [100, 100] },
        ],
      }),
    ),
  );
async function retained(c, t, x) {
  for (const [k, v] of Object.entries({
    $state: "ready",
    "StatusStateAttribute/status": "docked",
    "BatteryStateAttribute/level": "87",
    "WifiConfigurationCapability/ips": "192.168.1.10",
    "WifiConfigurationCapability/ssid": "<b>Test WiFi</b>",
    "WifiConfigurationCapability/signal": "-42",
    "MapData/map-data": map(x),
  }))
    await publish(c, t + "/" + k, v);
}
let ws, site, state;
const send = (d) => ws.send(JSON.stringify({ by: "smoke", ...d }));
async function save(s) {
  const requestId = "smoke-" + Date.now();
  send({ type: "siteSave", site: s, requestId });
  await until(() => site.saveRequestId === requestId, "save");
}
const getMap = () => fetch("http://127.0.0.1:1891/api/map/R1");
async function main() {
  for (const port of [1891, 1886])
    await new Promise((r, j) => {
      const s = require("node:net").createServer();
      s.once("error", j);
      s.listen(port, "127.0.0.1", () => s.close(r));
    });
  fs.cpSync(path.join(root, "data"), path.join(temp, "data"), {
    recursive: true,
    filter: (p) =>
      !["context", "node_modules"].includes(path.basename(p)) &&
      !path.basename(p).startsWith("."),
  });
  fs.copyFileSync(
    path.join(root, "data/site.demo.json"),
    path.join(temp, "data/site.json"),
  );
  const fp = path.join(temp, "data/flows.json"),
    flows = JSON.parse(fs.readFileSync(fp));
  flows.find((n) => n.id === "mqtt_broker").port = "1886";
  fs.writeFileSync(fp, JSON.stringify(flows));
  fs.writeFileSync(
    path.join(temp, "mosquitto.conf"),
    "listener 1886 127.0.0.1\nallow_anonymous true\n",
  );
  let b = await broker();
  run(
    process.execPath,
    [
      path.join(root, "node_modules/node-red/red.js"),
      "-u",
      path.join(temp, "data"),
      "-s",
      path.join(temp, "data/settings.js"),
    ],
    { PORT: "1891", HOST: "127.0.0.1" },
  );
  await until(async () => {
    try {
      return (await fetch("http://127.0.0.1:1891/api/health")).ok;
    } catch {
      return false;
    }
  }, "Node-RED");
  ws = new WebSocket("ws://127.0.0.1:1891/ws");
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "site") site = m.site;
    if (m.type === "state") state = m;
  };
  await new Promise((r) => (ws.onopen = r));
  send({ type: "hello" });
  await until(() => site && state, "hello");
  await stop(b);
  await sleep(6500);
  assert(!state.alerts.some((a) => a.key === "mqtt-down"));
  console.log("✓ simulator broker outage silent");
  b = await broker();
  const c = await pub();
  await retained(c, "review/A", 110);
  const real = structuredClone(site);
  real.robots[0].driver = "valetudo";
  real.robots[0].valetudo = { topic: "review/A", points: {} };
  await save(real);
  await until(async () => {
    const h = await (await fetch("http://127.0.0.1:1891/api/health")).json();
    return (
      h.robots.R1?.battery === 87 &&
      h.robots.R1?.wifi?.ssid === "<b>Test WiFi</b>" &&
      h.robots.R1.mapAt > 0
    );
  }, "retained");
  assert.equal((await (await getMap()).json()).topic, "review/A");
  console.log("✓ late robot gets retained status, battery, Wi-Fi, map");
  // Redeploy only mqtt_in: the adapter context survives this operation.
  const admin = await (await fetch("http://127.0.0.1:1891/admin/flows")).json();
  admin.find((n) => n.id === "mqtt_in").name += " smoke redeploy";
  const deployed = await fetch("http://127.0.0.1:1891/admin/flows", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Node-RED-Deployment-Type": "nodes",
    },
    body: JSON.stringify(admin),
  });
  assert(deployed.ok);
  await sleep(1500);
  await publish(c, "review/A/BatteryStateAttribute/level", "86");
  await until(async () => {
    const h = await (await fetch("http://127.0.0.1:1891/api/health")).json();
    return h.robots.R1?.battery === 86;
  }, "subscription after mqtt node redeploy");
  console.log("✓ MQTT-only redeploy restores subscriptions");
  const changed = structuredClone(site);
  changed.robots[0].valetudo.topic = "review/B";
  await save(changed);
  assert.equal((await getMap()).status, 404);
  console.log("✓ topic change invalidates old map");
  await retained(c, "review/B", 220);
  await until(async () => (await getMap()).ok, "new map");
  assert.equal((await (await getMap()).json()).topic, "review/B");
  await publish(c, "review/A/MapData/map-data", map(999));
  await sleep(600);
  assert.equal((await (await getMap()).json()).topic, "review/B");
  console.log("✓ removed topic cannot overwrite map");
  await stop(b);
  await until(() => state.alerts.some((a) => a.key === "mqtt-down"), "outage");
  const sim = structuredClone(site);
  delete sim.robots[0].driver;
  delete sim.robots[0].valetudo;
  await save(sim);
  await until(
    () => !state.alerts.some((a) => a.key === "mqtt-down"),
    "resolve",
  );
  console.log("✓ real outage alerts; last real robot removal resolves");
  b = await broker();
  send({ type: "siteReset", requestId: "reset-smoke" });
  await until(() => site.saveRequestId === "reset-smoke", "reset");
  const smoke = run(process.execPath, [
    "scripts/smoke-test.js",
    "ws://127.0.0.1:1891/ws",
  ]);
  assert.equal(await new Promise((r) => smoke.once("exit", r)), 0);
  console.log("✓ live delivery kitchen → T01 round trip");
  console.log("SMOKE_OK", temp);
  if (process.env.SMOKE_HOLD) {
    console.log("HOLD for browser tests");
    await new Promise((r) => process.once("SIGTERM", r));
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ws) ws.close();
    for (const c of clients) c.end(true);
    for (const c of children.reverse()) await stop(c);
    console.log("Logs:", temp);
  });
