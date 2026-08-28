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
    passengers.filter(function (passenger) { return passenger.cat === 'M' || passenger.cat === 'F' || passenger.cat === 'C'; }).forEach(function (passenger) {
      var match = /^([1-5])([ABC])$/.exec(String(passenger.seat || '').toUpperCase());
      if (!match) return;
      grid[+match[1] - 1]['ABC'.indexOf(match[2])] = passengerWeight(passenger, cfg);
    });
    // A lap infant contributes weight at the accompanying passenger's arm but
    // does not occupy or overwrite a separate cabin seat.
    passengers.filter(function (passenger) { return passenger.cat === 'I'; }).forEach(function (passenger) {
      var match = /^([1-5])([ABC])$/.exec(String(passenger.seat || '').toUpperCase());
      if (!match) return;
      var row = +match[1] - 1, col = 'ABC'.indexOf(match[2]), occupantWeight = grid[row][col];
      if (typeof occupantWeight === 'number' && occupantWeight > 0) grid[row][col] += passengerWeight(passenger, cfg);
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

  function desiredPassengerMoment(passengers, input, cfg, engine, preferredIndex) {
    var totalPassengerWeight = passengers.reduce(function (sum, passenger) { return sum + passengerWeight(passenger, cfg); }, 0);
    if (!(number(input.dow) > 0)) return totalPassengerWeight * cfg.seatArms[2];

    var emptyInput = Object.assign({}, input, { seats: [['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E'],['E','E','E']] });
    var base = engine.computeMetrics(emptyInput, cfg);
    var passengerTotal = totalPassengerWeight;
    var tow = base.tow + passengerTotal, lw = base.lw + passengerTotal;
    var toOtherMoment = dryMoment(input, cfg) + base.bm + base.tof * cfg.fuel.arm;
    var laOtherMoment = dryMoment(input, cfg) + base.bm + base.lf * cfg.fuel.arm;
    if (!(tow > 0) || !(lw > 0)) return passengerTotal * cfg.seatArms[2];
    if (isFinite(preferredIndex) && preferredIndex !== null) {
      var preferredArm = (((+preferredIndex - cfg.index.base) * cfg.index.scale) / tow) + cfg.index.refArm;
      return preferredArm * tow - toOtherMoment;
    }
    var targetMac = (cfg.limits.cgFwd + cfg.limits.cgAft) / 2;
    var targetArm = ((targetMac - cfg.mac.base) / cfg.mac.factor) + cfg.mac.refArm;
    var toTarget = targetArm * tow - toOtherMoment;
    var laTarget = targetArm * lw - laOtherMoment;
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

  function assignmentScore(passengers, input, cfg, engine, preferredIndex) {
    var metrics = engine.computeMetrics(Object.assign({}, input, { seats: seatGrid(passengers, cfg) }), cfg);
    var midpoint = (cfg.limits.cgFwd + cfg.limits.cgAft) / 2;
    var hasPreference = isFinite(preferredIndex) && preferredIndex !== null;
    var score = hasPreference
      ? Math.pow(metrics.to.index - preferredIndex, 2) * 200 + Math.pow(metrics.la.mac - midpoint, 2) * 0.25
      : Math.pow(metrics.to.mac - midpoint, 2) + Math.pow(metrics.la.mac - midpoint, 2);
    var hardSafety = 0, cautions = 0;
    [metrics.to, metrics.la].forEach(function (cg) {
      if (cg.mac < cfg.limits.cgFwd) hardSafety += 1 + Math.pow(cfg.limits.cgFwd - cg.mac, 2);
      if (cg.mac > cfg.limits.cgAft) hardSafety += 1 + Math.pow(cg.mac - cfg.limits.cgAft, 2);
      var zone = engine.indexZone(cg.index, cfg);
      if (zone.level === 'red') hardSafety += 1;
      else if (zone.level === 'amber') cautions += 1;
    });
    // Safety is lexicographically more important than matching a preference:
    // first avoid red limits, then avoid caution zones, then approach the
    // pilot's requested takeoff index.
    score += hardSafety * 1000000000 + cautions * 1000000;
    return { score: score, metrics: metrics };
  }

  function optimize(passengers, input, cfg, engine, options) {
    options = options || {};
    var preferredIndex = options.preferredIndex;
    preferredIndex = preferredIndex !== '' && preferredIndex !== null && preferredIndex !== undefined && isFinite(+preferredIndex) ? +preferredIndex : null;
    var occupants = passengers.filter(function (passenger) { return passenger.cat !== 'I'; });
    var infants = passengers.filter(function (passenger) { return passenger.cat === 'I'; });
    var categoriesComplete = occupants.every(function (passenger) { return passenger.cat === 'M' || passenger.cat === 'F' || passenger.cat === 'C'; });
    if (!occupants.length || !categoriesComplete) return { passengers: passengers.slice(), changed: false, reason: 'Passenger categories are incomplete.' };
    if (occupants.length > 15) return { passengers: passengers.slice(), changed: false, reason: 'More than 15 occupied seats were entered.' };

    // Each infant is paired with one adult passenger. Pairing is automatic
    // because passenger names are optional; the seat can still be changed by
    // moving the accompanying adult in the cabin view.
    var units = occupants.map(function (passenger) {
      return { cat: passenger.cat, weight: passengerWeight(passenger, cfg), basePassenger: passenger, lapInfants: [] };
    });
    var adultUnits = units.filter(function (unit) { return unit.cat === 'M' || unit.cat === 'F'; });
    if (infants.length > adultUnits.length) return { passengers: passengers.slice(), changed: false, reason: 'Each infant needs a separate accompanying adult.' };
    infants.forEach(function (infant, index) {
      adultUnits[index].lapInfants.push(infant);
      adultUnits[index].weight += passengerWeight(infant, cfg);
    });

    var target = desiredPassengerMoment(units, input, cfg, engine, preferredIndex);
    var best = null;

    enumerateRowCounts(units.length).forEach(function (counts) {
      var positions = positionsForCounts(counts, cfg);
      [false, true].forEach(function (reverse) {
        var paired = pairForTarget(units, positions, target, cfg, reverse);
        var candidate = [];
        paired.pairs.forEach(function (pair) {
          var seat = pair.position.label, unit = pair.passenger;
          candidate.push(Object.assign({}, unit.basePassenger, { seat: seat }));
          unit.lapInfants.forEach(function (infant) { candidate.push(Object.assign({}, infant, { seat: seat })); });
        });
        var evaluated = assignmentScore(candidate, input, cfg, engine, preferredIndex);
        // A tiny compactness tie-breaker avoids awkward edge-heavy plans when
        // two arrangements give effectively identical longitudinal CG.
        var compactness = counts.reduce(function (sum, count, row) { return sum + count * Math.abs(row - 2); }, 0) * 0.0001;
        evaluated.score += compactness;
        if (!best || evaluated.score < best.score) best = { passengers: candidate, score: evaluated.score, metrics: evaluated.metrics };
      });
    });

    if (!best) return { passengers: passengers.slice(), changed: false, reason: 'No valid 15-seat arrangement was found.' };
    return { passengers: best.passengers, changed: true, metrics: best.metrics, targetMoment: target, preferredIndex: preferredIndex, achievedIndex: best.metrics.to.index };
  }

  return { optimize: optimize, seatGrid: seatGrid, passengerWeight: passengerWeight, enumerateRowCounts: enumerateRowCounts };
});
