/* Static deployment checks for the self-hosted OCR bundle and offline cache. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const assets = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/eng.traineddata.gz'
];

console.log('OCR asset tests');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assets.forEach(asset => {
  const full = path.join(root, asset);
  assert.ok(fs.existsSync(full), `${asset} is missing`);
  assert.ok(fs.statSync(full).size > 1024, `${asset} looks incomplete`);
  assert.ok(sw.includes('./' + asset), `${asset} is not in the offline cache`);
});
assert.ok(html.includes('vendor/tesseract/tesseract.min.js'), 'the local OCR library is not loaded');
assert.ok(!/cdn\.jsdelivr|unpkg\.com/.test(html), 'runtime still depends on a third-party OCR CDN');
console.log(`  ok  - ${assets.length} OCR assets are local and cached`);
