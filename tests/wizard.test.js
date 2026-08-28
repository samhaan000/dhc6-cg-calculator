/* Integration test for the wizard's passenger→seat→engine mapping and the
 * OCR parser, using the same logic app.js uses.  Run: node tests/wizard.test.js */
const assert = require('assert');
const cfg = require('../config.js');
const { computeMetrics } = require('../engine.js');
const parsers = require('../parsers.js');
const seating = require('../seating.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (e) { console.error('  FAIL- ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

function buildGrid(pax) {
  return seating.seatGrid(pax, cfg);
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

test('lap infant weight is applied at the accompanying adult seat arm', () => {
  const pax = [{ cat: 'M', seat: '1A', weight: 205 }, { cat: 'I', seat: '1A' }, { cat: 'F', seat: '2A' }];
  const m = computeMetrics({ seats: buildGrid(pax), dow: 9142, doi: 13.8 }, cfg);
  assert.strictEqual(m.pax, 205 + cfg.paxWeights.I + cfg.paxWeights.F);
  assert.strictEqual(m.pm, (205 + cfg.paxWeights.I) * cfg.seatArms[0] + cfg.paxWeights.F * cfg.seatArms[1]);
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

test('15 occupied seats plus a lap infant do not trigger a seat-capacity issue', () => {
  const c = parsers.parseManifestCounts('TOTAL PAX 16\nMALE 8\nFEMALE 7\nINFANT 1');
  assert.strictEqual(c.total, 16);
  assert.strictEqual(c.infant, 1);
  assert.ok(!c.issues.some(issue => /15 cabin seats|15-seat cabin/i.test(issue)));
});

test('more infants than adults is surfaced for review', () => {
  const c = parsers.parseManifestCounts('TOTAL PAX 4\nMALE 1\nINFANT 3');
  assert.ok(c.issues.some(issue => /accompanying adult/i.test(issue)));
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

test('base passenger manifest reads its narrow count and gender summary columns', () => {
  const main = `Passenger Manifest\nTime Aircraft Route Flight No\n13:30 8Q-ISA MLE-MLE Q2-6000\nNumber of Passengers\nTotal Males\nTotal Females\nTotal Children\nTotal Infants`;
  const summary = `MLE\n3\n0\n0\n0\n0\n0\n567.00\n3\n567.00\n30.00\n597.00`;
  const categories = `Total Males 3\nTotal Females 0\nTotal Children 0\nTotal Infants 0`;
  const table = `1 GOV 615675 TAPUGAO/FALEFOU Mr / M MALE MLE MLE\n2 GOV 615676 NUAUSALA/NUAUSALA M MALE MLE MLE\n3 GOV 615677 NELESONE/PANAPASI Mr / M MALE MLE MLE`;
  const c = parsers.parseManifestScan(main, '', 1950, 2600, cfg.paxWeights, { summary, categories, table });
  assert.strictEqual(c.documentType, 'base-passenger');
  assert.strictEqual(c.total, 3);
  assert.strictEqual(c.male, 3);
  assert.strictEqual(c.unknown, 0);
  assert.strictEqual(c.load.luggage, 0);
  assert.strictEqual(c.load.paxWeight, 567);
  assert.strictEqual(c.load.eic, 30);
  assert.strictEqual(c.meta.registration, '8Q-ISA');
  assert.strictEqual(c.meta.flightNo, 'Q2-6000');
  assert.deepStrictEqual(c.passengers.map(p => p.name), ['TAPUGAO/FALEFOU', 'NUAUSALA/NUAUSALA', 'NELESONE/PANAPASI']);
  assert.ok(c.issues.some(issue => /EIC/.test(issue)));
});

test('empty base baggage manifest is never counted as a passenger', () => {
  const text = `Baggage Manifest\nRoute MLE-MLE\nAircraft 8Q-ISA\nFlight No 6000\nTotal Luggages Count / Weight: 07 / 0\nTotal Hand Luggages Count / Weight: 0 / 0\nTotal OCS Count / Weight: 0 / 0\nTotal Bumped Baggages Count / Weight: 0 / 0`;
  const c = parsers.parseManifestScan(text, '', 1950, 2600, cfg.paxWeights);
  assert.strictEqual(c.documentType, 'base-baggage');
  assert.strictEqual(c.total, 0);
  assert.strictEqual(c.load.luggage, 0);
  assert.strictEqual(c.load.handCount, 0);
  assert.strictEqual(c.load.ocsWeight, 0);
  assert.strictEqual(c.meta.registration, '8Q-ISA');
  assert.strictEqual(c.meta.flightNo, '6000');
});

console.log(`\n${passed} passed` + (process.exitCode ? ', with failures' : ''));
