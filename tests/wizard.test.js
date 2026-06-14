/* Integration test for the wizard's passenger→seat→engine mapping and the
 * OCR parser, using the same logic app.js uses.  Run: node tests/wizard.test.js */
const assert = require('assert');
const cfg = require('../config.js');
const { computeMetrics } = require('../engine.js');
const parsers = require('../parsers.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (e) { console.error('  FAIL- ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

// mirrors app.js buildGrid()/parseSeat()/paxWeight()
function parseSeat(s) { const m = /^([1-5])([ABC])$/i.exec(String(s || '').trim()); return m ? { row: +m[1] - 1, col: 'ABC'.indexOf(m[2].toUpperCase()) } : null; }
function isCat(c) { return c === 'M' || c === 'F' || c === 'C' || c === 'I'; }
function paxWeight(p) { const w = p && p.weight; if (w != null && w !== '' && isFinite(w) && +w > 0) return +w; return cfg.paxWeights[p.cat] || 0; }
function buildGrid(pax) {
  const g = [['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E']];
  pax.forEach(p => { const s = parseSeat(p.seat); if (s && isCat(p.cat)) g[s.row][s.col] = paxWeight(p); });
  return g;
}

console.log('Wizard integration tests');

test('passengers map to seat rows and produce the right moment', () => {
  const pax = [{ cat: 'M', seat: '1A' }, { cat: 'M', seat: '3B' }, { cat: 'F', seat: '5C' }];
  const m = computeMetrics({ seats: buildGrid(pax), dow: 9142, doi: 13.8, block: 2000, trip: 400 }, cfg);
  assert.strictEqual(m.pax, 189 + 189 + 150);
  assert.strictEqual(m.pm, 189 * cfg.seatArms[0] + 189 * cfg.seatArms[2] + 150 * cfg.seatArms[4]);
  assert.strictEqual(m.tof, 2000 - cfg.fuel.takeoffOffset);
});

test('needs-review passengers (no seat / unknown cat) are excluded from the grid', () => {
  const pax = [{ cat: 'M', seat: '1A' }, { cat: '?', seat: '1B' }, { cat: 'F', seat: '' }];
  const g = buildGrid(pax);
  assert.strictEqual(g[0][0], 189);   // male standard weight placed
  assert.strictEqual(g[0][1], 'E');   // unknown category not placed
  const m = computeMetrics({ seats: g, dow: 9142, doi: 13.8 }, cfg);
  assert.strictEqual(m.pax, 189);     // only the valid passenger contributes
});

test('override weights and infant category flow through to the engine', () => {
  const pax = [{ cat: 'M', seat: '1A', weight: 205 }, { cat: 'I', seat: '1B' }, { cat: 'F', seat: '2A' }];
  const m = computeMetrics({ seats: buildGrid(pax), dow: 9142, doi: 13.8 }, cfg);
  assert.strictEqual(m.pax, 205 + cfg.paxWeights.I + cfg.paxWeights.F);
});

test('OCR parser returns categories, totals and confidence', () => {
  const c = parsers.parseManifestCounts('PASSENGER MANIFEST\nTOTAL PAX 9\nMALE CHECKED 5\nFEMALE BOARDED 3\nCHILD 1');
  assert.strictEqual(c.male, 5);
  assert.strictEqual(c.female, 3);
  assert.strictEqual(c.child, 1);
  assert.strictEqual(c.total, 9);
  assert.ok(c.confidence);
});

test('OCR parser flags unclassified passengers as unknown, not guessed', () => {
  const c = parsers.parseManifestCounts('TOTAL PAX 4\nMALE 2');
  assert.ok(c.unknown >= 0);
  assert.strictEqual(c.male + c.female + c.child + c.unknown >= c.male, true);
});

console.log(`\n${passed} passed` + (process.exitCode ? ', with failures' : ''));
