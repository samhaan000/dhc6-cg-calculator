/* Unit tests for the DHC-6 W&B engine.  Run:  node tests/engine.test.js
 * No framework — exits non-zero on first failure so it can gate CI. */
const assert = require('assert');
const cfg = require('../config.js');
const { computeMetrics, indexZone, macInLimit } = require('../engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (e) { console.error('  FAIL- ' + name + '\n        ' + e.message); process.exitCode = 1; }
}
const empty = () => [['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E']];
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

console.log('DHC-6 engine tests');

// --- Hand-computed reference case: DOW 9142 / DOI 13.8, nothing loaded ---
test('empty load at DOW/DOI reproduces the index and weights exactly', () => {
  const m = computeMetrics({ seats: empty(), dow: 9142, doi: 13.8 }, cfg);
  assert.strictEqual(m.tow, 9142);
  assert.strictEqual(m.zfw, 9142);
  assert.strictEqual(m.lw, 9142);
  assert.strictEqual(m.tof, 0);
  assert.strictEqual(m.pax, 0);
  close(m.to.arm, 214.156639, 1e-4);
  close(m.to.index, 13.8);            // empty index == DOI
  close(m.to.mac, 33.226131, 1e-3);
});

// --- Standard passenger weights and seat-row moments ---
test('passenger weights and moment use config arms', () => {
  const seats = empty();
  seats[0][0] = 'M';   // row 1, arm 135
  seats[2][1] = 'M';   // row 3, arm 195
  const m = computeMetrics({ seats, dow: 9142, doi: 13.8, bagD: 300, block: 2000, trip: 400 }, cfg);
  assert.strictEqual(m.pax, 189 + 189);
  assert.strictEqual(m.pm, 189 * 135 + 189 * 195);
  assert.strictEqual(m.bag, 300);
});

// --- Structural invariants must always hold (independent of constants) ---
test('weight relationships are internally consistent', () => {
  const seats = empty();
  seats[1][2] = 'F'; seats[4][0] = 'C';
  const m = computeMetrics({ seats, dow: 9142, doi: 13.8, block: 1500, trip: 300, bagAft: 120, stretcher: 60 }, cfg);
  assert.strictEqual(m.tof, 1500 - cfg.fuel.takeoffOffset);
  assert.strictEqual(m.lf, m.tof - 300);
  assert.strictEqual(m.payload, m.pax + m.bag);
  assert.strictEqual(m.zfw, 9142 + m.payload);
  assert.strictEqual(m.tow, m.zfw + m.tof);
  assert.strictEqual(m.lw, m.tow - 300);
  [m.to.arm, m.to.index, m.to.mac, m.la.arm, m.la.index, m.la.mac].forEach(v => assert.ok(isFinite(v)));
});

// --- No fuel: zero DOW edge case must not divide by zero ---
test('zero DOW yields zero arms, no NaN', () => {
  const m = computeMetrics({ seats: empty(), dow: 0, doi: 0 }, cfg);
  assert.strictEqual(m.to.arm, 0);
  assert.ok(isFinite(m.to.index) && isFinite(m.to.mac));
});

// --- %MAC limit gate (25–32) ---
test('macInLimit respects configured fwd/aft limits', () => {
  assert.strictEqual(macInLimit(25, cfg), true);
  assert.strictEqual(macInLimit(32, cfg), true);
  assert.strictEqual(macInLimit(28.5, cfg), true);
  assert.strictEqual(macInLimit(24.9, cfg), false);
  assert.strictEqual(macInLimit(32.1, cfg), false);
  assert.strictEqual(macInLimit(NaN, cfg), false);
});

// --- Index advisory zones ---
test('indexZone classifies float zones at the configured thresholds', () => {
  assert.strictEqual(indexZone(7.0, cfg).level, 'red');     // fwd limit
  assert.strictEqual(indexZone(8.0, cfg).level, 'amber');   // fwd caution
  assert.strictEqual(indexZone(9.9, cfg).level, 'green');   // normal
  assert.strictEqual(indexZone(12.0, cfg).level, 'amber');  // aft caution
  assert.strictEqual(indexZone(13.0, cfg).level, 'red');    // aft limit
  assert.strictEqual(indexZone(NaN, cfg).level, 'red');
  assert.strictEqual(indexZone(9.9, cfg).name, 'NORMAL FLOAT ZONE');
});

console.log(`\n${passed} passed` + (process.exitCode ? ', with failures' : ''));
