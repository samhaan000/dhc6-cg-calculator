/* ============================================================================
 * DHC-6 Weight & Balance calculation engine
 * ----------------------------------------------------------------------------
 * Pure, UI-free calculation logic. Takes a structured loading object plus an
 * aircraft config (see config.js) and returns weights, moments, index, %MAC
 * and limit status. No DOM access — so it can be unit-tested in Node.
 *
 * The formulas are intentionally identical to the original calculator; the
 * only change is that aircraft-critical numbers now come from `cfg` instead of
 * being hardcoded here.
 *
 * Loadable in the browser (window.WBEngine) and in Node (module.exports).
 * ========================================================================== */
;(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function num(x) { var v = parseFloat(x); return isFinite(v) ? v : 0; }

  function fmt2(x) {
    return Number(x || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  /**
   * Compute all weight & balance metrics.
   * @param {Object} input  { seats:[[cat,cat,cat]x5], dow, doi, block, trip,
   *                          stretcher, bagD, bagAft, bagShelf, bagR5, bagR4 }
   * @param {Object} cfg    aircraft config (DHC6_CONFIG)
   * @returns {Object}      { pr, pax, pm, bag, bm, payload, zfw, tof, lf,
   *                          tow, lw, to:{arm,index,mac}, la:{arm,index,mac} }
   */
  function computeMetrics(input, cfg) {
    var W = cfg.paxWeights, arms = cfg.seatArms, S = cfg.stations,
        F = cfg.fuel, IX = cfg.index, MC = cfg.mac;

    var seats = input.seats || [];
    // A seat cell is either a category code (standard weight from config) or a
    // number (an actual/override weight in lb). Same moment formula either way.
    var pr = seats.map(function (r) {
      return r.reduce(function (a, k) { return a + (typeof k === 'number' ? k : (W[k] || 0)); }, 0);
    });

    var pax = pr.reduce(function (a, b) { return a + b; }, 0);
    var pm = pr.reduce(function (a, w, i) { return a + w * arms[i]; }, 0);

    var st = num(input.stretcher);
    pax += st;
    pm += st * S.stretcher;

    var bd = num(input.bagD), ba = num(input.bagAft), bs = num(input.bagShelf),
        br5 = num(input.bagR5), br4 = num(input.bagR4);
    var bag = bd + ba + bs + br5 + br4;
    var bm = bd * S.bagD + ba * S.bagAft + bs * S.bagShelf + br5 * S.bagR5 + br4 * S.bagR4;

    var dow = num(input.dow), doi = num(input.doi),
        block = num(input.block), trip = num(input.trip);

    var payload = pax + bag;
    var zfw = dow + payload;
    var tof = block > 0 ? block - F.takeoffOffset : 0;
    var lf = tof - trip;
    var tow = zfw + tof;
    var lw = tow - trip;

    var dm = 0;
    if (dow > 0) {
      var da = (((doi - IX.base) * IX.scale) / dow) + IX.refArm;
      dm = da * dow;
    }

    function cg(w, fuel) {
      var m = dm + pm + bm + fuel * F.arm;
      var arm = w ? m / w : 0;
      return {
        arm: arm,
        index: (((arm - IX.refArm) * w) / IX.scale) + IX.base,
        mac: ((arm - MC.refArm) * MC.factor) + MC.base
      };
    }

    return {
      pr: pr, pax: pax, pm: pm, bag: bag, bm: bm,
      payload: payload, zfw: zfw, tof: tof, lf: lf, tow: tow, lw: lw,
      to: cg(tow, tof), la: cg(lw, lf)
    };
  }

  /** Classify a float index value into an advisory zone. */
  function indexZone(i, cfg) {
    var Z = cfg.indexZones;
    if (!isFinite(i)) return { level: 'red', name: 'INVALID INDEX', msg: 'Index missing/invalid' };
    if (i < Z.fwdRedMax) return { level: 'red', name: 'FWD LIMIT FLOATS', msg: 'Index ' + fmt2(i) + ' is in/forward of float forward limit zone ' + Z.min + '–' + Z.fwdRedMax };
    if (i < Z.fwdAmberMax) return { level: 'amber', name: 'FWD CAUTION ZONE', msg: 'Index ' + fmt2(i) + ' is in float forward caution zone ' + Z.fwdRedMax + '–' + Z.fwdAmberMax };
    if (i <= Z.aftAmberMin) return { level: 'green', name: 'NORMAL FLOAT ZONE', msg: 'Index ' + fmt2(i) + ' is in normal float zone' };
    if (i <= Z.aftRedMin) return { level: 'amber', name: 'AFT CAUTION ZONE', msg: 'Index ' + fmt2(i) + ' is in float aft caution zone ' + Z.aftAmberMin + '–' + Z.aftRedMin };
    return { level: 'red', name: 'AFT LIMIT FLOATS', msg: 'Index ' + fmt2(i) + ' is in/aft of float aft limit zone ' + Z.aftRedMin + '–' + Z.max };
  }

  /** True when %MAC is within the configured fwd/aft CG limits. */
  function macInLimit(mac, cfg) {
    return isFinite(mac) && mac >= cfg.limits.cgFwd && mac <= cfg.limits.cgAft;
  }

  return { computeMetrics: computeMetrics, indexZone: indexZone, macInLimit: macInLimit, num: num };
});
