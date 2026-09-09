const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let rows = [];

function americanToDecimal(o){o=Number(o);if(!Number.isFinite(o)||o===0)return null;return o>0?1+o/100:1+100/Math.abs(o)}
function americanToProb(o){const d=americanToDecimal(o);return d?1/d:null}
function probToAmerican(p){p=Number(p);if(p>1)p/=100;if(!(p>0&&p<1))return null;return p>=.5?-100*p/(1-p):100*(1-p)/p}
function fmtOdds(o){o=Number(o);if(!Number.isFinite(o))return '—';return o>0?`+${Math.round(o)}`:`${Math.round(o)}`}
function pct(p,d=1){return Number.isFinite(p)?`${(p*100).toFixed(d)}%`:'—'}
function money(n){return Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):'—'}
function dateShort(x){if(!x)return '';const d=new Date(x);return Number.isNaN(d)?'':d.toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$$('.tab').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  $$('.tabpanel').forEach(p=>p.classList.toggle('active',p.id===btn.dataset.tab));
}));

async function loadBoard(){
  const btn=$('#refresh');btn.disabled=true;btn.textContent='Loading…';
  try{
    const league=$('#league').value;
    const r=await fetch(`/api/board?league=${encodeURIComponent(league)}&limit=16`);
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Failed');
    rows=data.rows||[];
    $('#statusPill').textContent=data.demo?'Demo mode':'Live feed';
    $('#statusPill').classList.toggle('live',!data.demo);
    $('#demoNotice').classList.toggle('hidden',!data.demo);
    if(data.demo) $('#demoNotice').innerHTML='No <b>SPORTSGAMEODDS_API_KEY</b> found, so this is sample data. Add a key to <b>.env</b> and refresh to compare live books + exchanges.';
    render();
  }catch(e){
    $('#statusPill').textContent='Feed error';
    $('#boardRows').innerHTML=`<div class="notice">${escapeHtml(e.message)}</div>`;
  }finally{btn.disabled=false;btn.textContent='Refresh'}
}

function isMarket(row,filter){
  if(filter==='all')return true;
  const s=`${row.marketName} ${row.oddID}`.toLowerCase();
  if(filter==='moneyline')return /moneyline|\-ml\-|\bml\b/.test(s);
  if(filter==='spread')return /spread|\-sp\-|\bsp\b/.test(s);
  if(filter==='total')return /total|over|under|\-ou\-/.test(s);
  return !/moneyline|\-ml\-|spread|\-sp\-|total|\-ou\-/.test(s);
}

function filteredRows(){
  const filter=$('#marketFilter').value;
  const q=$('#search').value.trim().toLowerCase();
  return rows.filter(r=>isMarket(r,filter)).filter(r=>!q||`${r.eventName} ${r.marketName} ${r.side} ${r.oddID}`.toLowerCase().includes(q));
}

function venueStats(rs){
  const map=new Map();
  for(const r of rs){
    if(!r.best?.decimal)continue;
    for(const q of r.quotes){
      if(!q.decimal)continue;
      const s=map.get(q.key)||{key:q.key,label:q.label,kind:q.kind,n:0,wins:0,sumIndex:0};
      s.n++;s.sumIndex+=q.decimal/r.best.decimal*100;
      if(Math.abs(q.odds-r.best.odds)<.001)s.wins++;
      map.set(q.key,s);
    }
  }
  return [...map.values()].map(s=>({...s,index:s.sumIndex/s.n})).filter(s=>s.n>=1).sort((a,b)=>b.index-a.index||b.wins-a.wins);
}

function renderVenueCards(rs){
  const stats=venueStats(rs).slice(0,8);
  $('#venueCards').innerHTML=stats.length?stats.map((s,i)=>`<div class="venueCard ${i===0?'best':''}">
    <div class="venueName"><span>${escapeHtml(s.label)}</span><span class="badge">${escapeHtml(s.kind)}</span></div>
    <div class="venueScore">${s.index.toFixed(1)}</div>
    <div class="venueSub">price index · ${s.wins} best-price win${s.wins===1?'':'s'} · ${s.n} markets</div>
  </div>`).join(''):'<div class="muted">No matching markets.</div>';
}

