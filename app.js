/* ============================================================================
 * DHC-6 CG Calculator — wizard controller (UI only)
 * Flow: Dashboard → Scan → Review & Correction → Cargo & Fuel → Results
 * Calculation lives in engine.js (WBEngine) with data from config.js
 * (DHC6_CONFIG). OCR text parsing lives in parsers.js (WBParsers).
 * ========================================================================== */
(function () {
  'use strict';
  var CFG = window.DHC6_CONFIG, ENG = window.WBEngine, PARSE = window.WBParsers, SEATING = window.WBSeating;

  var STEPS = ['Setup', 'Manifest', 'Seating', 'Load', 'CG'];
  var SEATS = (function () { var a = [], r, c, C = ['A', 'B', 'C']; for (r = 1; r <= 5; r++) for (c = 0; c < 3; c++) a.push(r + C[c]); return a; })();
  var CAT_LABEL = { M: 'Male', F: 'Female', C: 'Child', I: 'Infant', '?': 'Needs review' };
  function isCat(c) { return c === 'M' || c === 'F' || c === 'C' || c === 'I'; }
  var STATE_KEY = 'dhc6_flight_v3', LEGACY_STATE_KEY = 'dhc6_flight_v2', PRESET_KEY = 'dhc6_aircraft_presets_v1';

  var state = {
    step: 0,
    aircraft: { reg: '', dow: 0, doi: 0 },
    flight: { no: '', route: '', remarks: '' },
    fuel: { block: 0, trip: 0 },
    cargo: { stretcher: 0, bagR4: 0, bagR5: 0, bagD: 0, bagAft: 0, bagShelf: 0 },
    pax: [],
    ocrText: ''
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }
  function num(x) { var v = parseFloat(x); return isFinite(v) ? v : 0; }
  function f(x, d) { return Number(x || 0).toLocaleString(undefined, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function parseSeat(s) { var m = /^([1-5])([ABC])$/i.exec(String(s || '').trim()); return m ? { row: +m[1] - 1, col: 'ABC'.indexOf(m[2].toUpperCase()) } : null; }
  function paxWeight(p) { var w = p && p.weight; if (w != null && w !== '' && isFinite(w) && +w > 0) return +w; return CFG.paxWeights[p.cat] || 0; }
  function categoryCounts() {
    var counts = { M: 0, F: 0, C: 0, I: 0, '?': 0 };
    state.pax.forEach(function (passenger) { counts.hasOwnProperty(passenger.cat) ? counts[passenger.cat]++ : counts['?']++; });
    return counts;
  }

  /* ---------- persistence ---------- */
  function save() {
    try {
      var safeState = JSON.parse(JSON.stringify(state));
      safeState.ocrText = ''; // never persist manifest OCR text
      sessionStorage.setItem(STATE_KEY, JSON.stringify(safeState));
    } catch (e) {}
  }
  function load() {
    try {
      var raw = sessionStorage.getItem(STATE_KEY) || localStorage.getItem(LEGACY_STATE_KEY);
      var saved = JSON.parse(raw || 'null');
      if (saved && saved.aircraft) {
        state.aircraft = Object.assign(state.aircraft, saved.aircraft || {});
        state.flight = Object.assign(state.flight, saved.flight || {});
        state.fuel = Object.assign(state.fuel, saved.fuel || {});
        state.cargo = Object.assign(state.cargo, saved.cargo || {});
        state.pax = Array.isArray(saved.pax) ? saved.pax : [];
        state.step = 0;
      }
      localStorage.removeItem(LEGACY_STATE_KEY);
    } catch (e) {}
  }
  function presets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (e) { return {}; } }
  function savePresets(p) { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); }

  /* ---------- calculation glue ---------- */
  function buildGrid() {
    var g = [['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E']];
    state.pax.forEach(function (p) { var s = parseSeat(p.seat); if (s && isCat(p.cat)) g[s.row][s.col] = paxWeight(p); });
    return g;
  }
  function engineInput() {
    var a = state.aircraft, fu = state.fuel, c = state.cargo;
    return { seats: buildGrid(), dow: num(a.dow), doi: num(a.doi), block: num(fu.block), trip: num(fu.trip), stretcher: num(c.stretcher), bagD: num(c.bagD), bagAft: num(c.bagAft), bagShelf: num(c.bagShelf), bagR5: num(c.bagR5), bagR4: num(c.bagR4) };
  }
  function compute() {
    var input = engineInput();
    var m = ENG.computeMetrics(input, CFG);
    var issues = [];
    var a = state.aircraft;
    if (!(num(a.dow) > 0)) issues.push({ level: 'red', text: 'Enter aircraft DOW.' });
    if (num(a.doi) === 0) issues.push({ level: 'red', text: 'Enter aircraft DOI.' });
    if (!(num(state.fuel.block) > 0)) issues.push({ level: 'red', text: 'Enter block fuel.' });
    if (!state.pax.length) issues.push({ level: 'amber', text: 'No passengers added.' });

    if (ENG.validateInput) {
      ENG.validateInput(input, CFG).forEach(function (issue) { issues.push({ level: 'red', text: issue.text }); });
    }
    state.pax.forEach(function (p) {
      if (p.weight !== '' && p.weight != null && num(p.weight) <= 0) issues.push({ level: 'red', text: 'Passenger weight overrides must be greater than zero.' });
    });

    var seatUse = {}, dup = false;
    var needReview = state.pax.filter(function (p) {
      var ok = isCat(p.cat) && parseSeat(p.seat);
      if (p.seat) { if (seatUse[p.seat]) dup = true; seatUse[p.seat] = 1; }
      return !ok;
    });
    if (needReview.length) issues.push({ level: 'red', text: needReview.length + ' passenger(s) need a category and a valid seat.' });
    if (dup) issues.push({ level: 'red', text: 'Two passengers share the same seat.' });

    var tz = ENG.indexZone(m.to.index, CFG), lz = ENG.indexZone(m.la.index, CFG);
    var toMacOk = ENG.macInLimit(m.to.mac, CFG), laMacOk = ENG.macInLimit(m.la.mac, CFG);
    if (m.tow > CFG.limits.mtow) issues.push({ level: 'red', text: 'Takeoff weight ' + f(m.tow) + ' exceeds MTOW ' + f(CFG.limits.mtow) + ' lb.' });
    if (m.lf < 0) issues.push({ level: 'red', text: 'Landing fuel is negative.' });
    if (num(state.fuel.block) > 0) {
      if (!toMacOk) issues.push({ level: 'red', text: 'Takeoff %MAC ' + f(m.to.mac, 2) + '% outside ' + CFG.limits.cgFwd + '–' + CFG.limits.cgAft + '%.' });
      if (!laMacOk) issues.push({ level: 'red', text: 'Landing %MAC ' + f(m.la.mac, 2) + '% outside limits.' });
      if (tz.level === 'red') issues.push({ level: 'red', text: 'Takeoff: ' + tz.name + '.' }); else if (tz.level === 'amber') issues.push({ level: 'amber', text: 'Takeoff: ' + tz.name + '.' });
      if (lz.level === 'red') issues.push({ level: 'red', text: 'Landing: ' + lz.name + '.' }); else if (lz.level === 'amber') issues.push({ level: 'amber', text: 'Landing: ' + lz.name + '.' });
    }

    var complete = num(a.dow) > 0 && num(a.doi) !== 0 && num(state.fuel.block) > 0 && state.pax.length > 0 && needReview.length === 0 && !dup;
    var hasRed = issues.some(function (i) { return i.level === 'red'; });
    var hasAmber = issues.some(function (i) { return i.level === 'amber'; });
    if (!CFG.meta.verified) issues.push({ level: 'amber', text: 'Aircraft constants are not yet verified against approved operator data.' });
    hasAmber = issues.some(function (i) { return i.level === 'amber'; });
    var level = hasRed ? 'red' : (hasAmber ? 'amber' : 'green');
    var operational = complete && !hasRed && CFG.meta.verified;
    var canPrintDraft = complete && !hasRed;
    var paxCount = state.pax.length, paxWt = state.pax.reduce(function (s, p) { return s + paxWeight(p); }, 0);
    return { m: m, issues: issues, level: level, complete: complete, ready: operational, operational: operational, canPrintDraft: canPrintDraft, tz: tz, lz: lz, toMacOk: toMacOk, laMacOk: laMacOk, needReview: needReview, paxCount: paxCount, paxWt: paxWt };
  }

  /* ---------- shared UI bits ---------- */
  function statusWord(level, complete) {
    if (!complete) return { word: 'REVIEW REQUIRED', cls: 'amber' };
    if (level === 'red') return { word: 'OUT OF LIMITS', cls: 'red' };
    if (!CFG.meta.verified) return { word: 'UNVERIFIED DATA', cls: 'amber' };
    if (level === 'green') return { word: 'WITHIN LIMITS', cls: 'green' };
    if (level === 'amber') return { word: 'CAUTION', cls: 'amber' };
    return { word: 'REVIEW REQUIRED', cls: 'amber' };
  }
  function statCard(k, v, cls) { return '<div class="stat ' + (cls || '') + '"><span class="k">' + k + '</span><b class="v num">' + v + '</b></div>'; }

  /* ---------- step: Dashboard ---------- */
  function renderHero() {
    var c = compute(), s = statusWord(c.level, c.complete);
    return '<section class="card hero-card" id="dashHero">' +
      '<div class="hero-row"><div><div class="eyebrow">Active load calculation</div><div class="hero-type">' + esc(state.aircraft.reg || 'DHC-6 Twin Otter') + '</div><div class="muted sm">Standard 15-seat float configuration</div></div>' +
      '<span class="chip ' + s.cls + '"><span class="status-dot"></span>' + s.word + '</span></div>' +
      '<div class="stat-grid-3 hero-stats">' +
        statCard('DOW', f(num(state.aircraft.dow)) + ' lb', 'hl') +
        statCard('DOI', f(num(state.aircraft.doi), 2), 'hl') +
        statCard('Pax', c.paxCount, '') +
      '</div></section>';
  }
  function renderDashboard() {
    var opts = '<option value="">Saved aircraft…</option>' + Object.keys(presets()).sort().map(function (r) {
      var p = presets()[r]; return '<option value="' + esc(r) + '">' + esc(r) + ' — DOW ' + p.dow + ' / DOI ' + p.doi + '</option>';
    }).join('');
    return '' +
      renderHero() +

      (!CFG.meta.verified ? '<div class="notice unverified"><b>Prototype configuration</b><span>Aircraft constants still require operator approval before operational use.</span></div>' : '') +

      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">Step 1</span><h2>Aircraft setup</h2></div><span class="section-icon">AC</span></div>' +
        '<div class="field"><label>Load saved aircraft</label><div class="row-2"><select data-action="loadPreset">' + opts + '</select><button class="btn ghost" data-action="deletePreset">Delete</button></div></div>' +
        '<div class="grid-3">' +
          field('Registration', 'aircraft.reg', state.aircraft.reg, 'text', '8Q-XXX') +
          field('DOW (lb)', 'aircraft.dow', state.aircraft.dow, 'number') +
          field('DOI', 'aircraft.doi', state.aircraft.doi, 'number') +
        '</div>' +
        '<button class="btn ghost block" data-action="savePreset">Save / update this aircraft</button>' +
        '<p class="muted sm">Verify DOW / DOI against the current aircraft document. Values are a prototype baseline — not yet verified against approved data.</p>' +
      '</section>' +

      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">Optional details</span><h2>Flight information</h2></div></div>' +
        '<div class="grid-3">' +
          field('Flight No.', 'flight.no', state.flight.no, 'text', 'Q2-201') +
          field2('Route', 'flight.route', state.flight.route, 'text', 'MLE–DRV') +
        '</div>' +
      '</section>' +

      '<div class="cta-grid">' +
        '<button class="btn primary big" data-action="goScan"><svg viewBox="0 0 24 24" class="i"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span>Scan Manifest<small>Fastest entry</small></span></button>' +
        '<button class="btn ghost big" data-action="goReview"><span>Manual Entry<small>Enter passenger totals</small></span></button>' +
      '</div>' +
      '<button class="btn subtle block" data-action="newFlight">Clear current flight</button>';
  }
  function field(label, bind, val, type, ph) {
    var id = 'field-' + bind.replace(/[^a-z0-9]+/gi, '-');
    var numeric = type === 'number';
    return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-bind="' + bind + '" type="' + (type || 'text') + '" ' + (numeric ? 'inputmode="decimal" min="0" step="any"' : 'autocomplete="off"') + ' value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(label) + '"></div>';
  }
  function field2(label, bind, val, type, ph) { return '<div style="grid-column:span 2">' + field(label, bind, val, type, ph) + '</div>'; }

  /* ---------- step: Scan ---------- */
  function scanPassengerTotal(c) {
    return ['male', 'female', 'child', 'infant', 'unknown'].reduce(function (sum, key) { return sum + Math.max(0, Math.floor(num(c[key]))); }, 0);
  }
  function scanCountField(c, key, label, cls) {
    return '<label class="scan-edit ' + cls + '"><span>' + label + '</span><input type="number" min="0" max="15" step="1" inputmode="numeric" data-scan-bind="' + key + '" value="' + Math.max(0, Math.floor(num(c[key]))) + '" aria-label="' + label + ' passenger count"></label>';
  }
  function scanLoadField(load, key, label) {
    var value = load[key];
    return '<label class="scan-load-edit"><span>' + label + '</span><div><input type="number" min="0" step="1" inputmode="decimal" data-scan-load-bind="' + key + '" value="' + (value !== null && value !== undefined ? esc(value) : '') + '" placeholder="0" aria-label="' + label + '"><b>lb</b></div></label>';
  }
  function renderScanResult() {
    if (!scanResult) return '';
    var c = scanResult.counts;
    c.total = scanPassengerTotal(c);
    var usable = c.total > 0 && c.total <= 15;
    var issueHtml = c.issues && c.issues.length ? '<details class="scan-notes"><summary>Scanner notes</summary><div class="scan-issues">' + c.issues.map(function (issue) { return '<div>' + esc(issue) + '</div>'; }).join('') + '</div></details>' : '';
    var meta = c.meta || {}, load = c.load || {}, evidence = c.evidence || {};
    var metaHtml = (meta.registration || meta.flightNo || meta.route || meta.time) ? '<div class="manifest-id">' +
      (meta.registration ? '<span>' + esc(meta.registration) + '</span>' : '') +
      (meta.flightNo ? '<span>Flight ' + esc(meta.flightNo) + '</span>' : '') +
      (meta.route ? '<span>' + esc(meta.route) + '</span>' : '') +
      (meta.time ? '<span>' + esc(meta.time) + '</span>' : '') + '</div>' : '';
    var loadHtml = '<div class="scan-load-editor">' +
      scanLoadField(load, 'luggage', 'Luggage') +
      scanLoadField(load, 'paxWeight', 'Printed pax wt') +
      scanLoadField(load, load.eic !== null && load.eic !== undefined ? 'eic' : 'cargo', load.eic !== null && load.eic !== undefined ? 'EIC' : 'Cargo') +
      '</div>';
    var evidenceHtml = evidence.ticketRows ? '<p class="scan-evidence">Cross-checked ' + evidence.ticketRows + ' readable ticket rows' +
      (evidence.recoveredRows ? '; restored ' + evidence.recoveredRows + ' faint row from the exact passenger-weight total' : '') +
      (load.paxWeight !== null ? ' · weight total verified' : '') + '.</p>' : '';
    var buttonText = load.luggage !== null ? 'Use passengers &amp; ' + f(load.luggage) + ' lb luggage' : 'Use detected passengers';
    return '<div class="scan-result">' +
      '<div class="scan-result-head"><div><span class="section-kicker">Review before importing</span><h3><span id="scanTotal">' + c.total + '</span> passengers</h3></div><span class="confidence ' + (scanResult.ocrConfidence >= 65 ? 'good' : 'review') + '">' + (scanResult.manual ? 'Manual review' : f(scanResult.ocrConfidence) + '% OCR') + '</span></div>' +
      metaHtml +
      '<p class="scan-edit-hint">Correct any value the scanner got wrong. Passenger names are optional.</p>' +
      '<div class="count-editor-grid">' +
        scanCountField(c, 'male', 'Male', 'cat-M') + scanCountField(c, 'female', 'Female', 'cat-F') + scanCountField(c, 'child', 'Child', 'cat-C') + scanCountField(c, 'infant', 'Infant', 'cat-I') + scanCountField(c, 'unknown', 'Unclear', 'need') +
      '</div>' + loadHtml + evidenceHtml + issueHtml +
      '<button id="useScanBtn" class="btn primary block" data-action="useScan"' + (usable ? '' : ' disabled') + '>' + buttonText + '</button>' +
      '<p class="muted sm" style="margin-bottom:0">Seats will be balanced automatically. Imported luggage starts in Area D—move it to the actual compartment before calculating.</p>' +
    '</div>';
  }
  function renderScan() {
    var preview = selectedPreviewUrls.length ? '<img class="scan-preview" src="' + esc(selectedPreviewUrls[0]) + '" alt="Selected manifest preview">' : '<div class="upload-icon"><svg viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></div>';
    var selectedNames = selectedFiles.map(function (file) { return file.name; }).join(' + ');
    var selectedSize = selectedFiles.reduce(function (sum, file) { return sum + file.size; }, 0);
    return '' +
      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">On-device OCR</span><h2>Scan flight manifests</h2></div><span class="privacy-pill">Private · OCR v4</span></div>' +
        '<p class="muted sm">Choose the passenger manifest, or select the passenger and baggage manifests together. Use straight, well-lit photos with the full sheets visible.</p>' +
        '<div class="dropzone ' + (selectedFiles.length ? 'has-file' : '') + '">' + preview + '<div><b id="fileName">' + esc(selectedFiles.length ? selectedNames : 'Choose manifest image(s)') + '</b><span>' + (selectedFiles.length ? selectedFiles.length + ' document' + (selectedFiles.length > 1 ? 's' : '') + ' · ' + f(selectedSize / 1024) + ' KB · ready' : 'Passenger manifest, plus optional baggage manifest') + '</span></div></div>' +
        '<div class="grid-2">' +
          '<button class="btn ghost" data-action="takePhoto"><svg viewBox="0 0 24 24" class="i"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>Take photo</button>' +
          '<button class="btn ghost" data-action="chooseFile"><svg viewBox="0 0 24 24" class="i"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>Choose image</button>' +
        '</div>' +
        '<input id="camInput" type="file" accept="image/*" capture="environment" hidden>' +
        '<input id="fileInput" type="file" accept="image/*" multiple hidden>' +
        '<button id="scanBtn" class="btn primary block" data-action="runOcr"' + (selectedFiles.length ? '' : ' disabled') + '>Scan ' + (selectedFiles.length > 1 ? 'documents' : 'document') + '</button>' +
        '<div class="ocr-progress"><div id="scanBar" class="progress-bar"><span></span></div><p id="scanStatus" class="muted sm">OCR engine is stored with the app and works offline.</p><div id="scanProgress" class="progress"></div></div>' +
        renderScanResult() +
        '<details class="acc"><summary>Recognized text · inspect or paste manually</summary><textarea id="ocrText" data-bind="ocrText" aria-label="Recognized manifest text" placeholder="OCR text appears here. You can also paste manifest text manually.">' + esc(state.ocrText) + '</textarea><button class="btn ghost block parse-text" data-action="parseOcrText">Parse this text</button></details>' +
      '</section>' +
      '<button class="btn subtle block" data-action="goReview">Skip scan and use manual entry</button>';
  }

  /* ---------- step: Review & Correction ---------- */
  function seatPaxIndex(label) { for (var i = 0; i < state.pax.length; i++) if (state.pax[i].seat === label) return i; return -1; }
  function renderSeatMap(readonly) {
    var html = '';
    for (var r = 1; r <= 5; r++) {
      var tiles = ['A', 'B', 'C'].map(function (col) {
        var label = r + col, idx = seatPaxIndex(label), p = idx >= 0 ? state.pax[idx] : null;
        var cls = p ? (p.cat === '?' ? 'need' : 'cat-' + p.cat) : 'empty';
        var glyph = p ? (p.cat === '?' ? '?' : p.cat) : (readonly ? '·' : '+');
        var inner = '<span class="seat-id">' + label + '</span><span class="seat-cat">' + glyph + '</span>';
        return readonly
          ? '<div class="seat-tile ro ' + cls + '">' + inner + '</div>'
          : '<button class="seat-tile ' + cls + '" data-action="cycleSeat" data-seat="' + label + '" aria-label="Seat ' + label + '">' + inner + '</button>';
      }).join('');
      html += '<div class="seat-row"><span class="rl">' + r + '</span><div class="seats3">' + tiles + '</div></div>';
    }
    return '<div class="cabin-shell"><div class="cabin-direction"><span>Flight deck</span><span>Front</span></div><div class="seatmap">' + html + '</div><div class="cabin-aft">Aft</div></div>';
  }
  function renderCategoryEditor() {
    var counts = categoryCounts();
    function card(cat, label, weight, cls) {
      return '<div class="pax-count-card ' + cls + '"><div><b>' + label + '</b><span>' + (weight ? weight + ' lb' : 'Set category') + '</span></div>' +
        '<div class="step-control"><button data-action="adjustCount" data-cat="' + cat + '" data-delta="-1" aria-label="Remove one ' + label + '">&minus;</button>' +
        '<input type="number" min="0" max="15" step="1" inputmode="numeric" data-cat-count="' + cat + '" value="' + counts[cat] + '" aria-label="' + label + ' count">' +
        '<button data-action="adjustCount" data-cat="' + cat + '" data-delta="1" aria-label="Add one ' + label + '">+</button></div></div>';
    }
    return '<div class="pax-count-grid">' +
      card('M', 'Male', CFG.paxWeights.M, 'cat-M') + card('F', 'Female', CFG.paxWeights.F, 'cat-F') +
      card('C', 'Child', CFG.paxWeights.C, 'cat-C') + card('I', 'Infant', CFG.paxWeights.I, 'cat-I') +
      (counts['?'] ? card('?', 'Unclear', 0, 'need') : '') +
      '</div>';
  }
  function renderReview() {
    var c = compute();
    var indexed = state.pax.map(function (p, i) { return { p: p, i: i }; });
    indexed.sort(function (a, b) { return SEATS.indexOf(a.p.seat) - SEATS.indexOf(b.p.seat); });
    var list = indexed.map(function (o) {
      var p = o.p, i = o.i, need = p.cat === '?';
      var ph = need ? 'wt' : f(CFG.paxWeights[p.cat] || 0);
      return '<div class="paxrow ' + (need ? 'need' : '') + '">' +
        '<button class="catchip ' + (need ? 'need' : 'cat-' + p.cat) + '" data-action="cycleSeat" data-seat="' + esc(p.seat) + '" aria-label="Change category for ' + esc(p.seat) + '">' + esc(p.seat) + ' ' + (need ? '?' : p.cat) + '</button>' +
        '<input class="cell name" data-bind="pax.' + i + '.name" value="' + esc(p.name) + '" placeholder="Name (optional)" aria-label="Passenger name for seat ' + esc(p.seat) + '">' +
        '<input class="cell wt num" type="number" min="1" step="any" inputmode="decimal" data-bind="pax.' + i + '.weight" value="' + (p.weight > 0 ? p.weight : '') + '" placeholder="' + ph + '" aria-label="Weight override for seat ' + esc(p.seat) + '">' +
        '<button class="iconbtn" data-action="delPax" data-i="' + i + '" aria-label="Remove passenger from seat ' + esc(p.seat) + '">&times;</button>' +
      '</div>';
    }).join('');
    return '' +
      '<section class="card">' +
        '<div class="card-head"><div><span class="section-kicker">Passenger totals</span><h2>Who is travelling?</h2></div><div class="head-chip" id="reviewChip"><b>' + c.paxCount + ' pax</b> &middot; <b>' + f(c.paxWt) + ' lb</b></div></div>' +
        '<p class="muted sm" style="margin-top:0">Enter the totals directly or correct the scan. Names are not required.</p>' +
        renderCategoryEditor() +
      '</section>' +
      '<section class="card seating-card">' +
        '<div class="card-head"><div><span class="section-kicker">Automatic seating</span><h2>Balanced cabin</h2></div><span class="balance-badge">CG assisted</span></div>' +
        '<p class="muted sm" style="margin-top:0">The app places passengers for a balanced longitudinal load. Tap any seat to make an operational adjustment.</p>' +
        renderSeatMap() +
        '<div class="seat-legend sm"><span class="lg cat-M">M Male</span><span class="lg cat-F">F Female</span><span class="lg cat-C">C Child</span><span class="lg cat-I">I Infant</span></div>' +
        (c.needReview.length ? '<div class="banner amber sm">' + c.needReview.length + ' seat(s) marked &quot;?&quot; &mdash; tap to set the category before calculating.</div>' : '') +
        '<button class="btn primary block" data-action="optimizeSeats"' + (state.pax.length && !c.needReview.length ? '' : ' disabled') + '>Balance seats for current load</button>' +
        (list ? '<details class="acc passenger-details"><summary>Passenger details &amp; individual weights <span>Optional</span></summary><div class="paxlist">' + list + '</div></details>' : '<p class="muted sm" style="text-align:center;padding:8px">Enter passenger totals above or tap a seat to begin.</p>') +
        (list ? '<button class="btn subtle block" data-action="clearPax">Clear passengers</button>' : '') +
      '</section>' +
      '<div class="legend sm muted">Standard weights: M ' + CFG.paxWeights.M + ' / F ' + CFG.paxWeights.F + ' / C ' + CFG.paxWeights.C + ' / I ' + CFG.paxWeights.I + ' lb. The final CG is recalculated after fuel and baggage are entered.</div>';
  }
  function cycleSeat(label) {
    var order = { '?': 'M', 'M': 'F', 'F': 'C', 'C': 'I', 'I': null };
    var idx = seatPaxIndex(label);
    if (idx < 0) {
      if (state.pax.length >= 15) { toast('All 15 seats are taken.'); return; }
      state.pax.push({ id: uid(), name: '', cat: 'M', seat: label });
    } else {
      var cur = state.pax[idx].cat, nxt = order.hasOwnProperty(cur) ? order[cur] : 'M';
      if (nxt === null) state.pax.splice(idx, 1); else state.pax[idx].cat = nxt;
    }
    render();
  }
  function setCategoryCount(cat, requested) {
    if (!CAT_LABEL.hasOwnProperty(cat)) return;
    var target = Math.max(0, Math.min(15, Math.floor(num(requested))));
    var current = state.pax.filter(function (passenger) { return passenger.cat === cat; }).length;
    var other = state.pax.length - current;
    if (target + other > 15) {
      target = 15 - other;
      toast('The cabin is limited to 15 passenger seats.');
    }
    if (target < current) {
      var remove = current - target;
      for (var i = state.pax.length - 1; i >= 0 && remove > 0; i--) {
        if (state.pax[i].cat === cat) { state.pax.splice(i, 1); remove--; }
      }
    } else {
      for (var add = current; add < target; add++) state.pax.push({ id: uid(), name: '', cat: cat, seat: '' });
    }
    arrangeSeats(true);
  }
  function centerOutArrangement() {
    var order = ['3B','3A','3C','2B','4B','2A','2C','4A','4C','1B','5B','1A','1C','5A','5C'];
    state.pax.forEach(function (passenger, index) { passenger.seat = order[index] || ''; });
  }
  function arrangeSeats(silent) {
    if (!state.pax.length) { if (!silent) toast('Enter passenger totals first.'); render(); return false; }
    if (state.pax.some(function (passenger) { return !isCat(passenger.cat); })) {
      centerOutArrangement();
      if (!silent) toast('Set every unclear category before CG optimization.');
      render(); return false;
    }
    var result = SEATING.optimize(state.pax, engineInput(), CFG, ENG);
    if (!result.changed) {
      centerOutArrangement();
      if (!silent) toast(result.reason || 'Seats could not be balanced.');
      render(); return false;
    }
    state.pax = result.passengers.sort(function (a, b) { return SEATS.indexOf(a.seat) - SEATS.indexOf(b.seat); });
    if (!silent) {
      var mac = result.metrics && result.metrics.to ? f(result.metrics.to.mac, 1) + '% MAC' : 'the current load';
      toast('Seats balanced for ' + mac + '. Verify any operational seating restrictions.');
    }
    render(); return true;
  }
  function clearPax() { if (!state.pax.length) return; if (!confirm('Remove all passengers?')) return; state.pax = []; render(); }

  /* ---------- step: Cargo & Fuel ---------- */
  function renderCargo() {
    var S = CFG.stations;
    return '' +
      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">Departure load</span><h2>Fuel</h2></div><span class="section-icon">LB</span></div>' +
        '<div class="grid-2">' +
          field('Block fuel (lb)', 'fuel.block', state.fuel.block, 'number') +
          field('Trip fuel (lb)', 'fuel.trip', state.fuel.trip, 'number') +
        '</div>' +
        '<p class="muted sm">Takeoff fuel = block − ' + CFG.fuel.takeoffOffset + ' lb.</p>' +
      '</section>' +
      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">Station loading</span><h2>Baggage and cargo</h2></div></div>' +
        '<div class="grid-2">' +
          field('Stretcher · arm ' + S.stretcher, 'cargo.stretcher', state.cargo.stretcher, 'number') +
          field('Seat row 4 · arm ' + S.bagR4, 'cargo.bagR4', state.cargo.bagR4, 'number') +
          field('Seat row 5 · arm ' + S.bagR5, 'cargo.bagR5', state.cargo.bagR5, 'number') +
          field('Area D · arm ' + S.bagD, 'cargo.bagD', state.cargo.bagD, 'number') +
          field('Aft compartment · arm ' + S.bagAft, 'cargo.bagAft', state.cargo.bagAft, 'number') +
          field('Aft shelf · arm ' + S.bagShelf, 'cargo.bagShelf', state.cargo.bagShelf, 'number') +
        '</div>' +
      '</section>' +
      '<section class="card"><h2>Remarks</h2><textarea data-bind="flight.remarks" placeholder="Special loads, dangerous goods, notes (appears on the load sheet)">' + esc(state.flight.remarks) + '</textarea></section>' +
      '<section class="card optimize-panel"><div><span class="section-kicker">Final seating check</span><h2>Balance with the complete load</h2><p class="muted sm">Now that fuel and baggage are entered, run the seating optimizer again for the best available CG.</p></div><button class="btn primary block" data-action="optimizeSeats"' + (state.pax.length ? '' : ' disabled') + '>Optimize passenger seats</button></section>' +
      liveSummary();
  }
  function liveSummary() {
    var c = compute(), m = c.m, s = statusWord(c.level, c.complete);
    return '<section class="card live"><div class="card-head"><div><span class="section-kicker">Live calculation</span><h2>Running totals</h2></div><span class="chip ' + s.cls + '"><span class="status-dot"></span>' + s.word + '</span></div>' +
      '<div class="stat-grid-3">' + statCard('ZFW', f(m.zfw) + ' lb') + statCard('TOW', f(m.tow) + ' lb', m.tow > CFG.limits.mtow ? 'bad' : 'hl') + statCard('TO %MAC', f(m.to.mac, 1) + '%', c.toMacOk ? 'good' : 'bad') + '</div></section>';
  }

  /* ---------- step: Results ---------- */
  function renderResults() {
    var c = compute(), m = c.m, s = statusWord(c.level, c.complete);
    var issues = c.issues.length ? '<ul class="issues">' + c.issues.map(function (i) { return '<li class="' + i.level + '">' + esc(i.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted sm">All checks passed within the configured limits.</p>';
    var exportLabel = CFG.meta.verified ? 'Export load sheet' : 'Print review draft';
    return '' +
      '<section class="card banner-card ' + s.cls + '">' +
        '<div class="eyebrow">Calculation status</div><div class="banner-word">' + s.word + '</div>' +
        '<div class="banner-sub">' + (c.complete ? ('Takeoff CG ' + f(m.to.mac, 1) + '% MAC · TOW ' + f(m.tow) + ' lb') : 'Complete the required fields and review all passengers') + '</div>' +
      '</section>' +
      (!CFG.meta.verified ? '<div class="notice unverified strong"><b>Not for operational use</b><span>The configured envelope and aircraft constants are still unverified.</span></div>' : '') +
      '<section class="card"><div class="section-title"><div><span class="section-kicker">Takeoff and landing</span><h2>CG envelope</h2></div></div>' + envelopeSVG(m, c) + '<div class="legend sm muted" style="justify-content:center">' + (CFG.meta.verified ? 'Approved' : 'Prototype') + ' band ' + CFG.limits.cgFwd + '–' + CFG.limits.cgAft + '% MAC · MTOW ' + f(CFG.limits.mtow) + ' lb</div></section>' +
      '<section class="card"><div class="card-head"><h2>Cabin Layout</h2><div class="head-chip"><b>' + c.paxCount + ' pax</b> &middot; <b>' + f(c.paxWt) + ' lb</b></div></div>' + renderSeatMap(true) + '<div class="seat-legend sm"><span class="lg cat-M">M Male</span><span class="lg cat-F">F Female</span><span class="lg cat-C">C Child</span><span class="lg cat-I">I Infant</span></div></section>' +
      '<section class="card">' +
        '<div class="section-title"><div><span class="section-kicker">Load summary</span><h2>Weight and balance</h2></div></div>' +
        '<div class="stat-grid-3">' +
          statCard('Zero Fuel Wt', f(m.zfw) + ' lb') + statCard('Takeoff Wt', f(m.tow) + ' lb', m.tow > CFG.limits.mtow ? 'bad' : 'hl') + statCard('Landing Wt', f(m.lw) + ' lb') +
          statCard('Payload', f(m.payload) + ' lb') + statCard('Takeoff Fuel', f(m.tof) + ' lb') + statCard('Underload', f(CFG.limits.mtow - m.tow) + ' lb', (m.tow <= CFG.limits.mtow && m.tow > 0) ? 'good' : '') +
        '</div>' +
        '<div class="cg-2">' +
          cgCard('Takeoff', m.to, c.toMacOk, c.tz) +
          cgCard('Landing', m.la, c.laMacOk, c.lz) +
        '</div>' +
      '</section>' +
      '<section class="card"><div class="section-title"><div><span class="section-kicker">Automated review</span><h2>Checks</h2></div></div>' + issues + '</section>' +
      '<button class="btn primary big block" data-action="exportPdf"' + (c.canPrintDraft ? '' : ' disabled') + '>' + exportLabel + '</button>' +
      (c.canPrintDraft ? (!CFG.meta.verified ? '<p class="muted sm export-note">The printed sheet is permanently marked UNVERIFIED.</p>' : '') : '<p class="muted sm export-note">Printing is blocked until all red issues are corrected.</p>') +
      '<p class="muted sm disclaimer">Always verify loading, fuel, CG/index and limits against current approved aircraft and operator documents.</p>';
  }
  function cgCard(title, cg, macOk, zone) {
    var lvl = !macOk ? 'red' : zone.level;
    return '<div class="cgcard ' + lvl + '"><div class="cg-title">' + title + '</div>' +
      '<div class="cg-vals"><div><span>Arm</span><b class="num">' + f(cg.arm, 2) + '</b></div><div><span>Index</span><b class="num">' + f(cg.index, 2) + '</b></div><div><span>%MAC</span><b class="num">' + f(cg.mac, 2) + '</b></div></div></div>';
  }
  function envelopeSVG(m, c) {
    var W = 320, H = 230, padL = 46, padR = 14, padT = 14, padB = 32;
    var x0 = padL, x1 = W - padR, y0 = H - padB, yT = padT;
    var macMin = 20, macMax = 36, wMax = Math.max(13000, m.tow + 600);
    var sx = function (v) { return x0 + (v - macMin) / (macMax - macMin) * (x1 - x0); };
    var sy = function (v) { return y0 - (v / wMax) * (y0 - yT); };
    var rectX = sx(CFG.limits.cgFwd), rectW = sx(CFG.limits.cgAft) - sx(CFG.limits.cgFwd);
    var rectY = sy(CFG.limits.mtow), rectH = sy(0) - sy(CFG.limits.mtow);
    function tickX(v) { return '<line x1="' + sx(v) + '" y1="' + y0 + '" x2="' + sx(v) + '" y2="' + (y0 + 4) + '"/><text x="' + sx(v) + '" y="' + (y0 + 16) + '" class="ax">' + v + '</text>'; }
    function tickY(v) { return '<line x1="' + (x0 - 4) + '" y1="' + sy(v) + '" x2="' + x0 + '" y2="' + sy(v) + '"/><text x="' + (x0 - 7) + '" y="' + (sy(v) + 3) + '" class="ay">' + (v / 1000) + 'k</text>'; }
    function pt(mac, w, label) {
      var ok = mac >= CFG.limits.cgFwd && mac <= CFG.limits.cgAft && w <= CFG.limits.mtow && w > 0;
      var cx = Math.max(x0, Math.min(x1, sx(mac))), cy = Math.max(yT, Math.min(y0, sy(w)));
      return '<circle cx="' + cx + '" cy="' + cy + '" r="5" class="pt ' + (ok ? 'ok' : 'bad') + '"/><text x="' + (cx + 8) + '" y="' + (cy + 4) + '" class="pl">' + label + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="CG envelope">' +
      '<rect x="' + rectX + '" y="' + rectY + '" width="' + rectW + '" height="' + rectH + '" class="safe"/>' +
      '<line x1="' + x0 + '" y1="' + yT + '" x2="' + x0 + '" y2="' + y0 + '" class="axis"/>' +
      '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '" class="axis"/>' +
      tickX(20) + tickX(25) + tickX(28) + tickX(32) + tickX(36) +
      tickY(4000) + tickY(8000) + tickY(12500) +
      '<text x="' + ((x0 + x1) / 2) + '" y="' + (H - 2) + '" class="axt">% MAC</text>' +
      (m.tow > 0 ? pt(m.to.mac, m.tow, 'TO') : '') + (m.lw > 0 ? pt(m.la.mac, m.lw, 'LDG') : '') +
      '</svg>';
  }

  /* ---------- stepper + nav ---------- */
  function renderStepper() {
    return STEPS.map(function (name, i) {
      var cls = i === state.step ? 'on' : (i < state.step ? 'visited' : '');
      return '<button class="stepdot ' + cls + '" data-action="goto" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t">' + name + '</span></button>';
    }).join('');
  }
  function renderNav() {
    var prev = state.step > 0 ? '<button class="btn ghost" data-action="prev">Back</button>' : '<span></span>';
    var next = state.step < STEPS.length - 1 ? '<button class="btn primary" data-action="next">' + (state.step === 0 ? 'Continue' : (state.step === 3 ? 'Calculate CG' : 'Next')) + '</button>' : '<button class="btn ghost" data-action="newFlight">New Flight</button>';
    return prev + next;
  }

  /* ---------- render ---------- */
  var RENDERERS = [renderDashboard, renderScan, renderReview, renderCargo, renderResults];
  function render() {
    $('stepper').innerHTML = renderStepper();
    $('view').innerHTML = RENDERERS[state.step]();
    $('nav').innerHTML = renderNav();
    $('view').scrollTop = 0; window.scrollTo(0, 0);
    if (state.step === 1) wireScanInputs();
    save();
  }
  function go(i) { state.step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); }

  /* ---------- binding ---------- */
  function setBind(path, value) {
    var parts = path.split('.'), obj = state;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i]; if (/^\d+$/.test(parts[i + 1]) || /^\d+$/.test(key)) { /* array index handled below */ }
      obj = obj[key];
    }
    obj[parts[parts.length - 1]] = value;
  }
  function coerce(el, raw) { return el.type === 'number' ? num(raw) : raw; }

  /* ---------- preset actions ---------- */
  function doSavePreset() {
    var r = (state.aircraft.reg || '').trim().toUpperCase(), dow = num(state.aircraft.dow), doi = num(state.aircraft.doi);
    if (!r) return toast('Enter a registration first.');
    if (dow <= 0 || doi === 0) return toast('Enter DOW and DOI before saving.');
    if (dow > CFG.limits.mtow) return toast('DOW looks too high — check for extra zeros.');
    var p = presets(); p[r] = { dow: dow, doi: doi, updated: new Date().toISOString() }; savePresets(p);
    state.aircraft.reg = r; toast('Saved aircraft ' + r + '.'); render();
  }
  function doLoadPreset(r) { var p = presets()[r]; if (!p) return; state.aircraft.reg = r; state.aircraft.dow = p.dow; state.aircraft.doi = p.doi; toast('Loaded ' + r + '. Verify against current aircraft data.'); render(); }
  function doDeletePreset(sel) { var r = sel || (state.aircraft.reg || '').trim().toUpperCase(); var p = presets(); if (!p[r]) return toast('Select a saved aircraft to delete.'); delete p[r]; savePresets(p); toast('Deleted ' + r + '.'); render(); }

  /* ---------- passengers ---------- */
  function delPax(i) { state.pax.splice(i, 1); render(); }

  /* ---------- OCR ---------- */
  var selectedFiles = [], selectedPreviewUrls = [], scanResult = null, ocrWorker = null, ocrBusy = false;
  function clearSelectedFile() {
    selectedPreviewUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (e) {} });
    selectedFiles = []; selectedPreviewUrls = []; scanResult = null; state.ocrText = '';
  }
  function wireScanInputs() {
    ['camInput', 'fileInput'].forEach(function (id) {
      var inp = $(id);
      if (inp) inp.onchange = function () {
        if (inp.files && inp.files[0]) {
          var files = Array.prototype.slice.call(inp.files, 0, 2);
          if (files.some(function (file) { return !/^image\//.test(file.type || ''); })) return toast('Choose JPG, PNG or camera images.');
          if (files.some(function (file) { return file.size > 20 * 1024 * 1024; })) return toast('Each image must be under 20 MB.');
          selectedPreviewUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (e) {} });
          selectedFiles = files;
          selectedPreviewUrls = files.map(function (file) { return URL.createObjectURL(file); });
          scanResult = null; state.ocrText = '';
          render();
        }
      };
    });
  }

  function preprocessImage(file) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          // Upscale phone screenshots and cap very large photos to control memory.
          var longEdge = Math.max(img.width, img.height);
          var target = longEdge < 1600 ? 1900 : Math.min(2600, longEdge);
          var scale = target / longEdge;
          if (!isFinite(scale) || scale <= 0) scale = 1;
          var w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
          var d, a; try { d = ctx.getImageData(0, 0, w, h); a = d.data; } catch (e) { resolve(cv); return; }
          var i, g, histogram = new Array(256).fill(0), pixels = a.length / 4;
          for (i = 0; i < a.length; i += 4) {
            g = Math.round(a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114);
            a[i] = a[i + 1] = a[i + 2] = g; histogram[g]++;
          }
          var lowTarget = pixels * 0.008, highTarget = pixels * 0.992, sum = 0, low = 0, high = 255;
          for (i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= lowTarget) { low = i; break; } }
          sum = 0;
          for (i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= highTarget) { high = i; break; } }
          var range = Math.max(30, high - low);
          for (i = 0; i < a.length; i += 4) {
            g = Math.round((a[i] - low) * 255 / range);
            g = g < 0 ? 0 : g > 255 ? 255 : g;
            a[i] = a[i + 1] = a[i + 2] = g;
          }
          ctx.putImageData(d, 0, 0);
          resolve(cv);
        };
        img.onerror = function () { resolve(file); };
        var objectUrl = URL.createObjectURL(file);
        img.onload = (function (original) { return function () { URL.revokeObjectURL(objectUrl); original(); }; })(img.onload);
        img.onerror = (function (original) { return function () { URL.revokeObjectURL(objectUrl); original(); }; })(img.onerror);
        img.src = objectUrl;
      } catch (e) { resolve(file); }
    });
  }

  function getOcrWorker() {
    if (ocrWorker) return Promise.resolve(ocrWorker);
    if (!window.Tesseract || !window.Tesseract.createWorker) return Promise.reject(new Error('OCR library is unavailable'));
    var base = new URL('.', window.location.href);
    return window.Tesseract.createWorker('eng', 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', base).href,
      corePath: new URL('vendor/tesseract/core/tesseract-core-lstm.wasm.js', base).href,
      langPath: new URL('vendor/tesseract/lang', base).href,
      workerBlobURL: false,
      gzip: true,
      logger: function (message) {
        var pct = typeof message.progress === 'number' ? Math.round(message.progress * 100) : 0;
        setProgress(message.status || 'working', pct);
      },
      errorHandler: function (error) { console.error('OCR worker:', error); }
    }).then(function (worker) {
      ocrWorker = worker;
      return worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' }).then(function () { return worker; });
    });
  }

  function runOcr() {
    if (!selectedFiles.length) { setScan('Choose a manifest image first.'); return; }
    if (ocrBusy) return;
    ocrBusy = true; scanResult = null;
    var button = $('scanBtn'); if (button) button.disabled = true;
    setScan('Enhancing the manifest image…'); setProgress('preparing image', 5);

    function crop(source, x, y, w, h, scale) {
      var cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
      var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(source, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, cv.width, cv.height);
      return cv;
    }
    function recognizeOne(file, index) {
      var enhanced, worker, main;
      setScan('Reading document ' + (index + 1) + ' of ' + selectedFiles.length + '…');
      return preprocessImage(file).then(function (src) { enhanced = src; return getOcrWorker(); }).then(function (w) {
        worker = w; return worker.setParameters({ tessedit_pageseg_mode: '11' });
      }).then(function () { return worker.recognize(enhanced, {}, { text: true, tsv: true, blocks: true }); }).then(function (result) {
        main = result;
        var text = (result.data.text || '').trim();
        if (PARSE.detectDocumentType(text) !== 'base-passenger') return { summary: '', categories: '', table: '' };
        setScan('Cross-checking printed passenger and gender totals…');
        var summaryCrop = crop(enhanced, enhanced.width * .333, enhanced.height * .365, enhanced.width * .31, enhanced.height * .33, 1.8);
        var categoryCrop = crop(enhanced, enhanced.width * .665, enhanced.height * .535, enhanced.width * .31, enhanced.height * .20, 2);
        var tableCrop = crop(enhanced, enhanced.width * .09, enhanced.height * .165, enhanced.width * .87, enhanced.height * .25, 1.6);
        return worker.setParameters({ tessedit_pageseg_mode: '6' }).then(function () {
          return worker.recognize(summaryCrop, {}, { text: true });
        }).then(function (summary) {
          return worker.recognize(categoryCrop, {}, { text: true }).then(function (categories) {
            return worker.recognize(tableCrop, {}, { text: true }).then(function (table) {
              return { summary: summary.data.text || '', categories: categories.data.text || '', table: table.data.text || '' };
            });
          });
        }).finally(function () { return worker.setParameters({ tessedit_pageseg_mode: '11' }); });
      }).then(function (supplements) {
        var text = (main.data.text || '').trim(), confidence = isFinite(main.data.confidence) ? main.data.confidence : 0;
        return { text: text, confidence: confidence, counts: PARSE.parseManifestScan(text, main.data.tsv || '', enhanced.width || 0, enhanced.height || 0, CFG.paxWeights, supplements) };
      });
    }
    function mergeDocuments(documents) {
      var passengerDoc = documents.find(function (doc) { return doc.counts.documentType !== 'base-baggage' && doc.counts.total > 0; });
      var baggageDoc = documents.find(function (doc) { return doc.counts.documentType === 'base-baggage'; });
      var chosen = passengerDoc || documents[0], counts = chosen.counts;
      if (passengerDoc && baggageDoc) {
        var bagLoad = baggageDoc.counts.load || {}, paxLoad = counts.load || {};
        ['checkedCount','handCount','ocsCount','bumpedCount','luggage','handWeight','ocsWeight','bumpedWeight'].forEach(function (key) {
          if (bagLoad[key] !== null && bagLoad[key] !== undefined) paxLoad[key] = bagLoad[key];
        });
        counts.load = paxLoad;
        counts.meta = counts.meta || {};
        Object.keys(baggageDoc.counts.meta || {}).forEach(function (key) { if (!counts.meta[key]) counts.meta[key] = baggageDoc.counts.meta[key]; });
        counts.evidence = counts.evidence || {}; counts.evidence.baggageManifest = true;
      }
      return { counts: counts, ocrConfidence: documents.reduce(function (sum, doc) { return sum + doc.confidence; }, 0) / documents.length, manual: false };
    }

    var chain = Promise.resolve([]);
    selectedFiles.forEach(function (file, index) {
      chain = chain.then(function (documents) { return recognizeOne(file, index).then(function (doc) { documents.push(doc); return documents; }); });
    });
    chain.then(function (documents) {
      state.ocrText = documents.map(function (doc, index) { return '--- Document ' + (index + 1) + ' ---\n' + doc.text; }).join('\n\n');
      scanResult = mergeDocuments(documents);
      setProgress('complete', 100);
      ocrBusy = false;
      render();
      if (!state.ocrText.trim()) toast('No readable text found. Try a sharper, closer photo.');
      else toast('Scan complete. Passenger and load totals were cross-checked.');
    }).catch(function (error) {
      console.error(error);
      ocrBusy = false;
      if (ocrWorker && ocrWorker.terminate) try { ocrWorker.terminate(); } catch (e) {}
      ocrWorker = null;
      setProgress('failed', 0);
      setScan('OCR could not finish. Try another image or paste the manifest text below.');
      if (button) button.disabled = false;
    });
  }

  function parseOcrText() {
    var text = String(state.ocrText || '').trim();
    if (!text) return toast('Paste or enter manifest text first.');
    scanResult = { counts: PARSE.parseManifestCounts(text), ocrConfidence: 100, manual: true };
    render();
  }

  function applyScan(c) {
    var list = [], i;
    if (!c) return toast('No passengers were detected. Enter them manually or try another scan.');
    c.total = scanPassengerTotal(c);
    if (!c.total) return toast('No passengers were detected. Enter them manually or try another scan.');
    if (c.total > 15) return toast('Detected count exceeds the 15-seat cabin. Check the manifest text before continuing.');
    if (Array.isArray(c.passengers) && c.passengers.length === c.total) {
      list = c.passengers.map(function (passenger) { return passenger.cat || '?'; });
    } else {
      for (i = 0; i < (c.male || 0); i++) list.push('M');
      for (i = 0; i < (c.female || 0); i++) list.push('F');
      for (i = 0; i < (c.child || 0); i++) list.push('C');
      for (i = 0; i < (c.infant || 0); i++) list.push('I');
      for (i = 0; i < (c.unknown || 0); i++) list.push('?');
    }
    if (list.length > 15) return toast('Passenger categories exceed the 15-seat cabin. Review the detected text.');
    state.pax = list.map(function (cat, idx) {
      var detected = c.passengers && c.passengers[idx];
      return { id: uid(), name: detected && detected.name ? detected.name : '', cat: cat, seat: '' };
    });
    if (c.load) {
      if (c.load.luggage !== null || c.load.cargo !== null) state.cargo.bagD = (c.load.luggage || 0) + (c.load.cargo || 0);
      if (c.load.takeoffFuel) state.fuel.block = c.load.takeoffFuel + CFG.fuel.takeoffOffset;
      if (c.load.burnFuel) state.fuel.trip = c.load.burnFuel;
    }
    if (c.meta) {
      if (c.meta.registration) state.aircraft.reg = c.meta.registration;
      if (c.meta.flightNo) state.flight.no = c.meta.flightNo;
      if (c.meta.route) state.flight.route = c.meta.route;
    }
    arrangeSeats(true);
    toast('Loaded and balanced ' + list.length + ' passengers' + (c.load && c.load.luggage !== null ? ' with ' + f(c.load.luggage) + ' lb luggage' : '') +
      (c.load && c.load.eic > 0 ? '. EIC was not assigned—enter it at the approved station.' : '. Review the seats and baggage station.'));
    go(2);
  }
  function setScan(t) { var e = $('scanStatus'); if (e) e.textContent = t; }
  function setProgress(t, pct) {
    var e = $('scanProgress'); if (e) e.textContent = t ? 'OCR · ' + t : '';
    var bar = $('scanBar'); if (bar) { var span = bar.querySelector('span'); if (span) span.style.width = Math.max(0, Math.min(100, pct || 0)) + '%'; }
  }

  /* ---------- PDF / print ---------- */
  function exportPdf() {
    var c = compute();
    if (!c.canPrintDraft) return toast('Correct all red issues before printing.');
    var m = c.m, s = statusWord(c.level, c.complete), now = new Date().toLocaleString();
    function rows(title, arr) { return '<div class="ps-sec"><h3>' + title + '</h3>' + arr.map(function (r) { return '<div class="ps-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>'; }
    var paxRows = state.pax.map(function (p, index) { return '<div class="ps-row"><span>' + esc(p.name || ('Passenger ' + (index + 1))) + ' · ' + (CAT_LABEL[p.cat] || '?') + ' · ' + esc(p.seat || '—') + '</span><b>' + (p.cat === '?' ? '—' : f(paxWeight(p)) + ' lb') + '</b></div>'; }).join('');
    $('printSheet').innerHTML =
      (!CFG.meta.verified ? '<div class="ps-watermark">UNVERIFIED · REVIEW DRAFT · NOT FOR OPERATIONAL USE</div>' : '') +
      '<div class="ps-head"><div><div class="ps-title">DHC-6 CG / ' + (CFG.meta.verified ? 'LOAD SHEET' : 'REVIEW DRAFT') + '</div><div class="ps-sub">Weight &amp; Balance Summary</div></div>' +
      '<div class="ps-meta"><b>Aircraft:</b> ' + esc(state.aircraft.reg || '—') + '<br><b>Flight:</b> ' + esc(state.flight.no || '—') + '<br><b>Route:</b> ' + esc(state.flight.route || '—') + '<br><b>Date:</b> ' + now + '</div></div>' +
      '<div class="ps-status ' + s.cls + '">' + s.word + ' — TO ' + f(m.to.mac, 2) + '% MAC · TOW ' + f(m.tow) + ' lb</div>' +
      '<div class="ps-grid">' +
        rows('Aircraft &amp; Fuel', [['Registration', esc(state.aircraft.reg || '—')], ['DOW', f(num(state.aircraft.dow)) + ' lb'], ['DOI', f(num(state.aircraft.doi), 2)], ['Block fuel', f(num(state.fuel.block)) + ' lb'], ['Trip fuel', f(num(state.fuel.trip)) + ' lb'], ['Takeoff fuel', f(m.tof) + ' lb']]) +
        rows('Weights', [['Zero fuel weight', f(m.zfw) + ' lb'], ['Payload', f(m.payload) + ' lb'], ['Takeoff weight', f(m.tow) + ' lb'], ['Landing weight', f(m.lw) + ' lb'], ['Underload', f(CFG.limits.mtow - m.tow) + ' lb']]) +
        rows('Takeoff CG', [['Arm', f(m.to.arm, 2)], ['Index', f(m.to.index, 2)], ['%MAC', f(m.to.mac, 2)]]) +
        rows('Landing CG', [['Arm', f(m.la.arm, 2)], ['Index', f(m.la.index, 2)], ['%MAC', f(m.la.mac, 2)]]) +
      '</div>' +
      '<div class="ps-sec"><h3>Passengers (' + c.paxCount + ' · ' + f(c.paxWt) + ' lb)</h3>' + (paxRows || '<div class="ps-row"><span>None</span><b>—</b></div>') + '</div>' +
      rows('Baggage / Cargo', [['Stretcher', f(num(state.cargo.stretcher)) + ' lb'], ['Seat row 4', f(num(state.cargo.bagR4)) + ' lb'], ['Seat row 5', f(num(state.cargo.bagR5)) + ' lb'], ['Area D', f(num(state.cargo.bagD)) + ' lb'], ['Aft compartment', f(num(state.cargo.bagAft)) + ' lb'], ['Aft shelf', f(num(state.cargo.bagShelf)) + ' lb']]) +
      '<div class="ps-sec"><h3>Remarks</h3><div class="ps-row"><span>' + (esc(state.flight.remarks) || '—') + '</span></div></div>' +
      '<div class="ps-note">' + (CFG.meta.verified ? '' : 'UNVERIFIED REVIEW DRAFT — NOT FOR OPERATIONAL USE. ') + 'Verify all loading, fuel, CG/index and limits against approved aircraft / operator documents.</div>' +
      '<div class="ps-sign"><div class="ps-line">Prepared / Checked by</div><div class="ps-line">PIC / Approval</div></div>';
    setTimeout(function () { window.print(); }, 60);
  }

  /* ---------- toast ---------- */
  var toastT;
  function toast(msg) { var t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3200); }

  /* ---------- new flight ---------- */
  function newFlight() {
    if (!confirm('Start a new flight? Passengers, cargo and fuel will be cleared (saved aircraft are kept).')) return;
    var keepReg = state.aircraft.reg, keepDow = state.aircraft.dow, keepDoi = state.aircraft.doi;
    state.flight = { no: '', route: '', remarks: '' }; state.fuel = { block: 0, trip: 0 };
    state.cargo = { stretcher: 0, bagR4: 0, bagR5: 0, bagD: 0, bagAft: 0, bagShelf: 0 };
    state.pax = []; state.ocrText = '';
    state.aircraft = { reg: keepReg, dow: keepDow, doi: keepDoi };
    clearSelectedFile();
    go(0);
  }

  /* ---------- events ---------- */
  function onInput(e) {
    var el = e.target, bind = el.getAttribute && el.getAttribute('data-bind');
    var scanBind = el.getAttribute && el.getAttribute('data-scan-bind');
    var scanLoadBind = el.getAttribute && el.getAttribute('data-scan-load-bind');
    if (scanResult && scanBind) {
      var counts = scanResult.counts, previous = Math.max(0, Math.floor(num(counts[scanBind]))), next = Math.max(0, Math.min(15, Math.floor(num(el.value))));
      counts[scanBind] = next;
      if (scanBind !== 'unknown' && next > previous && counts.unknown > 0) counts.unknown = Math.max(0, counts.unknown - (next - previous));
      counts.total = scanPassengerTotal(counts);
      counts.passengers = undefined;
      scanResult.manual = true;
      var totalEl = $('scanTotal'); if (totalEl) totalEl.textContent = counts.total;
      var unknownInput = document.querySelector('[data-scan-bind="unknown"]'); if (unknownInput && scanBind !== 'unknown') unknownInput.value = counts.unknown;
      var useButton = $('useScanBtn');
      if (useButton) useButton.disabled = !(counts.total > 0 && counts.total <= 15);
      return;
    }
    if (scanResult && scanLoadBind) {
      scanResult.counts.load = scanResult.counts.load || {};
      scanResult.counts.load[scanLoadBind] = String(el.value).trim() === '' ? null : Math.max(0, num(el.value));
      scanResult.manual = true;
      return;
    }
    if (!bind) return;
    setBind(bind, coerce(el, el.value));
    if (el.hasAttribute('data-rerender')) { render(); return; }
    save();
    if (state.step === 0) { var hero = document.getElementById('dashHero'); if (hero) hero.outerHTML = renderHero(); }
    else if (state.step === 2) { var chip = document.getElementById('reviewChip'); if (chip) { var cc = compute(); chip.innerHTML = '<b>' + cc.paxCount + ' pax</b> · <b>' + f(cc.paxWt) + ' lb</b>'; } }
    else if (state.step === 3) { var live = document.querySelector('.live'); if (live) live.outerHTML = liveSummary(); }
  }
  function onClick(e) {
    var t = e.target.closest('[data-action]'); if (!t) return;
    var a = t.getAttribute('data-action'), i = t.getAttribute('data-i');
    switch (a) {
      case 'next': go(state.step + 1); break;
      case 'prev': go(state.step - 1); break;
      case 'goto': go(+i); break;
      case 'goScan': go(1); break;
      case 'goReview': go(2); break;
      case 'takePhoto': var ci = $('camInput'); if (ci) ci.click(); break;
      case 'chooseFile': var fi = $('fileInput'); if (fi) fi.click(); break;
      case 'runOcr': runOcr(); break;
      case 'parseOcrText': parseOcrText(); break;
      case 'useScan': if (scanResult) applyScan(scanResult.counts); break;
      case 'cycleSeat': cycleSeat(t.getAttribute('data-seat')); break;
      case 'adjustCount': var cc = categoryCounts(), cat = t.getAttribute('data-cat'); setCategoryCount(cat, cc[cat] + num(t.getAttribute('data-delta'))); break;
      case 'optimizeSeats': arrangeSeats(false); break;
      case 'clearPax': clearPax(); break;
      case 'delPax': delPax(+i); break;
      case 'savePreset': doSavePreset(); break;
      case 'deletePreset': doDeletePreset(document.querySelector('[data-action="loadPreset"]').value); break;
      case 'exportPdf': exportPdf(); break;
      case 'newFlight': newFlight(); break;
    }
  }
  function onChange(e) {
    var el = e.target;
    if (el.matches && el.matches('[data-action="loadPreset"]')) { if (el.value) doLoadPreset(el.value); return; }
    if (el.hasAttribute && el.hasAttribute('data-cat-count')) setCategoryCount(el.getAttribute('data-cat-count'), el.value);
  }

  /* ---------- init ---------- */
  function init() {
    if (!CFG || !ENG || !PARSE || !SEATING) { document.body.innerHTML = '<p style="padding:20px">Failed to load the calculator. Refresh the page and try again.</p>'; return; }
    load();
    var v = $('view');
    v.addEventListener('input', onInput);
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
