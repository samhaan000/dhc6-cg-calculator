/* ============================================================================
 * Manifest OCR text parsers (pure) — extracted from the original scanner.
 * No DOM access; usable in the browser (window.WBParsers) and Node (tests).
 * ========================================================================== */
;(function (root, factory) {
  var p = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = p;
  root.WBParsers = p;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function cleanOcr(t){return(t||'').replace(/\r/g,'\n').replace(/[|]/g,'I').replace(/[~–—]/g,'-').replace(/[ \t]+/g,' ').trim()}
function numFrom(s){let m=String(s||'').replace(/[, ]/g,'').match(/-?\d{1,5}(?:\.\d+)?/);return m?parseFloat(m[0]):null}
function firstMatch(text,patterns){for(let re of patterns){let m=text.match(re);if(m){let v=numFrom(m[1]||m[0]);if(v!==null)return v}}return null}
function parseManifestTotal(t){let u=cleanOcr(t).toUpperCase();return firstMatch(u,[/TOTAL\s+PAX\s*[:\-]?\s*(\d{1,3})/i,/TOTAL\s+PAX\s+(\d{1,3})/i,/CHECKED\s*IN\s*COUNT\s*(\d{1,3})/i,/CHECKED\s*IN\s*\/\s*BOARDED\s*(\d{1,3})/i,/CABIN\s+TOTAL\s+PAX\s*0*(\d{1,3})/i,/TTL\s*0*(\d{1,3})\s*PAX/i,/\bPAX\s*0*(\d{1,3})\b/i])||0}
function parseSummaryCounts(raw){let u=cleanOcr(raw).toUpperCase(),out={};let male=firstMatch(u,[/MALE[^\n\d]{0,25}(?:CHECKED|BOARDED|MANIFESTED)?[^\n\d]{0,20}(\d{1,3})/i]);let female=firstMatch(u,[/FEMALE[^\n\d]{0,25}(?:CHECKED|BOARDED|MANIFESTED)?[^\n\d]{0,20}(\d{1,3})/i]);let child=firstMatch(u,[/(?:CHILD|CHD|CHILDREN)[^\n\d]{0,25}(?:CHECKED|BOARDED|MANIFESTED)?[^\n\d]{0,20}(\d{1,3})/i]);if(male!==null)out.male=male;if(female!==null)out.female=female;if(child!==null)out.child=child;return out}
function parseLoadSheetValues(raw){let u=cleanOcr(raw).toUpperCase().replace(/\s+/g,' ');return{luggage:firstMatch(u,[/LUG\.?\s*WT\.?\s*(\d{1,5})/i,/LUGGAGE\s*(?:WT|WEIGHT)\s*(\d{1,5})/i,/TOTAL\s+BAG\s*(?:WEIGHT|WT)\s*[-:]?\s*(\d{1,5})/i]),cargo:firstMatch(u,[/CARGO\s*WT\.?\s*(\d{1,5})/i,/TOTAL\s+CARGO\s+WEIGHT\s*(\d{1,5})/i]),paxWeight:firstMatch(u,[/PAX\s*WT\.?\s*(\d{1,5})/i,/PAX\s*WEIGHT\s*(\d{1,5})/i]),takeoffFuel:firstMatch(u,[/TAKE\s*OFF\s*FUEL\s*(\d{1,5})/i,/TAKEOFF\s*FUEL\s*(\d{1,5})/i]),burnFuel:firstMatch(u,[/BURN\s*OFF\s*FUEL\s*(\d{1,5})/i,/BURN\s*OF\s*FUEL\s*(\d{1,5})/i])}}
function parseGenderColumnRows(raw){let lines=cleanOcr(raw).split(/\n+/),male=0,female=0,child=0,rows=0;for(let line of lines){let s=line.toUpperCase().replace(/_/g,' ').replace(/\s+/g,' ').trim();if(!s||/PASSENGER MANIFEST|CHECKED|TOTAL|WEIGHT|CARGO|LAST MINUTE|SL NO|GENDER/.test(s))continue;let hasRow=/^\d{1,3}\s+/.test(s)||/\b(CCM|LOCAL|GUEST)\b/.test(s);let gm=s.match(/\b([MF])\b\s+(?:MLE|MLE\b|MALE|FEMALE|[A-Z]{3})\s+[A-Z0-9]{2,6}\b/)||s.match(/\b([MF])\b\s+[A-Z]{3}\s+[A-Z0-9]{2,6}\b/);if(hasRow&&gm){rows++;if(gm[1]==='M')male++;else female++;if(/\b(CHD|CHILD|INF|INFANT)\b/.test(s))child++}}
return rows?{male,female,child,rows}:null}
function parseTitleRows(raw){let text=cleanOcr(raw).toUpperCase(),male=0,female=0,child=0,unknown=0;let lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);lines.forEach(line=>{if(/PASSENGER LIST|TOTAL\/SEG|FARE SEQ|CLASS |ACFT REGN|MALAYSIA AIRLINES|PAGE|FLIGHT INFO|STATUS|COMMENT|CABIN TOTAL|TOTAL PAX|ETD|LD CS PRT NAME/.test(line))return;if(!line.includes('/'))return;let chunks=line.split(/\s{2,}|(?=\b[0O]?\d{2,3}[A-Z]?\s*\/)/).filter(x=>x.includes('/'));if(!chunks.length)chunks=[line];chunks.forEach(chunk=>{let s=chunk.replace(/_/g,' ').replace(/\+/g,' ').replace(/[^A-Z\/ ]/g,' ').replace(/\s+/g,' ').trim(),last=(s.split('/').pop()||'').replace(/\s+/g,'');if(/(MSTR|MASTER|CHD|CHILD)$/.test(last)||/\b(MSTR|MASTER|CHD|CHILD)\b/.test(s)){child++;return}if(/(MRS|MISS|MS)$/.test(last)||/\b(MRS|MISS|MS)\b/.test(s)){female++;return}if(/(MR)$/.test(last)||/\bMR\b/.test(s)){male++;return}unknown++})});return male+female+child?{male,female,child,unknown}:null}
function parseTitleScan(raw){let u=cleanOcr(raw).toUpperCase();function ct(re){let m=u.match(re);return m?m.length:0}let male=ct(/\bMR\b/g);let female=ct(/\bMRS\b/g)+ct(/\bMS\b/g)+ct(/\bMISS\b/g);let child=ct(/\bMSTR\b/g)+ct(/\bMASTER\b/g)+ct(/\bCHD\b/g)+ct(/\bCHILD\b/g)+ct(/\bINF\b/g)+ct(/\bINFANT\b/g);return (male+female+child)?{male:male,female:female,child:child}:null}
function countPassengerRows(raw){let lines=cleanOcr(raw).split(/\n+/),n=0;for(let i=0;i<lines.length;i++){let s=lines[i].trim();if(!s)continue;if(/PASSENGER|MANIFEST|TOTAL|WEIGHT|CARGO|FLIGHT|DATE|PAGE|GENDER|SEAT|REMARK|CHECK|BOARD|CABIN|CREW|SIGN|PREPARED|^NAME$/i.test(s))continue;if(/^[0O]?\d{1,3}[).\s]/.test(s)&&/[A-Z]{2,}/i.test(s))n++;else if(s.length<=40&&/^[A-Z][A-Za-z'.\-]+\s*[\/,]\s*[A-Z][A-Za-z'.\-]+/.test(s))n++}return n}
function parseManifestCounts(text){let raw=cleanOcr(text),total=parseManifestTotal(raw),summary=parseSummaryCounts(raw),gender=parseGenderColumnRows(raw),titles=parseTitleRows(raw),load=parseLoadSheetValues(raw);let source='unknown',male=0,female=0,child=0,unknown=0,confidence='Low';
if(summary.male!==undefined||summary.female!==undefined||summary.child!==undefined){male=summary.male||0;female=summary.female||0;child=summary.child||0;source='summary totals';confidence='High'}
else if(gender){male=gender.male;female=gender.female;child=gender.child||0;source='gender column table';confidence='Medium/High'}
else if(titles){male=titles.male;female=titles.female;child=titles.child;unknown=titles.unknown||0;source='passenger titles';confidence='Medium'}
if(male+female+child===0){let ts=parseTitleScan(raw);if(ts){male=ts.male;female=ts.female;child=ts.child;source='title scan';confidence='Low'}}
let classified=male+female+child;
if(total&&total>classified)unknown=Math.max(unknown,total-classified);
if(classified===0&&!total){let rc=countPassengerRows(raw);if(rc){unknown=rc;source='row count';confidence='Low'}}
if(!total)total=classified+unknown;
let hasLoad=Object.values(load).some(v=>v!==null);if(hasLoad&&source==='unknown'){source='load sheet values';confidence='Medium'}
return{male,female,child,unknown,total,source,confidence,load}}
  return { cleanOcr:cleanOcr, numFrom:numFrom, firstMatch:firstMatch, parseManifestTotal:parseManifestTotal, parseSummaryCounts:parseSummaryCounts, parseLoadSheetValues:parseLoadSheetValues, parseGenderColumnRows:parseGenderColumnRows, parseTitleRows:parseTitleRows, parseTitleScan:parseTitleScan, countPassengerRows:countPassengerRows, parseManifestCounts:parseManifestCounts };
});
