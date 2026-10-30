// Installer step, after Node-RED has exited and before replacing data/site.json.
// Keep the effective config even on installations that have never saved setup.html.
const fs = require('node:fs'), path = require('node:path');
const app = process.argv[2];
if (!app) throw Error('Usage: node scripts/preserve-site.js <installed-app-directory>');
const seed = path.join(app, 'site.json'), file = path.join(app, 'context/global/global.json');
const context = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!context || typeof context !== 'object' || Array.isArray(context)) throw Error('Invalid global context; upgrade stopped');
if (!context.site && fs.existsSync(seed)) {
  const site = JSON.parse(fs.readFileSync(seed, 'utf8'));
  if (!site || typeof site !== 'object' || !site.points || !Array.isArray(site.robots)) throw Error('Invalid installed site; upgrade stopped');
  // Keep the original policy version so the normal runtime migration explains it to the manager.
  context.site = site;
  fs.copyFileSync(seed, seed + '.old');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.upgrade-tmp';
  fs.writeFileSync(tmp, JSON.stringify(context), { mode: 0o600 });
  fs.renameSync(tmp, file);
  console.log('Đã giữ cấu hình đang dùng trước khi nâng cấp (bản sao: site.json.old).');
}
