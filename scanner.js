function scanEl(id){return document.getElementById(id)}
function getScanInt(id){let v=parseInt(scanEl(id).value,10);return Number.isFinite(v)&&v>0?v:0}
function setScanStatus(msg){let s=scanEl('scanStatus');if(s)s.textContent=msg}
function parseManifestCounts(text){
  let raw=(text||'').replace(/\r/g,'\n');
  let upper=raw.toUpperCase();
  function explicit(labels){
    for(let label of labels){
      let re=new RegExp('(?:^|\\n|\\s)'+label+'\\s*[:=\\-]?\\s*(\\d{1,2})','i');
      let m=upper.match(re);if(m)return parseInt(m[1],10)||0;
    }
    return 0;
  }
  let male=explicit(['MALE','M']);
  let female=explicit(['FEMALE','F']);
  let child=explicit(['CHILD','CHD','CHILDREN','C']);
  if(male||female||child)return{male,female,child};
  male=0;female=0;child=0;
  raw.split(/\n+/).forEach(line=>{
    let l=line.toUpperCase().trim();
    if(!l||l.includes('GENDER')||l.includes('SEX'))return;
    if(/\b(CHD|CHILD|CHILDREN)\b/.test(l)){child++;return;}
    if(/\b(FEMALE|F)\b/.test(l)){female++;return;}
    if(/\b(MALE|M)\b/.test(l)){male++;return;}
  });
  return{male,female,child};
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
    setScanStatus('Detected counts loaded below. Review/correct before applying.');
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
function compactBaggageSection(){
  let style=document.createElement('style');
  style.textContent=`
    .bagCompact .four{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
    .bagCompact .four>div{border:1px solid rgba(180,230,255,.16);border-radius:16px;background:rgba(255,255,255,.045);padding:10px}
    .bagCompact label{font-size:11px;margin-bottom:5px;white-space:normal;line-height:1.15}
    .bagCompact input{padding:10px 10px;font-size:15px;border-radius:12px}
    .bagCompact .small{font-size:10px;margin-top:5px;color:#7fb9cc}
    @media(min-width:820px){.bagCompact .four{grid-template-columns:repeat(3,minmax(0,1fr))!important}.bagCompact .four>div{min-height:92px}}
    @media(max-width:380px){.bagCompact .four{gap:8px!important}.bagCompact .four>div{padding:9px}.bagCompact input{font-size:14px;padding:9px 8px}.bagCompact label{font-size:10px}}
  `;
  document.head.appendChild(style);
  document.querySelectorAll('.card h2').forEach(h=>{
    if((h.textContent||'').toLowerCase().includes('stretcher')){
      let card=h.closest('.card'); if(card) card.classList.add('bagCompact');
    }
  });
}
window.addEventListener('DOMContentLoaded',function(){
  let b=scanEl('scanBtn');if(b)b.onclick=runManifestOCR;
  let a=scanEl('applyScanBtn');if(a)a.onclick=applyScannedPassengers;
  let c=scanEl('clearScanBtn');if(c)c.onclick=clearScan;
  compactBaggageSection();
});