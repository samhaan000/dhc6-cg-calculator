const assert = require('assert');
const cfg = require('../config.js');
const engine = require('../engine.js');
const seating = require('../seating.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (error) { console.error('  FAIL- ' + name + '\n        ' + error.message); process.exitCode = 1; }
}

function baseInput(overrides) {
  return Object.assign({
    seats: [['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E']],
    dow: 9142, doi: 13.8, block: 1800, trip: 350,
    stretcher: 0, bagR4: 0, bagR5: 0, bagD: 0, bagAft: 0, bagShelf: 0
  }, overrides || {});
}

function passengers(male, female, child, infant) {
  const list = [];
  [['M', male], ['F', female], ['C', child], ['I', infant]].forEach(([cat, count]) => {
    for (let i = 0; i < count; i++) list.push({ id: `${cat}${i}`, cat, name: '', seat: '' });
  });
  return list;
}

function frontLoaded(list) {
  const seats = [];
  for (let row = 1; row <= 5; row++) for (const col of ['A', 'B', 'C']) seats.push(`${row}${col}`);
  return list.map((passenger, index) => Object.assign({}, passenger, { seat: seats[index] }));
}

function metrics(list, input) {
  return engine.computeMetrics(Object.assign({}, input, { seats: seating.seatGrid(list, cfg) }), cfg);
}

console.log('Seat optimizer tests');

test('10-pax manifest is assigned to 10 unique valid seats', () => {
  const list = passengers(3, 7, 0, 0);
  const result = seating.optimize(list, baseInput({ bagD: 489 }), cfg, engine);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.passengers.length, 10);
  const labels = result.passengers.map(p => p.seat);
  assert.strictEqual(new Set(labels).size, 10);
  assert.ok(labels.every(label => /^[1-5][ABC]$/.test(label)));
  assert.strictEqual(result.passengers.filter(p => p.cat === 'M').length, 3);
  assert.strictEqual(result.passengers.filter(p => p.cat === 'F').length, 7);
});

test('optimization improves a front-loaded cabin for the complete load', () => {
  const list = passengers(3, 5, 0, 0);
  const input = baseInput({ bagD: 180, block: 2000, trip: 400 });
  const before = metrics(frontLoaded(list), input);
  const result = seating.optimize(list, input, cfg, engine);
  const midpoint = (cfg.limits.cgFwd + cfg.limits.cgAft) / 2;
  const beforeDistance = Math.abs(before.to.mac - midpoint) + Math.abs(before.la.mac - midpoint);
  const afterDistance = Math.abs(result.metrics.to.mac - midpoint) + Math.abs(result.metrics.la.mac - midpoint);
  assert.ok(afterDistance < beforeDistance, `expected ${afterDistance} < ${beforeDistance}`);
});

test('aft baggage makes the optimizer choose a more forward passenger moment', () => {
  const list = passengers(5, 5, 0, 0);
  const noBag = seating.optimize(list, baseInput(), cfg, engine);
  const aftBag = seating.optimize(list, baseInput({ bagAft: 350 }), cfg, engine);
  assert.ok(aftBag.metrics.pm < noBag.metrics.pm, `expected ${aftBag.metrics.pm} < ${noBag.metrics.pm}`);
});

test('preferred takeoff index moves the cabin toward the pilot target', () => {
  const list = passengers(3, 7, 0, 0);
  const input = baseInput({ bagD: 150 });
  const forward = seating.optimize(list, input, cfg, engine, { preferredIndex: 9.0 });
  const aft = seating.optimize(list, input, cfg, engine, { preferredIndex: 10.5 });
  assert.strictEqual(forward.preferredIndex, 9);
  assert.strictEqual(aft.preferredIndex, 10.5);
  assert.ok(forward.metrics.to.index < aft.metrics.to.index, `expected ${forward.metrics.to.index} < ${aft.metrics.to.index}`);
  assert.ok(Math.abs(forward.achievedIndex - 9) < 0.1);
  assert.ok(Math.abs(aft.achievedIndex - 10.5) < 0.1);
});

test('preferred index never outranks configured safety zones', () => {
  const list = passengers(3, 7, 0, 0);
  const result = seating.optimize(list, baseInput({ bagD: 150 }), cfg, engine, { preferredIndex: cfg.indexZones.max });
  assert.notStrictEqual(engine.indexZone(result.metrics.to.index, cfg).level, 'red');
  assert.notStrictEqual(engine.indexZone(result.metrics.la.index, cfg).level, 'red');
  assert.ok(engine.macInLimit(result.metrics.to.mac, cfg));
  assert.ok(engine.macInLimit(result.metrics.la.mac, cfg));
});

test('actual passenger weights are preserved', () => {
  const list = passengers(2, 2, 0, 0);
  list[0].weight = 225;
  const result = seating.optimize(list, baseInput(), cfg, engine);
  assert.strictEqual(result.passengers.find(p => p.id === list[0].id).weight, 225);
  assert.strictEqual(result.metrics.pax, 225 + cfg.paxWeights.M + 2 * cfg.paxWeights.F);
});

test('lap infant shares an adult seat and does not consume another seat', () => {
  const list = passengers(2, 2, 0, 1);
  const result = seating.optimize(list, baseInput(), cfg, engine);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.passengers.length, 5);
  const occupants = result.passengers.filter(p => p.cat !== 'I');
  const infant = result.passengers.find(p => p.cat === 'I');
  assert.strictEqual(new Set(occupants.map(p => p.seat)).size, 4);
  assert.ok(occupants.some(p => (p.cat === 'M' || p.cat === 'F') && p.seat === infant.seat));
  assert.strictEqual(result.metrics.pax, 2 * cfg.paxWeights.M + 2 * cfg.paxWeights.F + cfg.paxWeights.I);
});

test('15 occupied seats can carry a lap infant without a sixteenth seat', () => {
  const list = passengers(8, 7, 0, 1);
  const result = seating.optimize(list, baseInput(), cfg, engine);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(new Set(result.passengers.filter(p => p.cat !== 'I').map(p => p.seat)).size, 15);
  assert.ok(result.passengers.find(p => p.cat === 'I').seat);
});

test('one adult cannot be assigned multiple lap infants', () => {
  const result = seating.optimize(passengers(1, 0, 0, 2), baseInput(), cfg, engine);
  assert.strictEqual(result.changed, false);
  assert.match(result.reason, /each infant/i);
});

test('unclear categories block CG optimization instead of being guessed', () => {
  const list = passengers(2, 1, 0, 0);
  list.push({ id: 'unknown', cat: '?', seat: '' });
  const result = seating.optimize(list, baseInput(), cfg, engine);
  assert.strictEqual(result.changed, false);
  assert.match(result.reason, /incomplete/i);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : ''));
