/* Headless smoke test: loads the real page in jsdom and drives the wizard,
 * failing on any uncaught runtime error. Run: node tests/smoke.test.js
 * Skips gracefully if jsdom isn't installed. */
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) { console.log('smoke test skipped (jsdom not installed)'); process.exit(0); }

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (e) { console.error('  FAIL- ' + name + '\n        ' + (e && e.stack || e)); process.exitCode = 1; }
}

const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
const document = window.document;
window.scrollTo = () => {};
window.print = () => {};
window.confirm = () => true;

const errors = [];
window.addEventListener('error', e => errors.push(e.error || e.message));

// run the app's scripts in page order, in the window realm
['config.js', 'engine.js', 'seating.js', 'parsers.js', 'app.js'].forEach(f => window.eval(read(f)));
// jsdom outside-only keeps readyState 'loading', so fire the ready event the app waits on
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const $ = id => document.getElementById(id);
const q = sel => document.querySelector(sel);
const qa = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
function setVal(el, v) { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); }
function changeVal(el, v) { el.value = v; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function actionBtn(a) { return q('[data-action="' + a + '"]'); }

console.log('Wizard smoke test (jsdom)');

test('app boots and renders the dashboard', () => {
  if (!$('view')) throw new Error('#view missing');
  if (!/Aircraft/.test($('view').innerHTML)) throw new Error('dashboard not rendered');
  if (!$('stepper').innerHTML) throw new Error('stepper empty');
  if (!$('nav').innerHTML) throw new Error('nav empty');
  if (!q('[role="progressbar"]') || !q('[aria-current="step"]')) throw new Error('accessible progress status missing');
});

test('progressive validation explains missing required aircraft data', () => {
  click(actionBtn('next'));
  if (!$('stepErrorSummary') || !/DOW/.test($('stepErrorSummary').textContent) || !/DOI/.test($('stepErrorSummary').textContent)) throw new Error('required-field summary missing');
  if (!q('[data-bind="aircraft.dow"][aria-invalid="true"]')) throw new Error('invalid field is not identified');
  if (!/Aircraft setup/.test($('view').innerHTML)) throw new Error('advanced despite missing aircraft data');
});

test('entering aircraft data updates state and stats', () => {
  setVal(q('[data-bind="aircraft.dow"]'), '9142');
  setVal(q('[data-bind="aircraft.doi"]'), '13.8');
  setVal(q('[data-bind="aircraft.reg"]'), '8Q-ABC');
  if (!/9,142/.test($('view').innerHTML) && !/9142/.test($('view').innerHTML)) throw new Error('DOW not reflected');
});

test('scan step offers both camera and upload, and runs safely with no file', () => {
  click(actionBtn('goScan'));
  if (!actionBtn('takePhoto') || !actionBtn('chooseFile')) throw new Error('missing camera/upload buttons');
  if (!$('camInput') || !$('fileInput')) throw new Error('missing camera + file inputs');
  if ($('fileInput').hasAttribute('capture')) throw new Error('upload input must not force camera');
  click(actionBtn('runOcr'));   // no file selected -> message only, no crash
});

test('detected passenger categories and load values are editable', () => {
  setVal($('ocrText'), 'TOTAL PAX 10\nMALE 3\nFEMALE 7\nLUGGAGE 489');
  click(actionBtn('parseOcrText'));
  const male = q('[data-scan-bind="male"]');
  const female = q('[data-scan-bind="female"]');
  if (!male || !female || !q('[data-scan-load-bind="luggage"]')) throw new Error('editable scan fields missing');
  setVal(male, '2');
  if ($('scanTotal').textContent !== '9') throw new Error('edited categories did not update total');
  if (actionBtn('useScan').disabled) throw new Error('valid edited scan cannot be imported');
});

test('review step has a tappable seat map', () => {
  click(actionBtn('goReview'));   // scan -> review
  if (!/Who is travelling\?|Balanced cabin/.test($('view').innerHTML)) throw new Error('not on seating step');
  if (!q('[data-action="cycleSeat"]')) throw new Error('no seat map');
  if (!q('[data-cat-count="M"]') || !actionBtn('optimizeSeats')) throw new Error('manual totals or optimizer missing');
  if (!q('[data-preferred-index]') || !q('[data-action="setPreferredIndex"]')) throw new Error('preferred index control missing');
});

test('tapping a seat adds a passenger and cycles its category', () => {
  const seat = s => q('[data-action="cycleSeat"][data-seat="' + s + '"]');
  click(seat('1A'));   // empty -> Male
  if (!q('.paxrow')) throw new Error('passenger not created by tap');
  if (!/\bcat-M\b/.test($('view').innerHTML)) throw new Error('not Male after first tap');
  click(seat('1A'));   // Male -> Female
  if (!/\bcat-F\b/.test($('view').innerHTML)) throw new Error('did not cycle to Female');
  click(seat('2B'));   // add a second passenger
  if (!q('[data-bind="pax.0.weight"]')) throw new Error('no weight input in list');
});

test('seat optimizer action keeps every passenger in a unique seat', () => {
  setVal(q('[data-preferred-index]'), '9.5');
  click(actionBtn('optimizeSeats'));
  const occupied = qa('.seat-tile:not(.empty)');
  if (occupied.length !== 2) throw new Error('optimizer lost or duplicated a passenger');
  if (new Set(occupied.map(el => el.getAttribute('data-seat'))).size !== 2) throw new Error('optimizer reused a seat');
  if (!/9\.5/.test(q('.index-target-value').textContent)) throw new Error('preferred index was not retained');
});

test('adding an infant keeps the occupied-seat count unchanged', () => {
  changeVal(q('[data-cat-count="I"]'), '1');
  const occupied = qa('.seat-tile:not(.empty)');
  if (occupied.length !== 2) throw new Error('lap infant consumed a separate seat');
  if (!q('.seat-lap')) throw new Error('lap infant is not shown with an adult seat');
  if (!/3 pax/.test($('reviewChip').textContent) || !/2 seats/.test($('reviewChip').textContent)) throw new Error('passenger/seat totals are wrong');
});

test('extra cabin crew is separate from passenger totals and occupies a seat', () => {
  const toggle = q('[data-extra-crew]');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  const occupied = qa('.seat-tile:not(.empty)');
  if (occupied.length !== 3) throw new Error('extra cabin crew did not occupy one seat');
  if (!q('.seat-tile.crew') || !/CC/.test(q('.seat-tile.crew').textContent)) throw new Error('cabin crew seat is not identified');
  if (!/3 pax/.test($('reviewChip').textContent) || !/1 crew/.test($('reviewChip').textContent) || !/3 seats/.test($('reviewChip').textContent)) throw new Error('crew/passenger totals are wrong');
});

test('per-passenger weight override works', () => {
  const wt = q('[data-bind="pax.0.weight"]');
  setVal(wt, '205');
  if (wt.value !== '205') throw new Error('weight override not set');
});

test('cargo & fuel step accepts fuel/baggage', () => {
  click(actionBtn('next'));   // review -> cargo
  click(actionBtn('next'));   // required block fuel is still missing
  if (!$('stepErrorSummary') || !/block fuel/i.test($('stepErrorSummary').textContent)) throw new Error('missing fuel was not explained');
  if (!/Departure load/.test($('view').innerHTML)) throw new Error('advanced despite missing fuel');
  setVal(q('[data-bind="fuel.block"]'), '2000');
  setVal(q('[data-bind="fuel.trip"]'), '400');
  setVal(q('[data-bind="cargo.bagD"]'), '150');
  if (!q('.live')) throw new Error('running totals not shown');
});

test('results step shows a status banner and CG envelope chart', () => {
  click(actionBtn('next'));   // cargo -> results
  const html = $('view').innerHTML;
  if (!/(WITHIN LIMITS|OUT OF LIMITS|CAUTION|REVIEW REQUIRED|UNVERIFIED DATA)/.test(html)) throw new Error('no status banner');
  if (!q('svg.chart')) throw new Error('no CG envelope chart');
  if (!/% MAC/.test(html)) throw new Error('no %MAC output');
  if (!q('.seat-tile.ro')) throw new Error('no read-only cabin layout on results');
  if (!/Preferred TO index/.test(html) || !/Achieved/.test(html)) throw new Error('preferred/achieved index summary missing');
  if (!/1 crew/.test(html)) throw new Error('extra cabin crew missing from results');
  if (qa('.edit-actions [data-action="goto"]').length !== 3) throw new Error('results cannot be edited by section');
});

test('export builds a load sheet without error', () => {
  const btn = actionBtn('exportPdf');
  if (btn && !btn.disabled) click(btn);
  // if disabled, that is valid (data incomplete) — just ensure no crash
});

test('New Flight from results clears the previous loading', () => {
  click(actionBtn('newFlight'));
  if (!/Aircraft setup/.test($('view').innerHTML)) throw new Error('did not return to dashboard');
  if (!/Pax<\/span><b class="v num">0<\/b>/.test($('view').innerHTML)) throw new Error('passengers were not cleared');
});

test('no uncaught runtime errors during the flow', () => {
  if (errors.length) throw new Error(errors.length + ' error(s): ' + errors.map(String).join(' | '));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : ''));
