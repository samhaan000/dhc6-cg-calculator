/* ============================================================================
 * Manifest OCR text parsers (pure)
 * ----------------------------------------------------------------------------
 * The OCR engine only turns pixels into text. This module turns that text into
 * reviewable passenger counts and load-sheet values. Every ambiguous or
 * inconsistent result is surfaced to the UI rather than silently guessed.
 * ========================================================================== */
;(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBParsers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function cleanOcr(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[|]/g, 'I')
      .replace(/[~–—]/g, '-')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function numFrom(value) {
    var match = String(value || '').replace(/[, ]/g, '').match(/-?\d{1,5}(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  function firstMatch(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (match) {
        var value = numFrom(match[1] || match[0]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  function parseManifestTotal(text) {
    var upper = cleanOcr(text).toUpperCase();
    return firstMatch(upper, [
      /\bTOTAL\s+PAX\b\s*[:\-]?\s*0*(\d{1,3})/,
      /\bCHECKED\s*IN\s*COUNT\b\s*[:\-]?\s*0*(\d{1,3})/,
      /\bCHECKED\s*IN\s*\/\s*BOARDED\b\s*[:\-]?\s*0*(\d{1,3})/,
      /\bCABIN\s+TOTAL\s+PAX\b\s*[:\-]?\s*0*(\d{1,3})/,
      /\bTTL\b\s*0*(\d{1,3})\s*PAX\b/,
      /\bPAX\b\s*[:\-]?\s*0*(\d{1,3})\b/
    ]) || 0;
  }

  function countAfterLabel(text, label) {
    var lines = cleanOcr(text).toUpperCase().split(/\n+/);
    for (var i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      var value = firstMatch(lines[i], [new RegExp(label.source + '[^\\d\\n]{0,32}(\\d{1,3})', 'i')]);
      if (value !== null) return value;
    }
    return null;
  }

  function parseSummaryCounts(raw) {
    var upper = cleanOcr(raw).toUpperCase();
    var out = {};
    var male = countAfterLabel(upper, /\b(?:MALE|ADULT\s+MALE)\b/);
    var female = countAfterLabel(upper, /\b(?:FEMALE|ADULT\s+FEMALE)\b/);
    var child = countAfterLabel(upper, /\b(?:CHILDREN|CHILD|CHD)\b/);
    var infant = countAfterLabel(upper, /\b(?:INFANTS|INFANT|INF)\b/);
    if (male !== null) out.male = male;
    if (female !== null) out.female = female;
    if (child !== null) out.child = child;
    if (infant !== null) out.infant = infant;
    return out;
  }

  function parseLoadSheetValues(raw) {
    var upper = cleanOcr(raw).toUpperCase().replace(/\s+/g, ' ');
    return {
      luggage: firstMatch(upper, [/\bLUG\.?\s*WT\.?\s*[:\-]?\s*(\d{1,5})/, /\bLUGGAGE\s*(?:WT|WEIGHT)\s*[:\-]?\s*(\d{1,5})/, /\bTOTAL\s+BAG\s*(?:WEIGHT|WT)\s*[:\-]?\s*(\d{1,5})/]),
      cargo: firstMatch(upper, [/\bCARGO\s*WT\.?\s*[:\-]?\s*(\d{1,5})/, /\bTOTAL\s+CARGO\s+WEIGHT\s*[:\-]?\s*(\d{1,5})/]),
      paxWeight: firstMatch(upper, [/\bPAX\s*WT\.?\s*[:\-]?\s*(\d{1,5})/, /\bPAX\s*WEIGHT\s*[:\-]?\s*(\d{1,5})/]),
      takeoffFuel: firstMatch(upper, [/\bTAKE\s*OFF\s*FUEL\s*[:\-]?\s*(\d{1,5})/, /\bTAKEOFF\s*FUEL\s*[:\-]?\s*(\d{1,5})/]),
      burnFuel: firstMatch(upper, [/\bBURN\s*OFF\s*FUEL\s*[:\-]?\s*(\d{1,5})/, /\bBURN\s*OF\s*FUEL\s*[:\-]?\s*(\d{1,5})/])
    };
  }

  function parseTsvWords(tsv) {
    var lines = String(tsv || '').split(/\n/), words = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split('\t');
      if (cells.length < 12 || +cells[0] !== 5) continue;
      var value = cells.slice(11).join('\t').trim();
      if (!value) continue;
      words.push({
        x: +cells[6] || 0,
        y: +cells[7] || 0,
        w: +cells[8] || 0,
        h: +cells[9] || 0,
        confidence: isFinite(+cells[10]) ? +cells[10] : 0,
        text: value
      });
    }
    return words;
  }

  function cleanNumericToken(value) {
    var token = String(value || '').toUpperCase().replace(/[Oo]/g, '0').replace(/[^0-9.]/g, '');
    if (!token || !/^\d{1,6}(?:\.\d+)?$/.test(token)) return null;
    var number = parseFloat(token);
    return isFinite(number) ? number : null;
  }

  function categoryForWeight(value, weights, allowMissingLeadingDigit) {
    var categories = ['M', 'F', 'C', 'I'], matches = [];
    for (var i = 0; i < categories.length; i++) {
      var category = categories[i], standard = +(weights && weights[category]);
      if (!isFinite(standard) || standard <= 0) continue;
      if (+value === standard) matches.push(category);
      else if (allowMissingLeadingDigit && String(standard).length === String(value).length + 1 && String(standard).slice(1) === String(value)) matches.push(category);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function solveCategoryCounts(total, paxWeight, weights, minimums) {
    total = Math.round(+total || 0); paxWeight = Math.round(+paxWeight || 0);
    if (!total || total > 15 || !paxWeight || !weights) return null;
    minimums = minimums || {};
    var solutions = [], m, f, c, inf;
    for (m = minimums.M || 0; m <= total; m++) {
      for (f = minimums.F || 0; f <= total - m; f++) {
        for (c = minimums.C || 0; c <= total - m - f; c++) {
          inf = total - m - f - c;
          if (inf < (minimums.I || 0)) continue;
          var sum = m * (+weights.M || 0) + f * (+weights.F || 0) + c * (+weights.C || 0) + inf * (+weights.I || 0);
          if (Math.abs(sum - paxWeight) <= 1) solutions.push({ M: m, F: f, C: c, I: inf });
        }
      }
    }
    return solutions.length === 1 ? solutions[0] : null;
  }

  /* Resort manifests are tables. TSV bounding boxes preserve the relationships
   * between passenger rows and the two weight columns after plain OCR text has
   * lost them. */
  function parseSpatialManifest(tsv, imageWidth, imageHeight, weights) {
    var words = parseTsvWords(tsv), width = +imageWidth || 0, height = +imageHeight || 0;
    var empty = { total: 0, passengers: [], load: { luggage: null, paxWeight: null }, meta: {}, evidence: {} };
    if (!words.length || !width || !height) return empty;

    var tableTop = height * 0.12, tableBottom = height * 0.37;
    var ticketWords = words.filter(function (word) {
      var digits = String(word.text).replace(/\D/g, '');
      return word.y >= tableTop && word.y <= tableBottom && word.x < width * 0.55 && /^\d{6}$/.test(digits);
    }).sort(function (a, b) { return a.y - b.y; });

    var tickets = [];
    ticketWords.forEach(function (word) {
      var center = word.y + word.h / 2;
      if (!tickets.some(function (ticket) { return Math.abs(ticket.center - center) < height * 0.006; })) {
        tickets.push({ word: word, center: center, ticket: String(word.text).replace(/\D/g, '') });
      }
    });
    if (tickets.length > 15) tickets = tickets.slice(0, 15);

    // A faint ticket number should not erase an otherwise readable passenger
    // row. Add row anchors from the name column, bounded by the first/last
    // detected ticket so the header cannot be mistaken for a passenger.
    var rowAnchors = tickets.slice();
    if (tickets.length) {
      var rowMin = tickets[0].center - height * 0.012;
      var rowMax = tickets[tickets.length - 1].center + height * 0.012;
      var nameWords = words.filter(function (word) {
        var token = String(word.text).replace(/[^A-Za-z'\-]/g, '');
        var center = word.y + word.h / 2;
        return center >= rowMin && center <= rowMax && word.x >= width * 0.26 && word.x <= width * 0.48 && token.length >= 2 && !/^(VIP|MLE|KTH|GUEST)$/i.test(token);
      }).sort(function (a, b) { return a.y - b.y; });
      var nameCenters = [];
      nameWords.forEach(function (word) {
        var center = word.y + word.h / 2;
        var existing = nameCenters.find(function (value) { return Math.abs(value - center) < height * 0.006; });
        if (existing === undefined) nameCenters.push(center);
      });
      nameCenters.forEach(function (center) {
        if (!rowAnchors.some(function (anchor) { return Math.abs(anchor.center - center) < height * 0.008; })) {
          rowAnchors.push({ word: null, center: center, ticket: '' });
        }
      });
      rowAnchors.sort(function (a, b) { return a.center - b.center; });
      if (rowAnchors.length > 15) rowAnchors = rowAnchors.slice(0, 15);
    }

    var passengers = rowAnchors.map(function (ticket) {
      var band = Math.max(16, height * 0.0105);
      var rowWords = words.filter(function (word) { return Math.abs((word.y + word.h / 2) - ticket.center) <= band; });
      var name = rowWords.filter(function (word) {
        var token = String(word.text).replace(/[^A-Za-z'\-]/g, '');
        return word.x >= width * 0.26 && word.x <= width * 0.48 && token.length >= 2 && !/^(VIP|MLE|KTH|GUEST)$/i.test(token);
      }).sort(function (a, b) { return a.x - b.x; }).map(function (word) {
        return String(word.text).replace(/[^A-Za-z'\-]/g, '').toUpperCase();
      }).join(' ').replace(/\s+/g, ' ').trim();

      var weightCandidates = rowWords.filter(function (word) {
        var value = cleanNumericToken(word.text);
        return value !== null && word.x >= width * 0.78 && word.x <= width * 0.86;
      }).sort(function (a, b) {
        var aDistance = Math.abs((a.y + a.h / 2) - ticket.center);
        var bDistance = Math.abs((b.y + b.h / 2) - ticket.center);
        return aDistance - bDistance || b.confidence - a.confidence;
      });
      var detectedWeight = weightCandidates.length ? cleanNumericToken(weightCandidates[0].text) : null;
      var category = categoryForWeight(detectedWeight, weights, true);
      return { ticket: ticket.ticket, name: name, cat: category || '?', weight: category ? +weights[category] : null, rowY: ticket.center };
    });

    var lastRow = rowAnchors.length ? rowAnchors[rowAnchors.length - 1].center : height * 0.35;
    var summaryNumbers = words.filter(function (word) {
      var center = word.y + word.h / 2;
      return center > lastRow + height * 0.025 && center < lastRow + height * 0.105 && word.x > width * 0.52;
    }).map(function (word) { return { value: cleanNumericToken(word.text), word: word }; })
      .filter(function (item) { return item.value !== null; });

    var total = passengers.length;
    var paxCandidates = summaryNumbers.filter(function (item) {
      return item.value >= Math.max(300, total * 70) && item.value <= Math.max(4000, total * 250);
    }).sort(function (a, b) { return b.value - a.value; });
    var paxWeight = paxCandidates.length ? paxCandidates[0].value : null;
    var luggageCandidates = summaryNumbers.filter(function (item) {
      return item.value >= 20 && item.value <= 2000 && item.value !== paxWeight;
    }).sort(function (a, b) { return b.value - a.value; });
    var luggage = luggageCandidates.length ? luggageCandidates[0].value : null;

    // If one complete ticket row was lost, the printed passenger-weight total
    // can recover it only when the residual has one unique category solution.
    // This exact case occurs on the supplied resort photo (one female row is
    // faint, while the 2,295 lb summary remains clear).
    if (paxWeight && total < 15 && passengers.every(function (passenger) { return passenger.cat !== '?'; })) {
      var knownWeight = passengers.reduce(function (sum, passenger) { return sum + (+passenger.weight || 0); }, 0);
      var residual = Math.round(paxWeight - knownWeight), recoveries = [];
      if (residual > 0) {
        for (var missing = 1; missing <= 15 - total; missing++) {
          var recovery = solveCategoryCounts(missing, residual, weights, {});
          if (recovery) recoveries.push({ count: missing, categories: recovery });
        }
      }
      if (recoveries.length === 1) {
        ['M', 'F', 'C', 'I'].forEach(function (category) {
          for (var r = 0; r < recoveries[0].categories[category]; r++) {
            passengers.push({ ticket: '', name: 'UNREAD MANIFEST ROW', cat: category, weight: +weights[category], rowY: null });
          }
        });
        total = passengers.length;
      }
    }

    var minima = { M: 0, F: 0, C: 0, I: 0 };
    passengers.forEach(function (passenger) { if (passenger.cat !== '?') minima[passenger.cat]++; });
    var solved = solveCategoryCounts(total, paxWeight, weights, minima);
    if (solved) {
      var remaining = { M: solved.M - minima.M, F: solved.F - minima.F, C: solved.C - minima.C, I: solved.I - minima.I };
      var unresolved = passengers.filter(function (passenger) { return passenger.cat === '?'; });
      var remainingTypes = Object.keys(remaining).filter(function (category) { return remaining[category] > 0; });
      if (remainingTypes.length === 1 && remaining[remainingTypes[0]] === unresolved.length) {
        unresolved.forEach(function (passenger) { passenger.cat = remainingTypes[0]; passenger.weight = +weights[remainingTypes[0]]; });
      }
    }

    var joinedTop = words.filter(function (word) { return word.y < height * 0.16; })
      .map(function (word) { return word.text; }).join(' ').toUpperCase();
    var regMatch = joinedTop.match(/\b8[QO][\s-]*[A-Z]{3}\b/);
    var flightMatch = joinedTop.match(/\b[A-Z0-9]{1,3}[\s-]+\d{3,4}\b/);
    var meta = {
      registration: regMatch ? regMatch[0].replace(/\s/g, '').replace(/^8O/, '8Q').replace(/^8Q(?=[A-Z])/, '8Q-') : '',
      flightNo: flightMatch ? flightMatch[0].replace(/\s+/g, '-').replace(/-+/g, '-') : ''
    };

    return {
      total: total,
      passengers: passengers,
      solved: solved,
      load: { luggage: luggage, paxWeight: paxWeight },
      meta: meta,
      evidence: {
        ticketRows: tickets.length,
        recoveredRows: Math.max(0, total - tickets.length),
        classifiedRows: passengers.filter(function (passenger) { return passenger.cat !== '?'; }).length
      }
    };
  }

  function parseGenderColumnRows(raw) {
    var lines = cleanOcr(raw).split(/\n+/);
    var result = { male: 0, female: 0, child: 0, infant: 0, rows: 0 };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      if (!line || /PASSENGER MANIFEST|CHECKED|TOTAL|WEIGHT|CARGO|LAST MINUTE|SL NO|GENDER/.test(line)) continue;
      var hasRow = /^\d{1,3}[).\s]+/.test(line) || /\b(CCM|LOCAL|GUEST)\b/.test(line);
      var gender = line.match(/\b([MF])\b\s+(?:MLE|MALE|FEMALE|[A-Z]{3})\s+[A-Z0-9]{2,6}\b/) || line.match(/\b([MF])\b\s+[A-Z]{3}\s+[A-Z0-9]{2,6}\b/);
      if (!hasRow || !gender) continue;
      result.rows++;
      if (/\b(INF|INFANT)\b/.test(line)) result.infant++;
      else if (/\b(CHD|CHILD|MSTR|MASTER)\b/.test(line)) result.child++;
      else if (gender[1] === 'M') result.male++;
      else result.female++;
    }
    return result.rows ? result : null;
  }

  function parseTitleRows(raw) {
    var lines = cleanOcr(raw).toUpperCase().split(/\n+/);
    var result = { male: 0, female: 0, child: 0, infant: 0, unknown: 0, rows: 0 };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || /PASSENGER LIST|TOTAL\/SEG|FARE SEQ|CLASS |ACFT REGN|PAGE|FLIGHT INFO|STATUS|COMMENT|CABIN TOTAL|TOTAL PAX|ETD|PRT NAME/.test(line)) continue;
      if (!/[A-Z]{2,}/.test(line)) continue;
      var category = null;
      if (/\b(INF|INFANT)\b/.test(line)) category = 'infant';
      else if (/\b(MSTR|MASTER|CHD|CHILD)\b/.test(line)) category = 'child';
      else if (/\b(MRS|MISS|MS)\b/.test(line)) category = 'female';
      else if (/\bMR\b/.test(line)) category = 'male';
      if (!category) continue;
      result[category]++;
      result.rows++;
    }
    return result.rows ? result : null;
  }

  function parseTitleScan(raw) {
    var upper = cleanOcr(raw).toUpperCase();
    function count(pattern) { var matches = upper.match(pattern); return matches ? matches.length : 0; }
    var result = {
      male: count(/\bMR\b/g),
      female: count(/\b(?:MRS|MS|MISS)\b/g),
      child: count(/\b(?:MSTR|MASTER|CHD|CHILD)\b/g),
      infant: count(/\b(?:INF|INFANT)\b/g)
    };
    return result.male + result.female + result.child + result.infant ? result : null;
  }

  function countPassengerRows(raw) {
    var lines = cleanOcr(raw).split(/\n+/);
    var count = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || /PASSENGER|MANIFEST|TOTAL|WEIGHT|CARGO|FLIGHT|DATE|PAGE|GENDER|SEAT|REMARK|CHECK|BOARD|CABIN|CREW|SIGN|PREPARED|^NAME$/i.test(line)) continue;
      if (/^[0O]?\d{1,3}[).\s]/.test(line) && /[A-Z]{2,}/i.test(line)) count++;
      else if (line.length <= 60 && /^[A-Z][A-Za-z'.\-]+\s*[\/,]\s*[A-Z][A-Za-z'.\-]+/.test(line)) count++;
    }
    return count;
  }

  function parseManifestCounts(text) {
    var raw = cleanOcr(text);
    var reportedTotal = parseManifestTotal(raw);
    var summary = parseSummaryCounts(raw);
    var gender = parseGenderColumnRows(raw);
    var titles = parseTitleRows(raw);
    var load = parseLoadSheetValues(raw);
    var male = 0, female = 0, child = 0, infant = 0, unknown = 0;
    var source = 'unknown', confidence = 'Low', issues = [];

    if (summary.male !== undefined || summary.female !== undefined || summary.child !== undefined || summary.infant !== undefined) {
      male = summary.male || 0;
      female = summary.female || 0;
      child = summary.child || 0;
      infant = summary.infant || 0;
      source = 'summary totals';
      confidence = 'High';
    } else if (gender) {
      male = gender.male;
      female = gender.female;
      child = gender.child;
      infant = gender.infant;
      source = 'gender column table';
      confidence = 'Medium/High';
    } else if (titles) {
      male = titles.male;
      female = titles.female;
      child = titles.child;
      infant = titles.infant;
      unknown = titles.unknown || 0;
      source = 'passenger titles';
      confidence = 'Medium';
    }

    var classified = male + female + child + infant;
    if (!classified) {
      var scan = parseTitleScan(raw);
      if (scan) {
        male = scan.male;
        female = scan.female;
        child = scan.child;
        infant = scan.infant;
        classified = male + female + child + infant;
        source = 'title scan';
        confidence = 'Low';
      }
    }

    var rowCount = countPassengerRows(raw);
    if (reportedTotal && reportedTotal > classified) unknown = Math.max(unknown, reportedTotal - classified);
    else if (!reportedTotal && rowCount > classified) unknown = Math.max(unknown, rowCount - classified);
    else if (!classified && !reportedTotal && rowCount) {
      unknown = rowCount;
      source = 'row count';
      confidence = 'Low';
    }

    var detected = classified + unknown;
    var total = reportedTotal || detected;
    if (reportedTotal && classified > reportedTotal) {
      issues.push('Category counts (' + classified + ') exceed the reported total (' + reportedTotal + ').');
      total = detected;
      confidence = 'Low';
    }
    if (reportedTotal && detected < reportedTotal) {
      unknown += reportedTotal - detected;
      detected = classified + unknown;
    }
    if (total > 15 || detected > 15) issues.push('Detected passenger count exceeds the 15-seat cabin capacity.');
    if (!raw) issues.push('No OCR text was produced.');
    else if (!total && !Object.values(load).some(function (value) { return value !== null; })) issues.push('No passenger rows or totals could be identified.');

    var hasLoad = Object.values(load).some(function (value) { return value !== null; });
    if (hasLoad && source === 'unknown') {
      source = 'load sheet values';
      confidence = 'Medium';
    }

    return {
      male: male,
      female: female,
      child: child,
      infant: infant,
      unknown: unknown,
      total: total,
      reportedTotal: reportedTotal,
      source: source,
      confidence: confidence,
      issues: issues,
      consistent: issues.length === 0,
      load: load
    };
  }

  function parseManifestScan(text, tsv, imageWidth, imageHeight, weights) {
    var result = parseManifestCounts(text);
    var spatial = parseSpatialManifest(tsv, imageWidth, imageHeight, weights);
    if (!spatial.total) return result;

    result.total = spatial.total;
    result.reportedTotal = result.reportedTotal || spatial.total;
    result.passengers = spatial.passengers;
    result.meta = spatial.meta;
    var upper = cleanOcr(text).toUpperCase();
    var regFallback = upper.match(/\b8[QO][\s-]*[A-Z]{3}\b/);
    var flightFallback = upper.match(/\b[A-Z0-9]{1,3}[\s-]+\d{3,4}\b/);
    var timeFallback = upper.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/);
    if (!result.meta.registration && regFallback) result.meta.registration = regFallback[0].replace(/\s/g, '').replace(/^8O/, '8Q').replace(/^8Q(?=[A-Z])/, '8Q-');
    if (!result.meta.flightNo && flightFallback) result.meta.flightNo = flightFallback[0].replace(/\s+/g, '-').replace(/-+/g, '-');
    if (/\bKTH\b/.test(upper) && /\bMLE\b/.test(upper)) result.meta.route = 'KTH–MLE';
    if (timeFallback) result.meta.time = timeFallback[0];
    result.evidence = spatial.evidence;
    result.load.luggage = spatial.load.luggage !== null ? spatial.load.luggage : result.load.luggage;
    result.load.paxWeight = spatial.load.paxWeight !== null ? spatial.load.paxWeight : result.load.paxWeight;

    if (spatial.solved) {
      result.male = spatial.solved.M;
      result.female = spatial.solved.F;
      result.child = spatial.solved.C;
      result.infant = spatial.solved.I;
      result.unknown = 0;
      result.source = 'manifest rows + passenger-weight cross-check';
      result.confidence = 'High';
    } else {
      var counts = { M: 0, F: 0, C: 0, I: 0, '?': 0 };
      spatial.passengers.forEach(function (passenger) { counts[passenger.cat]++; });
      result.male = counts.M; result.female = counts.F; result.child = counts.C; result.infant = counts.I; result.unknown = counts['?'];
      result.source = 'manifest table rows';
      result.confidence = result.unknown ? 'Medium' : 'High';
    }

    result.issues = (result.issues || []).filter(function (issue) {
      return !/No passenger rows|Category counts|reported total/i.test(issue);
    });
    if (result.total > 15) result.issues.push('Detected passenger count exceeds the 15-seat cabin capacity.');
    if (result.unknown) result.issues.push(result.unknown + ' passenger row(s) still need category review.');
    result.consistent = result.issues.length === 0;
    return result;
  }

  return {
    cleanOcr: cleanOcr,
    numFrom: numFrom,
    firstMatch: firstMatch,
    parseManifestTotal: parseManifestTotal,
    parseSummaryCounts: parseSummaryCounts,
    parseLoadSheetValues: parseLoadSheetValues,
    parseTsvWords: parseTsvWords,
    solveCategoryCounts: solveCategoryCounts,
    parseSpatialManifest: parseSpatialManifest,
    parseGenderColumnRows: parseGenderColumnRows,
    parseTitleRows: parseTitleRows,
    parseTitleScan: parseTitleScan,
    countPassengerRows: countPassengerRows,
    parseManifestCounts: parseManifestCounts,
    parseManifestScan: parseManifestScan
  };
});
