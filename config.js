/* ============================================================================
 * DHC-6 Twin Otter — Aircraft Weight & Balance configuration
 * ----------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for every aircraft-critical value used by the
 * calculation engine. Nothing weight/CG-related should be hardcoded anywhere
 * else in the app — edit it here so it stays auditable.
 *
 * !!! SAFETY !!!
 * These values are a PROTOTYPE baseline carried over from the previous
 * calculator. They are NOT verified against an operator-approved DHC-6
 * weight & balance manual. Before any operational use, every arm, index
 * constant, weight, limit and the MAC conversion MUST be checked against the
 * current approved aircraft data and SOP. Keep `verified` false until then.
 *
 * Loadable both in the browser (sets window.DHC6_CONFIG) and in Node
 * (module.exports) so the engine can be unit-tested.
 * ========================================================================== */
;(function (root, factory) {
  var cfg = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = cfg;
  root.DHC6_CONFIG = cfg;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    meta: {
      type: 'DHC-6 Twin Otter (floats)',
      units: 'lb',
      verified: false,            // set true ONLY after audit vs approved data
      source: 'Prototype baseline — verify against approved DHC-6 W&B manual',
      revised: '2026-06-14'
    },

    // Standard passenger weights by category (lb). These are defaults; the
    // review screen lets the user override any passenger's actual weight.
    // E = empty seat. I = lap infant; weight is applied at the accompanying
    // adult passenger's seat arm. Verify the standard weight/operator policy.
    paxWeights: { E: 0, M: 189, F: 150, C: 77, I: 30 },

    // Seat-row reference arms (in), rows 1..5 (Front .. Rear).
    seatArms: [135, 165, 195, 225, 254],

    // Baggage / special-load station arms (in).
    stations: {
      stretcher: 224.70,
      bagR4:     225.00,   // seat-row 4 baggage
      bagR5:     254.00,   // seat-row 5 baggage
      bagD:      302.00,   // area D baggage
      bagAft:    354.00,   // aft compartment
      bagShelf:  391.00    // aft shelf
    },

    // Fuel.
    fuel: {
      arm: 201.7,          // fuel station arm (in)
      takeoffOffset: 50    // takeoff fuel = block fuel - this (when block > 0)
    },

    // Index system constants.  index = ((arm - refArm) * weight / scale) + base
    // The dry-operating moment is reconstructed from DOI with the same refs:
    //   DOM arm = ((DOI - base) * scale / DOW) + refArm
    index: { refArm: 210, scale: 10000, base: 10 },

    // %MAC conversion.  %MAC = (arm - refArm) * factor + base
    mac: { refArm: 207.74, factor: 1.282, base: 25 },

    // Operating limits.
    limits: {
      mtow: 12500,         // max takeoff weight (lb)
      cgFwd: 25,           // forward CG limit (%MAC)
      cgAft: 32            // aft CG limit (%MAC)
    },

    // Float index advisory zones (index units) used for caution/limit banners.
    indexZones: {
      min: 5.0,
      fwdRedMax: 7.2,      // below this = forward limit (red)
      fwdAmberMax: 8.8,    // up to this = forward caution (amber)
      aftAmberMin: 11.0,   // up to this = normal (green)
      aftRedMin: 12.8,     // up to this = aft caution (amber); above = aft limit (red)
      max: 14.2
    },

    // Documented example/test values. NOT auto-filled into the form — the
    // operator must enter and verify the current aircraft's DOW/DOI.
    defaults: { dow: 9142, doi: 13.8 }
  };
});
