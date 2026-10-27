// Node-RED settings — same file on Mac and Android/Termux.
// Site map, robots, timings: site.json. Logic: lib/ (restart Node-RED after editing).
module.exports = {
    uiPort: process.env.PORT || 1880,
    uiHost: process.env.HOST || "0.0.0.0",   // 127.0.0.1 to keep it on-device only
    flowFile: "flows.json",
    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || false,
    httpAdminRoot: "/admin",                 // editor; UI pages are served at /
    // Editor login: set NODE_RED_ADMIN_HASH (npx node-red admin hash-pw). Unset = open editor, LAN-visible if HOST=0.0.0.0.
    adminAuth: process.env.NODE_RED_ADMIN_HASH ? { type: "credentials", users: [{ username: "admin", password: process.env.NODE_RED_ADMIN_HASH, permissions: "*" }] } : undefined,
    functionGlobalContext: {
        mekoniq: { orchestrator: require("./lib/orchestrator"), simulator: require("./lib/simulator"), valetudo: require("./lib/valetudo"), seed: require("./site.json"), siteLib: require("./lib/site") }
    },
    // UI pages + the shared route module (lib/route.js is plain CommonJS, also loaded by the map editor).
    httpStatic: [
        { path: require("path").join(__dirname, "public"), root: "/" },
        { path: require("path").join(__dirname, "lib"), root: "/lib/" }
    ],
    // Persist orders/robot state across restarts (survives reboot / crash).
    contextStorage: {
        default: { module: "localfilesystem", config: { flushInterval: 5 } }
    },
    logging: { console: { level: "info", metrics: false, audit: false } },
    editorTheme: { tours: false }
};
