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

  return {
    cleanOcr: cleanOcr,
    numFrom: numFrom,
    firstMatch: firstMatch,
    parseManifestTotal: parseManifestTotal,
    parseSummaryCounts: parseSummaryCounts,
    parseLoadSheetValues: parseLoadSheetValues,
    parseGenderColumnRows: parseGenderColumnRows,
    parseTitleRows: parseTitleRows,
    parseTitleScan: parseTitleScan,
    countPassengerRows: countPassengerRows,
    parseManifestCounts: parseManifestCounts
  };
});
