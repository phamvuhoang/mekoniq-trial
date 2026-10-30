// Regression checks for reconnect saves, map identity and broker alerts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const V = require("../data/lib/valetudo");
const O = require("../data/lib/orchestrator");
const seed = require("../data/site.demo.json");
let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("✓ " + name);
  } catch (e) {
    failures++;
    console.error("FAIL " + name + ": " + e.message);
  }
}
const source = fs.readFileSync(
  __dirname + "/../data/public/setup.html",
  "utf8",
);
function setup(savedId) {
  const ctx = {
    D: { rev: 4, name: "draft A" },
    dirty: true,
    saving: true,
    pendingSave: "request-A",
    sentDraft: "",
    App: { site: { rev: 5, name: "saved B", saveRequestId: savedId } },
    robotId: "R1",
    vm: {},
    tab: "robots",
    clone: structuredClone,
    setDirty(v) {
      ctx.dirty = v;
    },
    strips() {},
    render() {},
    curRobot() {
      return { id: "R1" };
    },
    msg(t) {
      ctx.message = t;
    },
    connect(cb) {
      ctx.cb = cb;
    },
  };
  ctx.sentDraft = JSON.stringify(ctx.D);
  vm.createContext(ctx);
  vm.runInContext(
    source.match(/function load\(\) \{[^\n]+/)[0] +
      "\n" +
      source.slice(
        source.lastIndexOf("connect(m => {"),
        source.lastIndexOf("</script>"),
      ),
    ctx,
  );
  ctx.cb({ type: "site", site: ctx.App.site });
  return ctx;
}
test("another save after disconnect preserves draft", () => {
  const c = setup("request-B");
  assert.equal(c.D.name, "draft A");
  assert.equal(c.dirty, true);
  assert.notEqual(c.message, "Đã lưu cấu hình");
});
test("matching request acknowledges save", () => {
  const c = setup("request-A");
  assert.equal(c.dirty, false);
  assert.equal(c.D.rev, 5);
});
test("save request identity survives hello", () => {
  const st = O.init(seed, 1000);
  const result = O.handle(
    st,
    seed,
    {
      source: "ui",
      seed,
      session: "A",
      data: { type: "siteSave", site: seed, requestId: "request-A" },
    },
    2000,
  );
  assert.equal(result.site.saveRequestId, "request-A");
});
test("simulator site has no broker outage alert", () => {
  const st = V.init(seed);
  V.handle(st, seed, { cmd: "link", up: false }, 1000);
  assert.equal(
    V.handle(st, seed, { cmd: "tick" }, 8000).events.some(
      (e) => e.key === "mqtt-down" && e.event === "alert",
    ),
    false,
  );
});
test("removing final real robot resolves existing outage", () => {
  const real = structuredClone(seed);
  real.robots[0].driver = "valetudo";
  real.robots[0].valetudo = { topic: "test/A", points: {} };
  const st = V.init(real);
  V.handle(st, real, { cmd: "link", up: false }, 1000);
  assert(
    V.handle(st, real, { cmd: "tick" }, 8000).events.some(
      (e) => e.event === "alert",
    ),
  );
  assert(
    V.handle(st, seed, { cmd: "tick" }, 9000).events.some(
      (e) => e.key === "mqtt-down" && e.event === "resolve",
    ),
  );
});
test("API refuses map cached under old topic", () => {
  const flow = JSON.parse(fs.readFileSync(__dirname + "/../data/flows.json"));
  const site = {
    robots: [{ id: "R1", driver: "valetudo", valetudo: { topic: "test/B" } }],
  };
  const global = {
    get(k) {
      return k === "site"
        ? site
        : k === "mekoniq"
          ? { seed: site }
          : { topic: "test/A", t: 10 };
    },
  };
  const msg = new Function(
    "msg",
    "global",
    flow.find((n) => n.id === "map_fn").func,
  )({ req: { params: { robot: "R1" } } }, global);
  assert.equal(msg.statusCode, 404);
});
process.exitCode = failures ? 1 : 0;
