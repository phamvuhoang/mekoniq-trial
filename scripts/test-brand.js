const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../data/public');
for (const name of ['index', 'setup', 'station', 'robot', 'table', 'map']) {
  const html = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
  let previous = -1;
  for (const file of ['brand/tokens.css', 'brand/fonts.css', 'brand/components.css', 'brand.css']) {
    const next = html.indexOf('href="' + file + '"');
    assert.ok(next > previous, name + ': missing or unordered ' + file);
    previous = next;
  }
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), name + ': remote font');
  assert.ok(!html.includes('MEKONI<span>Q</span>'), name + ': synthetic wordmark');
}
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
assert.equal(hash('logo.svg'), hash('brand/assets/MEKONIQ_Icon_Transparent.svg'));
require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'check-brand.cjs'), '--dir', path.join(root, 'brand')], {stdio: 'inherit'});
console.log('BRAND_STATIC_OK: six screens, ordered local styles, original favicon, release checksums');
