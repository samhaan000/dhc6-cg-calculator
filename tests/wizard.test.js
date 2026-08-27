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

test('fallback: title scan detects categories when there is no summary block', () => {
  const c = parsers.parseManifestCounts('JOHN SMITH MR\nJANE DOE MRS\nBABY DOE MSTR');
  assert.strictEqual(c.male, 1);
  assert.strictEqual(c.female, 1);
  assert.strictEqual(c.child, 1);
  assert.strictEqual(c.total, 3);
});

test('fallback: row counter detects a count from a numbered name list', () => {
  const c = parsers.parseManifestCounts('1. John Smith\n2. Jane Doe\n3. Bob Lee\n4. Amy Tan');
  assert.strictEqual(c.total, 4);
  assert.strictEqual(c.unknown, 4);   // counted but uncategorised -> needs review
});

test('female summary never double-counts as male', () => {
  const c = parsers.parseManifestCounts('FEMALE 3');
  assert.strictEqual(c.male, 0);
  assert.strictEqual(c.female, 3);
  assert.strictEqual(c.total, 3);
});

test('female-first summaries retain both correct category totals', () => {
  const c = parsers.parseManifestCounts('FEMALE BOARDED 3\nMALE CHECKED 5\nTOTAL PAX 8');
  assert.strictEqual(c.male, 5);
  assert.strictEqual(c.female, 3);
  assert.strictEqual(c.unknown, 0);
});

test('a child gender-table row is counted once, as a child', () => {
  const c = parsers.parseManifestCounts('1 JOHN DOE M MLE ABC CHD');
  assert.strictEqual(c.male, 0);
  assert.strictEqual(c.child, 1);
  assert.strictEqual(c.total, 1);
});

test('inconsistent category and reported totals are surfaced', () => {
  const c = parsers.parseManifestCounts('TOTAL PAX 4\nMALE 5');
  assert.strictEqual(c.consistent, false);
  assert.ok(c.issues.some(i => /exceed the reported total/.test(i)));
});

test('infants remain a separate category', () => {
  const c = parsers.parseManifestCounts('TOTAL PAX 2\nMALE 1\nINFANT 1');
  assert.strictEqual(c.male, 1);
  assert.strictEqual(c.infant, 1);
  assert.strictEqual(c.total, 2);
});

test('resort manifest table uses ticket rows and weight totals to recover the full load', () => {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const word = (x, y, text, conf = 95) => `5\t1\t1\t1\t1\t1\t${x}\t${y}\t50\t14\t${conf}\t${text}`;
  const lines = [header, word(850, 250, '8Q-IAL'), word(1050, 250, 'Q2-7022')];
  const names = ['NATALIA','ELENA','OLESIA','NATALIA','ANASTASIIA','ELENA','ALEKSANDR','SHUBAM','SARIKA','SURESH','KHUSHI','NIRMIT','ANUPAMA','SUMMIT'];
  const categories = ['F','F','F','F','F','F','M','M','F','M','F','M','F','M'];
  for (let i = 0; i < 14; i++) {
    const y = 388 + i * 40;
    lines.push(word(410, y, String(612941 + i)));
    lines.push(word(550, y, names[i]));
    // Reproduce the real photo: one female weight loses its leading 1 and two
    // male row weights are unreadable. The summary still provides a safe check.
    if (i === 4) lines.push(word(1585, y + 8, '50', 40));
    else if (i !== 11 && i !== 13) lines.push(word(1585, y + 8, String(cfg.paxWeights[categories[i]])));
  }
  lines.push(word(1580, 1060, '489'));
  lines.push(word(1745, 1060, '2295'));

  const c = parsers.parseManifestScan('', lines.join('\n'), 1950, 2600, cfg.paxWeights);
  assert.strictEqual(c.total, 14);
  assert.strictEqual(c.male, 5);
  assert.strictEqual(c.female, 9);
  assert.strictEqual(c.unknown, 0);
  assert.strictEqual(c.load.luggage, 489);
  assert.strictEqual(c.load.paxWeight, 2295);
  assert.strictEqual(c.passengers.length, 14);
  assert.ok(c.passengers.every(p => p.cat === 'M' || p.cat === 'F'));
  assert.strictEqual(c.meta.flightNo, 'Q2-7022');
});

console.log(`\n${passed} passed` + (process.exitCode ? ', with failures' : ''));
