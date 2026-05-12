function scanEl(id){return document.getElementById(id)}
function getScanInt(id){let v=parseInt(scanEl(id).value,10);return Number.isFinite(v)&&v>0?v:0}
function setScanStatus(msg){let s=scanEl('scanStatus');if(s)s.textContent=msg}
function normalizeOcr(text){return (text||'').replace(/\r/g,'\n').replace(/[~–—]/g,'-').replace(/[|]/g,'I').replace(/[ \t]+/g,' ').trim()}
function sanePax(v){v=parseInt(String(v).replace(/[^0-9]/g,''),10);return Number.isFinite(v)&&v>=0&&v<=999?v:null}
function ensureScanCompletenessUI(){
  if(scanEl('manifestTotal'))return;
  let anchor=scanEl('scanStatus'); if(!anchor||!anchor.parentNode)return;
  let box=document.createElement('div'); box.className='grid four'; box.style.marginTop='12px'; box.innerHTML='\
    <div><label>Manifest Total</label><input id="manifestTotal" type="number" value="0"></div>\
    <div><label>Classified Pax</label><input id="classifiedPax" type="number" value="0" readonly></div>\
    <div><label>Unknown / Unclear</label><input id="unknownPax" type="number" value="0"></div>\
    <div><label>Missing / Unreadable</label><input id="missingPax" type="number" value="0" readonly></div>';
  anchor.parentNode.insertBefore(box,anchor);
}
function setScanCompleteness(total,classified,unknown){
  ensureScanCompletenessUI();
  total=sanePax(total)||0; classified=sanePax(classified)||0; unknown=sanePax(unknown)||0;
  let missing=Math.max(0,total-classified-unknown);
  if(scanEl('manifestTotal'))scanEl('manifestTotal').value=total;
  if(scanEl('classifiedPax'))scanEl('classifiedPax').value=classified;
  if(scanEl('unknownPax'))scanEl('unknownPax').value=unknown;
  if(scanEl('missingPax'))scanEl('missingPax').value=missing;
  return {total,classified,unknown,missing};
}
function parseManifestTotal(raw){
  let text=normalizeOcr(raw).toUpperCase();
  let patterns=[
    /CABIN\s+TOTAL\s+PAX\s*[:\-]?\s*0*(\d{1,3})/i,
    /TOTAL\s+PAX\s*[:\-]?\s*0*(\d{1,3})/i,
    /TTL\s+0*([0-9]{1,3})\s+PAX/i,
    /PAX\s*[:\-]?\s*0*(\d{1,3})/i
  ];
  for(let re of patterns){let m=text.match(re); if(m){let v=sanePax(m[1]); if(v!==null&&v>0)return v;}}
  return 0;
}
function parseCheckedInValue(raw,label){
  let lines=normalizeOcr(raw).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let labelRe=new RegExp('^\\s*'+label+'\\b','i'), checkedRe=/(CHECKED[ -]?IN\/?BOARDED|CHECKED[ -]?IN|BOARDED)/i;
  for(let line of lines){if(!labelRe.test(line)||!checkedRe.test(line))continue;let nums=line.match(/\d{1,3}/g)||[];if(nums.length){let v=sanePax(nums[nums.length-1]);if(v!==null)return v}}
  let flat=normalizeOcr(raw).toUpperCase();let re=new RegExp('(?:^|[^A-Z])'+label+'\\b[^\n]{0,80}?(?:CHECKED[ -]?IN\\/?BOARDED|CHECKED[ -]?IN|BOARDED)\\s*[-:=]?\\s*(\\d{1,3})','i');let m=flat.match(re);if(m){let v=sanePax(m[1]);if(v!==null)return v}return null;
}
function parseManifestedValue(raw,label){
  let lines=normalizeOcr(raw).split(/\n+/).map(x=>x.trim()).filter(Boolean);let labelRe=new RegExp('^\\s*'+label+'\\b','i');
  for(let line of lines){if(!labelRe.test(line)||!/MANIFESTED/i.test(line))continue;let nums=line.match(/\d{1,3}/g)||[];if(nums.length){let v=sanePax(nums[0]);if(v!==null)return v}}
  return null;
}
function parseZoneTotals(raw){
  let lines=normalizeOcr(raw).toUpperCase().split(/\n+/).map(x=>x.trim()).filter(Boolean);
  for(let line of lines){if(!/^TOTALS\s*[:]?/.test(line))continue;let nums=(line.match(/\d{1,4}/g)||[]).map(x=>parseInt(x,10));if(nums.length>=3){let male=nums[0],female=nums[1],child=nums[2],total=nums[3]||male+female+child;if(male<=300&&female<=300&&child<=100&&Math.abs((male+female+child)-total)<=5)return{male,female,child,source:'zone totals'}}}
  return null;
}
function parsePassengerListTitles(raw){
  let text=normalizeOcr(raw).toUpperCase();let male=0,female=0,child=0,unknown=0;
  let hasPassengerList=/PASSENGER\s+LIST|FARE\s+SEQ\s+SEAT|TOTAL\/SEG\/CL|CLASS\s+[A-Z]|MLE\s+MANIFEST/i.test(text);
  let lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);let passengerId='(?:\\d{3,4}|[0O]\\d{1,3}|OSS|OS8|O1|OT|V7|I68)';
  lines.forEach(line=>{
    if(/PASSENGER LIST|TOTAL\/SEG|FARE SEQ|CLASS |ACFT REGN|MALD(I|1)VIAN|PAGE|FLIGHT INFO|STATUS|COMMENT|CABIN TOTAL/.test(line))return;
    let chunks=[];let re=new RegExp('([A-Z\\[\\] \\/_+]+?)\\s*'+passengerId+'(?:\\s|$)','gi');let m;
    while((m=re.exec(line))!==null){let chunk=(m[1]||'').trim();if(chunk.includes('/'))chunks.push(chunk)}
    if(!chunks.length&&line.includes('/'))chunks=[line];
    chunks.forEach(chunk=>{
      let normalized=chunk.replace(/_/g,' ').replace(/\+/g,' ').replace(/\bM R\b/g,' MR').replace(/\bM RS\b/g,' MRS').replace(/\bM S\b/g,' MS').replace(/\bM STR\b/g,' MSTR').replace(/[^A-Z\/ ]/g,' ').replace(/\s+/g,' ').trim();
      let last=(normalized.split('/').pop()||normalized).replace(/\s+/g,'').trim();
      if(/(MSTR|MASTER|CHD|CHILD)$/.test(last)||/\b(MSTR|MASTER|CHD|CHILD)\b/.test(normalized)){child++;return}
      if(/(MRS|MISS|MS)$/.test(last)||/\b(MRS|MISS|MS)\b/.test(normalized)){female++;return}
      if(/(MR)$/.test(last)||/\bMR\b/.test(normalized)){male++;return}
      if(/\+$/.test(chunk)||chunk.includes('+'))unknown++;
    })
  });
  let total=male+female+child;if(total>0&&(hasPassengerList||total>=5))return{male,female,child,unknown,source:'passenger list titles'};return null;
}
function parseSimpleCounts(raw){
  let text=normalizeOcr(raw);function explicit(label){let lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);let re=new RegExp('^\\s*'+label+'\\b\\s*[:=\\-]?\\s*(\\d{1,3})','i');for(let line of lines){let m=line.match(re);if(m){let v=sanePax(m[1]);if(v!==null)return v}}return 0}
  let male=explicit('MALE'),female=explicit('FEMALE'),child=explicit('CHILD|CHD|CHILDREN');if(male||female||child)return{male,female,child,unknown:0,source:'simple totals'};return{male:0,female:0,child:0,unknown:0,source:'no counts found'};
}
function parseManifestCounts(text){
  let raw=(text||'').replace(/\r/g,'\n'), total=parseManifestTotal(raw);
  let child=parseCheckedInValue(raw,'CHILD'), female=parseCheckedInValue(raw,'FEMALE'), male=parseCheckedInValue(raw,'MALE');
  if(male!==null||female!==null||child!==null)return{male:male||0,female:female||0,child:child||0,unknown:0,total,source:'checked-in/boarded totals'};
  let zone=parseZoneTotals(raw);if(zone)return Object.assign({unknown:0,total},zone);
  child=parseManifestedValue(raw,'CHILD');female=parseManifestedValue(raw,'FEMALE');male=parseManifestedValue(raw,'MALE');
  if(male!==null||female!==null||child!==null)return{male:male||0,female:female||0,child:child||0,unknown:0,total,source:'manifested totals'};
  let titleCounts=parsePassengerListTitles(raw);if(titleCounts)return Object.assign({total},titleCounts);
  return Object.assign({total},parseSimpleCounts(raw));
}
async function runManifestOCR(){
  let input=scanEl('manifestFile');if(!input||!input.files||!input.files[0]){setScanStatus('Choose or take a manifest photo first.');return}if(!window.Tesseract){setScanStatus('OCR engine not loaded. Internet may be needed the first time.');return}
  setScanStatus('Reading manifest photo… keep this page open.');
  try{let result=await Tesseract.recognize(input.files[0],'eng',{logger:m=>{if(m.status)setScanStatus('OCR: '+m.status+(m.progress?' '+Math.round(m.progress*100)+'%':''))}});let text=result&&result.data&&result.data.text?result.data.text:'';scanEl('ocrText').value=text.trim();let c=parseManifestCounts(text);scanEl('scanMale').value=c.male;scanEl('scanFemale').value=c.female;scanEl('scanChild').value=c.child;let classified=(c.male||0)+(c.female||0)+(c.child||0);let stats=setScanCompleteness(c.total||0,classified,c.unknown||0);let warning=stats.total&&stats.missing?' Missing/unreadable pax: '+stats.missing+'.':'';let extra=stats.unknown?' Unknown/unclear pax: '+stats.unknown+'.':'';setScanStatus('Detected '+c.male+' male, '+c.female+' female, '+c.child+' child from '+(c.source||'OCR')+'. Manifest total: '+(stats.total||'not found')+'. Classified: '+stats.classified+'.'+extra+warning+' Review/correct before applying.')}catch(e){setScanStatus('OCR failed. Try a clearer photo or enter counts manually.')}
}
function applyScannedPassengers(){
  let m=getScanInt('scanMale'),f=getScanInt('scanFemale'),c=getScanInt('scanChild'),classified=m+f+c,total=sanePax(scanEl('manifestTotal')?.value)||0,unknown=sanePax(scanEl('unknownPax')?.value)||0,missing=Math.max(0,total-classified-unknown);
  setScanCompleteness(total,classified,unknown);
  if(total&&(unknown||missing)){setScanStatus('Warning: manifest total '+total+', classified '+classified+', unknown '+unknown+', missing '+missing+'. Correct counts before applying if needed.')}
  let list=[];for(let i=0;i<m;i++)list.push('M');for(let i=0;i<f;i++)list.push('F');for(let i=0;i<c;i++)list.push('C');if(!window.applyPassengerList){setScanStatus('Seat fill function not ready. Refresh page.');return}let r=window.applyPassengerList(list);let msg='Applied '+r.applied+' passengers to seats. Review seat positions before using.';if(r.overflow)msg+=' '+r.overflow+' passenger(s) did not fit in 15 seats.';if(total&&(unknown||missing))msg+=' Scan incomplete: unknown '+unknown+', missing '+missing+'.';setScanStatus(msg)
}
function clearScan(){['scanMale','scanFemale','scanChild','manifestTotal','classifiedPax','unknownPax','missingPax'].forEach(id=>{let x=scanEl(id);if(x)x.value=0});if(scanEl('ocrText'))scanEl('ocrText').value='';if(scanEl('manifestFile'))scanEl('manifestFile').value='';setScanStatus('Scanner cleared.')}
window.addEventListener('DOMContentLoaded',function(){ensureScanCompletenessUI();let b=scanEl('scanBtn');if(b)b.onclick=runManifestOCR;let a=scanEl('applyScanBtn');if(a)a.onclick=applyScannedPassengers;let c=scanEl('clearScanBtn');if(c)c.onclick=clearScan;['scanMale','scanFemale','scanChild','manifestTotal','unknownPax'].forEach(id=>{let x=scanEl(id);if(x)x.addEventListener('input',()=>{let cl=getScanInt('scanMale')+getScanInt('scanFemale')+getScanInt('scanChild');setScanCompleteness(scanEl('manifestTotal')?.value||0,cl,scanEl('unknownPax')?.value||0)})})});