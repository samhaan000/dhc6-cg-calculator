/* ============================================================================
 * DHC-6 passenger seating helper
 * ----------------------------------------------------------------------------
 * Produces a longitudinally balanced seating plan from passenger categories or
 * actual weights. The result is advisory: the calculator still validates the
 * completed load against the configured aircraft limits.
 * ========================================================================== */
;(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBSeating = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS_BY_COUNT = { 1: ['B'], 2: ['A', 'C'], 3: ['A', 'B', 'C'] };

  function number(value) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : 0;
  }

  function passengerWeight(passenger, cfg) {
    var override = passenger && passenger.weight;
    if (override !== '' && override != null && isFinite(override) && +override > 0) return +override;
    return cfg.paxWeights[passenger && passenger.cat] || 0;
  }

  function seatGrid(passengers, cfg) {
    var grid = [['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E'], ['E', 'E', 'E']];
    passengers.forEach(function (passenger) {
      var match = /^([1-5])([ABC])$/.exec(String(passenger.seat || '').toUpperCase());
      if (!match) return;
      grid[+match[1] - 1]['ABC'.indexOf(match[2])] = passengerWeight(passenger, cfg);
    });
    return grid;
  }

  function enumerateRowCounts(total) {
    var output = [];
    function walk(row, remaining, counts) {
      if (row === 5) {
        if (remaining === 0) output.push(counts.slice());
        return;
      }
      var min = Math.max(0, remaining - (4 - row) * 3);
      var max = Math.min(3, remaining);
      for (var value = min; value <= max; value++) {
        counts.push(value);
        walk(row + 1, remaining - value, counts);
        counts.pop();
      }
    }
    walk(0, total, []);
    return output;
  }

  function positionsForCounts(counts, cfg) {
    var positions = [];
    counts.forEach(function (count, row) {
      (COLS_BY_COUNT[count] || []).forEach(function (col) {
        positions.push({ label: (row + 1) + col, arm: cfg.seatArms[row] });
      });
    });
    return positions;
  }

  function dryMoment(input, cfg) {
    var dow = Math.max(0, number(input.dow)), doi = number(input.doi), ix = cfg.index;
    if (!dow) return 0;
    return ((((doi - ix.base) * ix.scale) / dow) + ix.refArm) * dow;
  }

  function desiredPassengerMoment(passengers, input, cfg, engine) {
    var totalPassengerWeight = passengers.reduce(function (sum, passenger) { return sum + passengerWeight(passenger, cfg); }, 0);
    if (!(number(input.dow) > 0)) return totalPassengerWeight * cfg.seatArms[2];

    var emptyInput = Object.assign({}, input, { seats: [['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E']] });
    var base = engine.computeMetrics(emptyInput, cfg);
    var targetMac = (cfg.limits.cgFwd + cfg.limits.cgAft) / 2;
    var targetArm = ((targetMac - cfg.mac.base) / cfg.mac.factor) + cfg.mac.refArm;
    var passengerTotal = totalPassengerWeight;
    var tow = base.tow + passengerTotal, lw = base.lw + passengerTotal;
    var toOtherMoment = dryMoment(input, cfg) + base.bm + base.tof * cfg.fuel.arm;
    var laOtherMoment = dryMoment(input, cfg) + base.bm + base.lf * cfg.fuel.arm;
    var toTarget = targetArm * tow - toOtherMoment;
    var laTarget = targetArm * lw - laOtherMoment;
    if (!(tow > 0) || !(lw > 0)) return passengerTotal * cfg.seatArms[2];
    var toWeight = 1 / (tow * tow), laWeight = 1 / (lw * lw);
    return (toTarget * toWeight + laTarget * laWeight) / (toWeight + laWeight);
  }

  function pairForTarget(passengers, positions, target, cfg, reverse) {
    var people = passengers.slice().sort(function (a, b) { return passengerWeight(a, cfg) - passengerWeight(b, cfg); });
    if (reverse) people.reverse();
    var places = positions.slice().sort(function (a, b) { return a.arm - b.arm || a.label.localeCompare(b.label); });
    var pairs = people.map(function (passenger, index) { return { passenger: passenger, position: places[index] }; });
    var moment = pairs.reduce(function (sum, pair) { return sum + passengerWeight(pair.passenger, cfg) * pair.position.arm; }, 0);

    // Pair swaps move the passenger moment toward the desired value while the
    // chosen seats remain fixed. This is deterministic and bounded for 15 pax.
    for (var pass = 0; pass < 20; pass++) {
      var bestDelta = 0, bestDistance = Math.abs(moment - target), bestA = -1, bestB = -1;
      for (var a = 0; a < pairs.length - 1; a++) {
        for (var b = a + 1; b < pairs.length; b++) {
          var wa = passengerWeight(pairs[a].passenger, cfg), wb = passengerWeight(pairs[b].passenger, cfg);
          var aa = pairs[a].position.arm, ab = pairs[b].position.arm;
          var delta = wa * ab + wb * aa - wa * aa - wb * ab;
          var distance = Math.abs(moment + delta - target);
          if (distance + 0.001 < bestDistance) {
            bestDistance = distance; bestDelta = delta; bestA = a; bestB = b;
          }
        }
      }
      if (bestA < 0) break;
      var temp = pairs[bestA].passenger;
      pairs[bestA].passenger = pairs[bestB].passenger;
      pairs[bestB].passenger = temp;
      moment += bestDelta;
    }
    return { pairs: pairs, moment: moment };
  }

  function assignmentScore(passengers, input, cfg, engine) {
    var metrics = engine.computeMetrics(Object.assign({}, input, { seats: seatGrid(passengers, cfg) }), cfg);
    var midpoint = (cfg.limits.cgFwd + cfg.limits.cgAft) / 2;
    var score = Math.pow(metrics.to.mac - midpoint, 2) + Math.pow(metrics.la.mac - midpoint, 2);
    [metrics.to, metrics.la].forEach(function (cg) {
      if (cg.mac < cfg.limits.cgFwd) score += 10000 + Math.pow(cfg.limits.cgFwd - cg.mac, 2) * 100;
      if (cg.mac > cfg.limits.cgAft) score += 10000 + Math.pow(cg.mac - cfg.limits.cgAft, 2) * 100;
      var zone = engine.indexZone(cg.index, cfg);
      if (zone.level === 'red') score += 2500;
      else if (zone.level === 'amber') score += 150;
    });
    return { score: score, metrics: metrics };
  }

  function optimize(passengers, input, cfg, engine) {
    var known = passengers.filter(function (passenger) { return cfg.paxWeights[passenger.cat] > 0 || passengerWeight(passenger, cfg) > 0; });
    if (!known.length || known.length !== passengers.length || known.length > 15) return { passengers: passengers.slice(), changed: false, reason: 'Passenger categories are incomplete.' };
    var target = desiredPassengerMoment(known, input, cfg, engine);
    var best = null;

    enumerateRowCounts(known.length).forEach(function (counts) {
      var positions = positionsForCounts(counts, cfg);
      [false, true].forEach(function (reverse) {
        var paired = pairForTarget(known, positions, target, cfg, reverse);
        var candidate = paired.pairs.map(function (pair) { return Object.assign({}, pair.passenger, { seat: pair.position.label }); });
        var evaluated = assignmentScore(candidate, input, cfg, engine);
        // A tiny compactness tie-breaker avoids awkward edge-heavy plans when
        // two arrangements give effectively identical longitudinal CG.
        var compactness = counts.reduce(function (sum, count, row) { return sum + count * Math.abs(row - 2); }, 0) * 0.0001;
        evaluated.score += compactness;
        if (!best || evaluated.score < best.score) best = { passengers: candidate, score: evaluated.score, metrics: evaluated.metrics };
      });
    });

    if (!best) return { passengers: passengers.slice(), changed: false, reason: 'No valid 15-seat arrangement was found.' };
    return { passengers: best.passengers, changed: true, metrics: best.metrics, targetMoment: target };
  }

  return { optimize: optimize, seatGrid: seatGrid, passengerWeight: passengerWeight, enumerateRowCounts: enumerateRowCounts };
});
