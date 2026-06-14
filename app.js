/* ============================================================================
 * DHC-6 CG Calculator — wizard controller (UI only)
 * Flow: Dashboard → Scan → Review & Correction → Cargo & Fuel → Results
 * Calculation lives in engine.js (WBEngine) with data from config.js
 * (DHC6_CONFIG). OCR text parsing lives in parsers.js (WBParsers).
 * ========================================================================== */
(function () {
  'use strict';
  var CFG = window.DHC6_CONFIG, ENG = window.WBEngine, PARSE = window.WBParsers;

  var STEPS = ['Dashboard', 'Scan', 'Review', 'Cargo & Fuel', 'Results'];
  var SEATS = (function () { var a = [], r, c, C = ['A', 'B', 'C']; for (r = 1; r <= 5; r++) for (c = 0; c < 3; c++) a.push(r + C[c]); return a; })();
  var CAT_LABEL = { M: 'Male', F: 'Female', C: 'Child', I: 'Infant', '?': 'Needs review' };
  function isCat(c) { return c === 'M' || c === 'F' || c === 'C' || c === 'I'; }
  var STATE_KEY = 'dhc6_flight_v2', PRESET_KEY = 'dhc6_aircraft_presets_v1';

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

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() { try { var s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); if (s && s.aircraft) { state = Object.assign(state, s); state.step = 0; } } catch (e) {} }
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
    var m = ENG.computeMetrics(engineInput(), CFG);
    var issues = [];
    var a = state.aircraft;
    if (!(num(a.dow) > 0)) issues.push({ level: 'red', text: 'Enter aircraft DOW.' });
    if (num(a.doi) === 0) issues.push({ level: 'red', text: 'Enter aircraft DOI.' });
    if (!(num(state.fuel.block) > 0)) issues.push({ level: 'amber', text: 'Enter block fuel.' });
    if (!state.pax.length) issues.push({ level: 'amber', text: 'No passengers added.' });

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

    var ready = num(a.dow) > 0 && num(a.doi) !== 0 && num(state.fuel.block) > 0 && state.pax.length > 0 && needReview.length === 0 && !dup;
    var hasRed = issues.some(function (i) { return i.level === 'red'; });
    var hasAmber = issues.some(function (i) { return i.level === 'amber'; });
    var level = hasRed ? 'red' : (hasAmber ? 'amber' : 'green');
    var paxCount = state.pax.length, paxWt = state.pax.reduce(function (s, p) { return s + paxWeight(p); }, 0);
    return { m: m, issues: issues, level: level, ready: ready, tz: tz, lz: lz, toMacOk: toMacOk, laMacOk: laMacOk, needReview: needReview, paxCount: paxCount, paxWt: paxWt };
  }

  /* ---------- shared UI bits ---------- */
  function statusWord(level, ready) {
    if (!ready) return { word: 'REVIEW NEEDED', cls: 'amber' };
    if (level === 'green') return { word: 'WITHIN LIMITS', cls: 'green' };
    if (level === 'amber') return { word: 'CAUTION', cls: 'amber' };
    return { word: 'OUT OF LIMITS', cls: 'red' };
  }
  function statCard(k, v, cls) { return '<div class="stat ' + (cls || '') + '"><span class="k">' + k + '</span><b class="v num">' + v + '</b></div>'; }

  /* ---------- step: Dashboard ---------- */
  function renderHero() {
    var c = compute(), s = statusWord(c.level, c.ready);
    return '<section class="card hero-card" id="dashHero">' +
      '<div class="hero-row"><div><div class="hero-type">DHC-6 Twin Otter</div><div class="muted sm">Weight &amp; Balance</div></div>' +
      '<span class="chip ' + s.cls + '">' + s.word + '</span></div>' +
      '<div class="stat-grid-3" style="margin-top:14px">' +
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

      '<section class="card">' +
        '<h2>Aircraft</h2>' +
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
        '<h2>Flight</h2>' +
        '<div class="grid-3">' +
          field('Flight No.', 'flight.no', state.flight.no, 'text', 'Q2-201') +
          field2('Route', 'flight.route', state.flight.route, 'text', 'MLE–DRV') +
        '</div>' +
      '</section>' +

      '<div class="cta-grid">' +
        '<button class="btn primary big" data-action="goScan"><svg viewBox="0 0 24 24" class="i"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>Scan Manifest</button>' +
        '<button class="btn ghost big" data-action="goReview">Manual Entry</button>' +
      '</div>' +
      '<button class="btn subtle block" data-action="newFlight">Start New Flight</button>';
  }
  function field(label, bind, val, type, ph) { return '<div class="field"><label>' + label + '</label><input data-bind="' + bind + '" type="' + (type || 'text') + '" ' + (type === 'number' ? 'inputmode="decimal"' : 'autocomplete="off"') + ' value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"></div>'; }
  function field2(label, bind, val, type, ph) { return '<div class="field" style="grid-column:span 2"><label>' + label + '</label><input data-bind="' + bind + '" type="' + (type || 'text') + '" autocomplete="off" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"></div>'; }

  /* ---------- step: Scan ---------- */
  function renderScan() {
    return '' +
      '<section class="card">' +
        '<h2>Scan Passenger Manifest</h2>' +
        '<p class="muted sm">Take a photo or upload an image of the passenger manifest. OCR runs on-device and can misread — you review every passenger next.</p>' +
        '<div class="dropzone"><svg viewBox="0 0 24 24" class="i-lg"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span id="fileName">No file selected</span></div>' +
        '<div class="grid-2">' +
          '<button class="btn ghost" data-action="takePhoto"><svg viewBox="0 0 24 24" class="i"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>Take Photo</button>' +
          '<button class="btn ghost" data-action="chooseFile"><svg viewBox="0 0 24 24" class="i"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>Upload Image</button>' +
        '</div>' +
        '<input id="camInput" type="file" accept="image/*" capture="environment" hidden>' +
        '<input id="fileInput" type="file" accept="image/*" hidden>' +
        '<button class="btn primary block" data-action="runOcr">Scan Document</button>' +
        '<div id="scanProgress" class="progress"></div>' +
        '<p id="scanStatus" class="muted sm">First scan may need internet to load the OCR engine.</p>' +
        '<details class="acc"><summary>OCR text</summary><textarea id="ocrText" readonly placeholder="OCR result appears here">' + esc(state.ocrText) + '</textarea></details>' +
      '</section>' +
      '<button class="btn ghost block" data-action="goReview">Skip scan — enter manually</button>';
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
    return '<div class="seatmap">' + html + '</div>';
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
        '<input class="cell name" data-bind="pax.' + i + '.name" value="' + esc(p.name) + '" placeholder="Name (optional)">' +
        '<input class="cell wt num" type="number" inputmode="decimal" data-bind="pax.' + i + '.weight" value="' + (p.weight > 0 ? p.weight : '') + '" placeholder="' + ph + '">' +
        '<button class="iconbtn" data-action="delPax" data-i="' + i + '" aria-label="Remove">&times;</button>' +
      '</div>';
    }).join('');
    return '' +
      '<section class="card">' +
        '<div class="card-head"><h2>Review &amp; Correction</h2><div class="head-chip" id="reviewChip"><b>' + c.paxCount + ' pax</b> &middot; <b>' + f(c.paxWt) + ' lb</b></div></div>' +
        '<p class="muted sm" style="margin-top:0">Tap a seat to add a passenger; tap again to cycle Male &rarr; Female &rarr; Child &rarr; Infant &rarr; clear.</p>' +
        renderSeatMap() +
        '<div class="seat-legend sm"><span class="lg cat-M">M Male</span><span class="lg cat-F">F Female</span><span class="lg cat-C">C Child</span><span class="lg cat-I">I Infant</span></div>' +
        (c.needReview.length ? '<div class="banner amber sm">' + c.needReview.length + ' seat(s) marked &quot;?&quot; &mdash; tap to set the category before calculating.</div>' : '') +
        (list ? '<div class="paxlist">' + list + '</div>' : '<p class="muted sm" style="text-align:center;padding:8px">No passengers yet &mdash; tap a seat above.</p>') +
        (list ? '<button class="btn ghost block" data-action="clearPax">Clear all passengers</button>' : '') +
      '</section>' +
      '<div class="legend sm muted">Standard weights &mdash; M ' + CFG.paxWeights.M + ' / F ' + CFG.paxWeights.F + ' / C ' + CFG.paxWeights.C + ' / I ' + CFG.paxWeights.I + ' lb. Leave a weight blank to use the standard.</div>';
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
  function clearPax() { if (!state.pax.length) return; if (!confirm('Remove all passengers?')) return; state.pax = []; render(); }

  /* ---------- step: Cargo & Fuel ---------- */
  function renderCargo() {
    var S = CFG.stations;
    return '' +
      '<section class="card">' +
        '<h2>Fuel</h2>' +
        '<div class="grid-2">' +
          field('Block fuel (lb)', 'fuel.block', state.fuel.block, 'number') +
          field('Trip fuel (lb)', 'fuel.trip', state.fuel.trip, 'number') +
        '</div>' +
        '<p class="muted sm">Takeoff fuel = block − ' + CFG.fuel.takeoffOffset + ' lb.</p>' +
      '</section>' +
      '<section class="card">' +
        '<h2>Baggage / Cargo zones</h2>' +
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
      liveSummary();
  }
  function liveSummary() {
    var c = compute(), m = c.m, s = statusWord(c.level, c.ready);
    return '<section class="card live"><div class="card-head"><h2>Running totals</h2><span class="chip ' + s.cls + '">' + s.word + '</span></div>' +
      '<div class="stat-grid-3">' + statCard('ZFW', f(m.zfw) + ' lb') + statCard('TOW', f(m.tow) + ' lb', m.tow > CFG.limits.mtow ? 'bad' : 'hl') + statCard('TO %MAC', f(m.to.mac, 1) + '%', c.toMacOk ? 'good' : 'bad') + '</div></section>';
  }

  /* ---------- step: Results ---------- */
  function renderResults() {
    var c = compute(), m = c.m, s = statusWord(c.level, c.ready);
    var issues = c.issues.length ? '<ul class="issues">' + c.issues.map(function (i) { return '<li class="' + i.level + '">' + esc(i.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted sm">All checks passed within the configured limits.</p>';
    return '' +
      '<section class="card banner-card ' + s.cls + '">' +
        '<div class="banner-word">' + s.word + '</div>' +
        '<div class="banner-sub">' + (c.ready ? ('CG ' + f(m.to.mac, 1) + '% MAC · TOW ' + f(m.tow) + ' lb') : 'Complete the required fields to finalize') + '</div>' +
      '</section>' +
      '<section class="card"><h2>CG Envelope</h2>' + envelopeSVG(m, c) + '<div class="legend sm muted" style="justify-content:center">Safe band ' + CFG.limits.cgFwd + '–' + CFG.limits.cgAft + '% MAC up to MTOW ' + f(CFG.limits.mtow) + ' lb</div></section>' +
      '<section class="card"><div class="card-head"><h2>Cabin Layout</h2><div class="head-chip"><b>' + c.paxCount + ' pax</b> &middot; <b>' + f(c.paxWt) + ' lb</b></div></div>' + renderSeatMap(true) + '<div class="seat-legend sm"><span class="lg cat-M">M Male</span><span class="lg cat-F">F Female</span><span class="lg cat-C">C Child</span><span class="lg cat-I">I Infant</span></div></section>' +
      '<section class="card">' +
        '<h2>Weight &amp; Balance</h2>' +
        '<div class="stat-grid-3">' +
          statCard('Zero Fuel Wt', f(m.zfw) + ' lb') + statCard('Takeoff Wt', f(m.tow) + ' lb', m.tow > CFG.limits.mtow ? 'bad' : 'hl') + statCard('Landing Wt', f(m.lw) + ' lb') +
          statCard('Payload', f(m.payload) + ' lb') + statCard('Takeoff Fuel', f(m.tof) + ' lb') + statCard('Underload', f(CFG.limits.mtow - m.tow) + ' lb', (m.tow <= CFG.limits.mtow && m.tow > 0) ? 'good' : '') +
        '</div>' +
        '<div class="cg-2">' +
          cgCard('Takeoff', m.to, c.toMacOk, c.tz) +
          cgCard('Landing', m.la, c.laMacOk, c.lz) +
        '</div>' +
      '</section>' +
      '<section class="card"><h2>Checks</h2>' + issues + '</section>' +
      '<button class="btn primary big block" data-action="exportPdf"' + (c.ready ? '' : ' disabled') + '>Export / Print Load Sheet</button>' +
      (c.ready ? '' : '<p class="muted sm" style="text-align:center">Export is blocked until all required data is reviewed.</p>') +
      '<p class="muted sm disclaimer">Prototype output. Verify all loading, fuel, CG/index and limits against approved aircraft / operator documents before operational use.</p>';
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
      var cls = i === state.step ? 'on' : (i < state.step ? 'done' : '');
      return '<button class="stepdot ' + cls + '" data-action="goto" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t">' + name + '</span></button>';
    }).join('');
  }
  function renderNav() {
    var prev = state.step > 0 ? '<button class="btn ghost" data-action="prev">Back</button>' : '<span></span>';
    var next = state.step < STEPS.length - 1 ? '<button class="btn primary" data-action="next">' + (state.step === 0 ? 'Continue' : (state.step === 3 ? 'Calculate CG' : 'Next')) + '</button>' : '<button class="btn ghost" data-action="goto" data-i="0">New Flight</button>';
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
  var selectedFile = null;
  function wireScanInputs() {
    ['camInput', 'fileInput'].forEach(function (id) {
      var inp = $(id);
      if (inp) inp.onchange = function () {
        if (inp.files && inp.files[0]) {
          selectedFile = inp.files[0];
          var fn = $('fileName'); if (fn) fn.textContent = selectedFile.name;
          setScan('Ready to scan: ' + selectedFile.name);
        }
      };
    });
    if (selectedFile) { var fn = $('fileName'); if (fn) fn.textContent = selectedFile.name; }
  }
  function runOcr() {
    if (!selectedFile) { setScan('Take a photo or upload an image first.'); return; }
    if (!window.Tesseract) { setScan('OCR engine not loaded — internet may be needed the first time.'); return; }
    setScan('Scanning…'); setProgress('starting');
    window.Tesseract.recognize(selectedFile, 'eng', { logger: function (mm) { if (mm.status) setProgress(mm.status + (mm.progress ? ' ' + Math.round(mm.progress * 100) + '%' : '')); } })
      .then(function (res) {
        var text = (res && res.data && res.data.text) || ''; state.ocrText = text;
        var c = PARSE.parseManifestCounts(text);
        applyScan(c); setProgress('done');
      })
      .catch(function (e) { console.error(e); setProgress('failed'); setScan('OCR failed. Try a clearer, straight photo or enter passengers manually.'); });
  }
  function applyScan(c) {
    var list = [], i;
    for (i = 0; i < (c.male || 0); i++) list.push('M');
    for (i = 0; i < (c.female || 0); i++) list.push('F');
    for (i = 0; i < (c.child || 0); i++) list.push('C');
    for (i = 0; i < (c.unknown || 0); i++) list.push('?');
    list = list.slice(0, 15);
    state.pax = list.map(function (cat, idx) { return { id: uid(), name: 'Pax ' + (idx + 1), cat: cat, seat: SEATS[idx] }; });
    if (c.load) {
      var bag = (c.load.luggage || 0) + (c.load.cargo || 0); if (bag) state.cargo.bagD = bag;
      if (c.load.takeoffFuel) state.fuel.block = c.load.takeoffFuel + CFG.fuel.takeoffOffset;
      if (c.load.burnFuel) state.fuel.trip = c.load.burnFuel;
    }
    toast('Detected ' + (c.male || 0) + 'M / ' + (c.female || 0) + 'F / ' + (c.child || 0) + 'C' + (c.unknown ? ' / ' + c.unknown + ' unclear' : '') + ' (' + c.confidence + ' confidence). Review each passenger.');
    go(2);
  }
  function setScan(t) { var e = $('scanStatus'); if (e) e.textContent = t; }
  function setProgress(t) { var e = $('scanProgress'); if (e) e.textContent = t ? 'OCR: ' + t : ''; }

  /* ---------- PDF / print ---------- */
  function exportPdf() {
    var c = compute(), m = c.m, s = statusWord(c.level, c.ready), now = new Date().toLocaleString();
    function rows(title, arr) { return '<div class="ps-sec"><h3>' + title + '</h3>' + arr.map(function (r) { return '<div class="ps-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>'; }
    var paxRows = state.pax.map(function (p) { return '<div class="ps-row"><span>' + esc(p.name) + ' · ' + (CAT_LABEL[p.cat] || '?') + ' · ' + esc(p.seat || '—') + '</span><b>' + (p.cat === '?' ? '—' : f(paxWeight(p)) + ' lb') + '</b></div>'; }).join('');
    $('printSheet').innerHTML =
      '<div class="ps-head"><div><div class="ps-title">DHC-6 CG / LOAD SHEET</div><div class="ps-sub">Weight &amp; Balance Summary</div></div>' +
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
      '<div class="ps-note">Prototype output. Verify all loading, fuel, CG/index and limits against approved aircraft / operator documents before operational use.</div>' +
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
    go(0);
  }

  /* ---------- events ---------- */
  function onInput(e) {
    var el = e.target, bind = el.getAttribute && el.getAttribute('data-bind');
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
      case 'cycleSeat': cycleSeat(t.getAttribute('data-seat')); break;
      case 'clearPax': clearPax(); break;
      case 'delPax': delPax(+i); break;
      case 'savePreset': doSavePreset(); break;
      case 'deletePreset': doDeletePreset(document.querySelector('[data-action="loadPreset"]').value); break;
      case 'exportPdf': exportPdf(); break;
      case 'newFlight': newFlight(); break;
    }
  }
  function onChange(e) { var el = e.target; if (el.matches && el.matches('[data-action="loadPreset"]')) { if (el.value) doLoadPreset(el.value); } }

  /* ---------- init ---------- */
  function init() {
    if (!CFG || !ENG) { document.body.innerHTML = '<p style="padding:20px">Failed to load calculation engine.</p>'; return; }
    load();
    var v = $('view');
    v.addEventListener('input', onInput);
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
