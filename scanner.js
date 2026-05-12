function scanEl(id){return document.getElementById(id)}
function getScanInt(id){let v=parseInt(scanEl(id).value,10);return Number.isFinite(v)&&v>0?v:0}
function setScanStatus(msg){let s=scanEl('scanStatus');if(s)s.textContent=msg}
function normalizeOcr(text){
  return (text||'')
    .replace(/\r/g,'\n')
    .replace(/[~–—]/g,'-')
    .replace(/[|]/g,'I')
    .replace(/[ \t]+/g,' ')
    .trim();
}
function sanePax(v){
  v=parseInt(String(v).replace(/[^0-9]/g,''),10);
  return Number.isFinite(v)&&v>=0&&v<=999?v:null;
}
function parseCheckedInValue(raw,label){
  let lines=normalizeOcr(raw).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let labelRe=new RegExp('^\\s*'+label+'\\b','i');
  let checkedRe=/(CHECKED[ -]?IN\/?BOARDED|CHECKED[ -]?IN|BOARDED)/i;
  for(let line of lines){
    if(!labelRe.test(line))continue;
    if(!checkedRe.test(line))continue;
    let nums=line.match(/\d{1,3}/g)||[];
    if(nums.length){let v=sanePax(nums[nums.length-1]);if(v!==null)return v;}
  }
  let flat=normalizeOcr(raw).toUpperCase();
  let re=new RegExp('(?:^|[^A-Z])'+label+'\\b[^\n]{0,80}?(?:CHECKED[ -]?IN\\/?BOARDED|CHECKED[ -]?IN|BOARDED)\\s*[-:=]?\\s*(\\d{1,3})','i');
  let m=flat.match(re);
  if(m){let v=sanePax(m[1]);if(v!==null)return v;}
  return null;
}
function parseManifestedValue(raw,label){
  let lines=normalizeOcr(raw).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let labelRe=new RegExp('^\\s*'+label+'\\b','i');
  for(let line of lines){
    if(!labelRe.test(line))continue;
    if(!/MANIFESTED/i.test(line))continue;
    let nums=line.match(/\d{1,3}/g)||[];
    if(nums.length){let v=sanePax(nums[0]);if(v!==null)return v;}
  }
  return null;
}
function parseZoneTotals(raw){
  let lines=normalizeOcr(raw).toUpperCase().split(/\n+/).map(x=>x.trim()).filter(Boolean);
  for(let line of lines){
    if(!/^TOTALS\s*[:]?/.test(line))continue;
    let nums=(line.match(/\d{1,4}/g)||[]).map(x=>parseInt(x,10));
    if(nums.length>=3){
      let male=nums[0],female=nums[1],child=nums[2];
      let total=nums[3]||male+female+child;
      if(male<=300&&female<=300&&child<=100&&Math.abs((male+female+child)-total)<=5){return{male,female,child,source:'zone totals'}}
    }
  }
  return null;
}
function parseSimpleCounts(raw){
  let text=normalizeOcr(raw);
  function explicit(label){
    let lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    let re=new RegExp('^\\s*'+label+'\\b\\s*[:=\\-]?\\s*(\\d{1,3})','i');
    for(let line of lines){let m=line.match(re);if(m){let v=sanePax(m[1]);if(v!==null)return v;}}
    return 0;
  }
  let male=explicit('MALE');
  let female=explicit('FEMALE');
  let child=explicit('CHILD|CHD|CHILDREN');
  if(male||female||child)return{male,female,child,source:'simple totals'};
  male=0;female=0;child=0;
  text.split(/\n+/).forEach(line=>{
    let l=line.toUpperCase().trim();
    if(!l||l.includes('GENDER')||l.includes('SEX'))return;
    if(/\b(CHD|CHILD|CHILDREN)\b/.test(l)){child++;return;}
    if(/\bFEMALE\b|\bF\b/.test(l)){female++;return;}
    if(/\bMALE\b|\bM\b/.test(l)){male++;return;}
  });
  return{male,female,child,source:'row count'};
}
function parseManifestCounts(text){
  let raw=(text||'').replace(/\r/g,'\n');
  let child=parseCheckedInValue(raw,'CHILD');
  let female=parseCheckedInValue(raw,'FEMALE');
  let male=parseCheckedInValue(raw,'MALE');
  if(male!==null||female!==null||child!==null){
    return{male:male||0,female:female||0,child:child||0,source:'checked-in/boarded totals'};
  }
  let zone=parseZoneTotals(raw);
  if(zone)return zone;
  child=parseManifestedValue(raw,'CHILD');
  female=parseManifestedValue(raw,'FEMALE');
  male=parseManifestedValue(raw,'MALE');
  if(male!==null||female!==null||child!==null){
    return{male:male||0,female:female||0,child:child||0,source:'manifested totals'};
  }
  return parseSimpleCounts(raw);
}
async function runManifestOCR(){
  let input=scanEl('manifestFile');
  if(!input||!input.files||!input.files[0]){setScanStatus('Choose or take a manifest photo first.');return;}
  if(!window.Tesseract){setScanStatus('OCR engine not loaded. Internet may be needed the first time.');return;}
  setScanStatus('Reading manifest photo… keep this page open.');
  try{
    let result=await Tesseract.recognize(input.files[0],'eng',{logger:m=>{if(m.status) setScanStatus('OCR: '+m.status+(m.progress?' '+Math.round(m.progress*100)+'%':''));}});
    let text=result&&result.data&&result.data.text?result.data.text:'';
    scanEl('ocrText').value=text.trim();
    let c=parseManifestCounts(text);
    scanEl('scanMale').value=c.male;scanEl('scanFemale').value=c.female;scanEl('scanChild').value=c.child;
    setScanStatus('Detected '+c.male+' male, '+c.female+' female, '+c.child+' child from '+(c.source||'OCR')+'. Review/correct before applying.');
  }catch(e){setScanStatus('OCR failed. Try a clearer photo or enter counts manually.');}
}
function applyScannedPassengers(){
  let m=getScanInt('scanMale'),f=getScanInt('scanFemale'),c=getScanInt('scanChild');
  let list=[];for(let i=0;i<m;i++)list.push('M');for(let i=0;i<f;i++)list.push('F');for(let i=0;i<c;i++)list.push('C');
  if(!window.applyPassengerList){setScanStatus('Seat fill function not ready. Refresh page.');return;}
  let r=window.applyPassengerList(list);
  let msg='Applied '+r.applied+' passengers to seats. Review seat positions before using.';
  if(r.overflow)msg+=' '+r.overflow+' passenger(s) did not fit in 15 seats.';
  setScanStatus(msg);
}
function clearScan(){
  ['scanMale','scanFemale','scanChild'].forEach(id=>scanEl(id).value=0);
  if(scanEl('ocrText'))scanEl('ocrText').value='';
  if(scanEl('manifestFile'))scanEl('manifestFile').value='';
  setScanStatus('Scanner cleared.');
}
window.addEventListener('DOMContentLoaded',function(){
  let b=scanEl('scanBtn');if(b)b.onclick=runManifestOCR;
  let a=scanEl('applyScanBtn');if(a)a.onclick=applyScannedPassengers;
  let c=scanEl('clearScanBtn');if(c)c.onclick=clearScan;
});