function renderRows(rs){
  $('#rowCount').textContent=`${rs.length} market${rs.length===1?'':'s'}`;
  const show=rs.slice(0,120);
  $('#boardRows').innerHTML=show.length?show.map(r=>{
    const best=r.best;
    const evClass=r.ev==null?'na':r.ev>=0?'pos':'neg';
    const fairText=r.fairOdds!=null?`${fmtOdds(r.fairOdds)} · ${pct(r.fairProbability)}`:'No fair benchmark';
    const line=best?.line!=null?` · line ${best.line>0?'+':''}${best.line}`:(r.fairLine!=null?` · line ${r.fairLine>0?'+':''}${r.fairLine}`:'');
    return `<article class="marketRow">
      <div class="marketTop">
        <div><div class="eventName">${escapeHtml(r.eventName)}</div><div class="marketMeta">${dateShort(r.startTime)} · ${escapeHtml(r.marketName)} · ${escapeHtml(r.side||r.stat)}${line}</div></div>
        <div class="bestPrice"><strong>${fmtOdds(best.odds)}</strong><div class="venue">Best: ${escapeHtml(best.label)} · ${pct(best.implied)} break-even</div></div>
        <div class="fairBox">Fair benchmark<b>${fairText}</b></div>
        <div class="ev ${evClass}">${r.ev==null?'EV —':`${r.ev>=0?'+':''}${(r.ev*100).toFixed(1)}% EV`}</div>
      </div>
      <div class="quoteStrip">${r.quotes.map((q,i)=>`<span class="quote ${i===0?'best':''}">${escapeHtml(q.label)} <b>${fmtOdds(q.odds)}</b>${q.line!=null?` @ ${q.line>0?'+':''}${q.line}`:''}</span>`).join('')}</div>
    </article>`
  }).join(''):'<div class="muted">No markets match those filters.</div>';
}

function render(){const rs=filteredRows();renderVenueCards(rs);renderRows(rs)}
$('#marketFilter').addEventListener('change',render);$('#search').addEventListener('input',render);$('#league').addEventListener('change',loadBoard);$('#refresh').addEventListener('click',loadBoard);

const promoKey='priceboard.promos.v1';
function loadPromos(){try{return JSON.parse(localStorage.getItem(promoKey)||'[]')}catch{return[]}}
function savePromos(x){localStorage.setItem(promoKey,JSON.stringify(x))}
function promoEV(p){return Number(p.face||0)*(Number(p.conversion||0)/100)/Math.max(1,Number(p.rollover||1))}
function renderPromos(){
  const list=loadPromos().sort((a,b)=>promoEV(b)-promoEV(a));
  $('#promoList').innerHTML=list.length?list.map(p=>`<article class="promoCard"><div class="venueName"><h3>${escapeHtml(p.venue)}</h3><span class="badge">${escapeHtml(p.type)}</span></div><div class="promoValue">${money(promoEV(p))}</div><div class="promoDetails">rough cash value<br>Face ${money(Number(p.face))} · conversion ${Number(p.conversion)}% · ${Number(p.rollover)}x rollover${p.expires?`<br>Expires ${escapeHtml(p.expires)}`:''}${p.note?`<br>${escapeHtml(p.note)}`:''}</div><button class="danger" data-del="${p.id}">Remove</button></article>`).join(''):'<div class="muted">No promos saved yet. Add one above — they stay in this browser.</div>';
  $$('[data-del]').forEach(b=>b.onclick=()=>{savePromos(loadPromos().filter(p=>p.id!==b.dataset.del));renderPromos()});
}
$('#promoForm').addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const p=Object.fromEntries(fd.entries());p.id=crypto.randomUUID();const list=loadPromos();list.push(p);savePromos(list);renderPromos();e.currentTarget.reset();e.currentTarget.querySelector('[name=face]').value=50;e.currentTarget.querySelector('[name=conversion]').value=70;e.currentTarget.querySelector('[name=rollover]').value=1});

function updateLabs(){
  const o=Number($('#oddsInput').value),op=americanToProb(o),od=americanToDecimal(o);$('#oddsResult').innerHTML=`${pct(op,2)} implied · ${od?od.toFixed(3):'—'}x total payout`;
  const p=Number($('#probInput').value)/100,pa=probToAmerican(p);$('#probResult').innerHTML=`${fmtOdds(pa)} fair · ${(1/p).toFixed(2)}x total payout`;
  const a=americanToProb(Number($('#vigA').value)),b=americanToProb(Number($('#vigB').value));if(a&&b){const sum=a+b,fa=a/sum,fb=b/sum;$('#vigResult').innerHTML=`Hold / overround: ${((sum-1)*100).toFixed(2)} pts<br>De-vig fair: ${pct(fa,2)} / ${pct(fb,2)}`}
  const eo=Number($('#evOdds').value),ep=Number($('#evProb').value)/100,ed=americanToDecimal(eo),ev=ed?ep*ed-1:null;$('#evResult').innerHTML=ev==null?'—':`${ev>=0?'+':''}${(ev*100).toFixed(2)}% EV · ${money(ev*100)} per $100 staked`;
  const legs=$('#parlayInput').value.split(',').map(x=>Number(x.trim())/100).filter(x=>x>0&&x<1);const pp=legs.length?legs.reduce((x,y)=>x*y,1):null;$('#parlayResult').innerHTML=pp?`${pct(pp,3)} · about 1 in ${(1/pp).toFixed(0)} · fair payout ${(1/pp).toFixed(1)}x`:'Enter probabilities like 50,50,60';
}
['oddsInput','probInput','vigA','vigB','evOdds','evProb','parlayInput'].forEach(id=>$('#'+id).addEventListener('input',updateLabs));

renderPromos();updateLabs();loadBoard();
