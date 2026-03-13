import { renderCountryHeatmap } from "./world-heatmap.js";
import { getCountryEnglishName, getCountryOptions } from "./countries.js";
import { db, auth } from "./firebase-shared.js";
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const LS_VISITS = "world_visits_v1";
const LS_WATCH = "world_watchlist_v1";
const WORLD_PATH = (uid) => `v2/users/${uid}/world`;
const LEGACY_WORLD_PATHS = (uid) => [`v2/users/${uid}/trips`];
const SUBDIV_GEOJSON_BASE = "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/";

const worldState = { initialized:false, abortController:null, searchCache:new Map(), firebaseUnsub:null, firebaseRef:null, remoteWriteTimer:0, hasResolvedFirstRemoteSnapshot:false, firebaseUid:null, editId:null, countrySubdivCache:new Map() };

function $id(id){ return document.getElementById(id); }
const iso2=(v)=>String(v||"").trim().toUpperCase();
const esc=(s)=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const todayKey=()=>new Date().toISOString().slice(0,10);
const parseJson=(k,f)=>{ try{return JSON.parse(localStorage.getItem(k)||"")??f;}catch{return f;} };
const saveJson=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
const uid=()=>auth.currentUser?.uid || worldState.firebaseUid;
const statusLabel=(s)=>({visited:'Visitado',lived:'Vivido',wishlist:'Wishlist',other:'Otro'})[s]||'Visitado';

function normalizeWorldPayload(raw){
  const visitsRaw = Array.isArray(raw?.visits) ? raw.visits : [];
  const customPinsRaw = Array.isArray(raw?.customPins) ? raw.customPins : [];
  const areaVisitsRaw = Array.isArray(raw?.areaVisits) ? raw.areaVisits : [];
  const timelineRaw = Array.isArray(raw?.timelineEntries) ? raw.timelineEntries : [];
  const watchRaw = raw?.watch && typeof raw.watch==='object' ? raw.watch : {};

  const normalizeRec=(v)=>({
    id:String(v?.id || `${Number(v?.ts)||Date.now()}_${Math.random().toString(16).slice(2)}`),
    ts:Number(v?.ts)||Date.now(),
    dateKey:String(v?.dateKey || v?.startDate || ""),
    startDate:String(v?.startDate || v?.dateKey || ""),
    endDate:String(v?.endDate || ""),
    note:String(v?.note || v?.notes || ""),
    status:["visited","lived","wishlist","other"].includes(v?.status) ? v.status : "visited",
    kind:String(v?.kind || "place"),
    countryCode:iso2(v?.countryCode),
    subdivision:String(v?.subdivision || v?.admin1 || ""),
    subdivisionType:String(v?.subdivisionType || "subdivision"),
    city:String(v?.city || ""),
    placeName:String(v?.placeName || v?.name || ""),
    lat:Number.isFinite(Number(v?.lat)) ? Number(v.lat) : null,
    lon:Number.isFinite(Number(v?.lon)) ? Number(v.lon) : null,
    emoji:String(v?.emoji || ""),
    folder:String(v?.folder || ""),
    source:String(v?.source || "record"),
  });

  const visits=visitsRaw.filter(Boolean).map(normalizeRec).filter(v=>v.countryCode);
  const customPins=customPinsRaw.filter(Boolean).map(v=>normalizeRec({...v,kind:'pin',source:'pin'})).filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon));
  const areaVisits=areaVisitsRaw.filter(Boolean).map(v=>normalizeRec({...v,kind:'subdivision',source:'area'})).filter(v=>v.countryCode&&v.subdivision);
  const timelineEntries=timelineRaw.filter(Boolean).map(v=>normalizeRec({...v,source:'timeline'}));
  const watch={};
  for (const [k,val] of Object.entries(watchRaw)){ const code=iso2(k||val?.code); if(code) watch[code]={code,label:String(val?.label||getCountryEnglishName(code)||code)}; }
  return { visits, watch, customPins, areaVisits, timelineEntries };
}

function mergeById(...lists){ const m=new Map(); lists.flat().forEach(v=>{ if(v?.id) m.set(v.id,{...(m.get(v.id)||{}),...v}); }); return [...m.values()].sort((a,b)=>(b.ts||0)-(a.ts||0)); }
function mergeWatch(local,remote){ return {...(remote||{}), ...(local||{})}; }

function worldPatchPayload(data){
  return {
    visits: Array.isArray(data.visits)?data.visits:[],
    watch: data.watch && typeof data.watch==='object' ? data.watch : {},
    customPins: Array.isArray(data.customPins)?data.customPins:[],
    areaVisits: Array.isArray(data.areaVisits)?data.areaVisits:[],
    timelineEntries: Array.isArray(data.timelineEntries)?data.timelineEntries:[],
    updatedAt: Date.now(),
  };
}

async function readLegacyWorldPayload(userId){
  for (const path of LEGACY_WORLD_PATHS(userId)) {
    try { const snap=await get(ref(db,path)); if (snap.exists()) return normalizeWorldPayload(snap.val()); } catch {}
  }
  return null;
}

let nominatimAbort=null;
async function nominatimSearch(q){
  const normalized=String(q||'').trim().toLowerCase(); if(normalized.length<2) return [];
  if(worldState.searchCache.has(normalized)) return worldState.searchCache.get(normalized);
  if(nominatimAbort) nominatimAbort.abort(); nominatimAbort=new AbortController();
  const u=new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format','json');u.searchParams.set('addressdetails','1');u.searchParams.set('limit','8');u.searchParams.set('accept-language','es');u.searchParams.set('q',normalized);
  try{ const r=await fetch(u.toString(),{signal:nominatimAbort.signal,headers:{Accept:'application/json'}}); if(!r.ok) return []; const d=await r.json(); worldState.searchCache.set(normalized,d); return d; }catch(e){ if(e?.name==='AbortError') return []; return []; }
}
const isCountryishResult=(r)=> String(r?.class||'')==='boundary' || ['country','administrative'].includes(String(r?.type||''));
const isPlaceResult=(r)=>!isCountryishResult(r);

function formatDateRange(v){ const s=v.startDate||v.dateKey||''; const e=v.endDate||''; if(!s&&!e) return 'sin fecha'; if(s&&!e) return s; if(!s&&e) return `— ${e}`; return `${s} — ${e}`; }

function renderWatchlist($list, watch){
  $list.innerHTML=''; const items=Object.values(watch||{}).sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  if(!items.length){ $list.innerHTML='<div class="geo-empty">Sin watchlist.</div>'; return; }
  items.forEach(it=>{ const row=document.createElement('div'); row.className='world-item'; row.innerHTML=`<div><div class="name">${esc(it.label)}</div><div class="meta">${esc(it.code)}</div></div><div class="actions"><button class="btn" data-act="remove-watch" data-code="${it.code}">Quitar</button></div>`; $list.appendChild(row); });
}

function groupByCountry(visits){ const m=new Map(); visits.forEach(v=>{ const c=iso2(v.countryCode); if(!c) return; if(!m.has(c)) m.set(c,[]); m.get(c).push(v); }); return m; }
function aggCountsByCountry(visits){ const m=groupByCountry(visits); return [...m.entries()].map(([code,rows])=>({code,value:rows.length,label:getCountryEnglishName(code)||code,mapName:getCountryEnglishName(code)||code})); }

function countrySlugFromISO2(code){ return (getCountryEnglishName(code)||code||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
async function fetchSubdivGeoJSON(code){
  const c=iso2(code); if(!c) return null;
  if(worldState.countrySubdivCache.has(c)) return worldState.countrySubdivCache.get(c);
  const known={ES:['spain-provinces.geojson','spain-communities.geojson']};
  const slug=countrySlugFromISO2(c);
  const candidates=[...(known[c]||[]),`${slug}.geojson`,`${slug}-provinces.geojson`,`${slug}-states.geojson`,`${slug}-regions.geojson`];
  for(const file of candidates){ try{ const r=await fetch(SUBDIV_GEOJSON_BASE+file,{cache:'force-cache'}); if(!r.ok) continue; const j=await r.json(); (j.features||[]).forEach(f=>{ if(!f.properties) f.properties={}; f.properties.name=String(f.properties.name||f.properties.NAME||f.properties.NAME_1||f.properties.region||f.properties.state||f.properties.province||'—');}); worldState.countrySubdivCache.set(c,j); return j; }catch{} }
  worldState.countrySubdivCache.set(c,null); return null;
}

function filterByTime(rows,mode){ if(mode==='total') return rows.slice(); const now=new Date(); const start=mode==='day'?new Date(now.getFullYear(),now.getMonth(),now.getDate()):mode==='week'?new Date(now.getTime()-6*86400000):mode==='month'?new Date(now.getFullYear(),now.getMonth(),1):new Date(now.getFullYear(),0,1); const ms=start.getTime(); return rows.filter(v=>(Number(v.ts)||0)>=ms); }
function filterByStatus(rows,status){ return status==='all' ? rows : rows.filter(v=>String(v.status||'visited')===status); }

export async function init(){
  if(worldState.initialized) return; worldState.initialized=true; worldState.abortController=new AbortController(); const evtOpts={signal:worldState.abortController.signal};

  const $map=$id('world-map'),$pct=$id('world-pct'),$countries=$id('world-countries'),$countriesTotal=$id('world-countries-total'),$places=$id('world-places'),$subs=$id('world-subdivisions'),$subsTotal=$id('world-subdivisions-total');
  const $filter=$id('world-filter'),$statusFilter=$id('world-status-filter'),$visitsList=$id('world-visits-list'),$watchList=$id('world-watch-list'),$watchInput=$id('world-watch-q'),$watchAdd=$id('world-watch-add');
  const $visitsCount=$id('world-visits-count'),$watchCount=$id('world-watch-count'),$timelineList=$id('world-timeline-list'),$timelineCount=$id('world-timeline-count'),$pinsList=$id('world-pins-list'),$pinsCount=$id('world-pins-count'),$pinFolderFilter=$id('world-pin-folder-filter');
  const $countryTitle=$id('world-country-title'),$countryGrid=$id('world-country-detail-grid'),$subdivisionList=$id('world-subdivision-list');
  const $addKind=$id('world-kind'),$addQuery=$id('world-place-q'),$addSubdiv=$id('world-place-subdivision'),$addCity=$id('world-place-city'),$addStart=$id('world-date-start'),$addEnd=$id('world-date-end'),$addNote=$id('world-note'),$addStatus=$id('world-record-status'),$addEmoji=$id('world-pin-emoji'),$addFolder=$id('world-pin-folder'),$addResults=$id('world-place-results'),$addSave=$id('world-place-save'),$addDelete=$id('world-place-delete'),$addToggle=$id('world-add-toggle'),$markCurrent=$id('world-mark-current');

  let state={ visits:parseJson(LS_VISITS,[]), watch:parseJson(LS_WATCH,{}), customPins:[], areaVisits:[], timelineEntries:[] };
  let pendingPick=null, selectedCountryForDetail=null;

  function persistLocal(){ saveJson(LS_VISITS,state.visits); saveJson(LS_WATCH,state.watch); }
  async function persistRemoteNow(){ if(!uid()||!worldState.firebaseRef) return; try{ await update(worldState.firebaseRef, worldPatchPayload(state)); }catch(e){ console.warn('[world] remote save failed',e);} }
  function scheduleRemote(){ clearTimeout(worldState.remoteWriteTimer); worldState.remoteWriteTimer=setTimeout(()=>persistRemoteNow(),260); }
  function persist(){ persistLocal(); scheduleRemote(); }

  async function initFirebaseSync(){
    if(!uid()) return; worldState.firebaseUid=uid(); worldState.firebaseRef=ref(db,WORLD_PATH(uid()));
    const legacy=await readLegacyWorldPayload(uid());
    worldState.firebaseUnsub=onValue(worldState.firebaseRef,(snap)=>{
      const remote=snap.exists()?normalizeWorldPayload(snap.val()):{visits:[],watch:{},customPins:[],areaVisits:[],timelineEntries:[]};
      if(!worldState.hasResolvedFirstRemoteSnapshot){
        worldState.hasResolvedFirstRemoteSnapshot=true;
        state={
          visits: mergeById(state.visits,remote.visits,legacy?.visits||[]),
          watch: mergeWatch(state.watch,remote.watch),
          customPins: mergeById(state.customPins,remote.customPins,legacy?.customPins||[]),
          areaVisits: mergeById(state.areaVisits,remote.areaVisits,legacy?.areaVisits||[]),
          timelineEntries: mergeById(state.timelineEntries,remote.timelineEntries,legacy?.timelineEntries||[]),
        };
        persistLocal(); renderAll(); persistRemoteNow(); return;
      }
      state.visits=mergeById(state.visits,remote.visits);
      state.watch=mergeWatch(state.watch,remote.watch);
      state.customPins=mergeById(state.customPins,remote.customPins);
      state.areaVisits=mergeById(state.areaVisits,remote.areaVisits);
      state.timelineEntries=mergeById(state.timelineEntries,remote.timelineEntries);
      persistLocal(); renderAll();
    });
  }

  async function renderCountryDetail(code, filtered){
    const c=iso2(code); if(!c){ $countryTitle.textContent='Detalle de país'; $countryGrid.innerHTML=''; $subdivisionList.innerHTML=''; return; }
    const rows=filtered.filter(v=>iso2(v.countryCode)===c);
    const countryName=getCountryEnglishName(c)||c; $countryTitle.textContent=`${countryName} (${c})`;
    const subdivVisited=[...new Set(rows.map(v=>String(v.subdivision||'').trim()).filter(Boolean))];
    const gj=await fetchSubdivGeoJSON(c);
    const total=(gj?.features||[]).length;
    const coverage=total?Math.round((subdivVisited.length/total)*100):0;
    $countryGrid.innerHTML=`
      <div class="world-item"><div><div class="name">Estado</div><div class="meta">${esc(statusLabel(rows[0]?.status||'visited'))}</div></div></div>
      <div class="world-item"><div><div class="name">Capital</div><div class="meta">No disponible</div></div></div>
      <div class="world-item"><div><div class="name">Subdivisiones</div><div class="meta">${subdivVisited.length} / ${total||'—'}</div></div></div>
      <div class="world-item"><div><div class="name">Cobertura</div><div class="meta">${total?coverage+'%':'N/D'}</div></div></div>
    `;
    if(!gj){ $subdivisionList.innerHTML='<div class="geo-empty">Sin subdivisiones homogéneas para este país en la fuente pública actual (fallback a nivel país).</div>'; return; }
    const names=(gj.features||[]).map(f=>String(f.properties?.name||'—'));
    $subdivisionList.innerHTML=names.slice(0,120).map(n=>`<div class="world-item"><div><div class="name">${esc(n)}</div><div class="meta">${subdivVisited.includes(n)?'Visitada':'Sin registrar'}</div></div><div class="actions"><button class="btn" data-act="mark-subdivision" data-code="${c}" data-name="${esc(n)}">Marcar</button></div></div>`).join('');
  }

  function renderTimeline(rows){
    const merged=mergeById(rows, state.timelineEntries, state.areaVisits, state.customPins);
    const byYear=new Map();
    merged.forEach(v=>{ const y=(v.startDate||v.dateKey||'sin-fecha').slice(0,4) || 'sin-fecha'; if(!byYear.has(y)) byYear.set(y,[]); byYear.get(y).push(v); });
    const years=[...byYear.keys()].sort((a,b)=>String(b).localeCompare(String(a)));
    $timelineList.innerHTML='';
    years.forEach(y=>{ const hdr=document.createElement('div'); hdr.className='world-timeline-year'; hdr.textContent=y; $timelineList.appendChild(hdr); byYear.get(y).sort((a,b)=>(b.ts||0)-(a.ts||0)).forEach(v=>{ const row=document.createElement('div'); row.className='world-item'; row.innerHTML=`<div><div class="name">${esc(v.placeName||v.subdivision||getCountryEnglishName(v.countryCode)||v.countryCode)}</div><div class="meta">${esc(formatDateRange(v))} · ${esc(statusLabel(v.status))}${v.note?` · ${esc(v.note)}`:''}</div></div></div>`; $timelineList.appendChild(row); }); });
    $timelineCount.textContent=String(merged.length);
  }

  function renderPins(filtered){
    const folderQ=String($pinFolderFilter?.value||'').toLowerCase().trim();
    const pins=state.customPins.filter(p=>!folderQ || String(p.folder||'').toLowerCase().includes(folderQ));
    $pinsList.innerHTML = pins.length ? pins.map(p=>`<div class="world-item"><div><div class="name">${esc((p.emoji||'📍')+' '+(p.placeName||'Pin'))}</div><div class="meta">${esc((p.folder||'sin carpeta')+' · '+formatDateRange(p))}</div></div><div class="actions"><button class="btn" data-act="edit-record" data-id="${p.id}" data-source="pin">Editar</button><button class="btn" data-act="del-record" data-id="${p.id}" data-source="pin">Borrar</button></div></div>`).join('') : '<div class="geo-empty">Sin pins.</div>';
    $pinsCount.textContent=String(pins.length);
  }

  async function renderAll(){
    const mode=$filter.value||'total'; const stat=$statusFilter.value||'all';
    const filtered=filterByStatus(filterByTime(state.visits,mode),stat);
    const entries=aggCountsByCountry(filtered);
    $countriesTotal.textContent=String(getCountryOptions()?.length||0);
    $countries.textContent=String(new Set(filtered.map(v=>iso2(v.countryCode)).filter(Boolean)).size);
    $places.textContent=String(new Set(filtered.filter(v=>v.kind!=='country').map(v=>`${v.countryCode}:${v.placeName}:${v.lat},${v.lon}`)).size);
    const visitedSubdivisions=new Set(filterByStatus(state.areaVisits,stat).map(v=>`${v.countryCode}:${v.subdivision}`));
    $subs.textContent=String(visitedSubdivisions.size);
    $subsTotal.textContent=selectedCountryForDetail ? String((await fetchSubdivGeoJSON(selectedCountryForDetail))?.features?.length||0) : '0';
    $visitsCount.textContent=String(filtered.length); $watchCount.textContent=String(Object.keys(state.watch||{}).length);
    await renderCountryHeatmap($map, entries, { emptyLabel: 'Aún no hay visitas', showCallouts: false });
    if(window.echarts && $map.__geoChart){
      const points=[...state.customPins,...filtered].filter(v=>Number.isFinite(v.lon)&&Number.isFinite(v.lat)).map(v=>({name:v.placeName||v.subdivision||v.countryCode, value:[v.lon,v.lat,1]}));
      const base=($map.__geoChart.getOption()?.series||[]).length;
      $map.__geoChart.setOption({series:[...Array.from({length:base},()=>({})),{id:'custom-points',type:'scatter',coordinateSystem:'geo',z:22,symbolSize:(p)=>8,itemStyle:{color:'#8cf0ff'},label:{show:false},data:points,tooltip:{show:false},silent:true}]});
      if(!$map.__geoClickBound){ $map.__geoClickBound=true; $map.__geoChart.on('click', async (params)=>{ const name=params?.name; const opt=getCountryOptions()||[]; const found=opt.find(o=>(getCountryEnglishName(o.code)||o.name)===name); if(found){ selectedCountryForDetail=found.code; await renderCountryDetail(found.code, filtered); } }); }
    }
    const pct=((new Set(filtered.map(v=>v.countryCode)).size)/Math.max(1,(getCountryOptions()?.length||1)))*100; $pct.textContent=`${pct.toFixed(2)}%`;

    $visitsList.innerHTML = filtered.length ? filtered.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).map(v=>`<div class="world-item"><div><div class="name">${esc(v.placeName||getCountryEnglishName(v.countryCode)||v.countryCode)}</div><div class="meta">${esc(v.countryCode)} · ${esc(formatDateRange(v))} · <span class="badge ${esc(v.status)}">${esc(statusLabel(v.status))}</span></div></div><div class="actions"><button class="btn" data-act="edit-record" data-id="${v.id}" data-source="visit">Editar</button><button class="btn" data-act="del-record" data-id="${v.id}" data-source="visit">Borrar</button></div></div>`).join('') : '<div class="geo-empty">Aún no hay visitas.</div>';
    renderWatchlist($watchList,state.watch); renderTimeline(filtered); renderPins(filtered);
    if(selectedCountryForDetail) await renderCountryDetail(selectedCountryForDetail, filtered);
  }

  function openEdit(rec, source='visit'){ worldState.editId=rec?.id||null; $addKind.value=rec?.kind||'city'; $addQuery.value=rec?.placeName||''; $addSubdiv.value=rec?.subdivision||''; $addCity.value=rec?.city||''; $addStart.value=rec?.startDate||''; $addEnd.value=rec?.endDate||''; $addNote.value=rec?.note||''; $addStatus.value=rec?.status||'visited'; $addEmoji.value=rec?.emoji||''; $addFolder.value=rec?.folder||''; pendingPick=rec?{code:rec.countryCode,name:rec.placeName,lon:rec.lon,lat:rec.lat}:null; $addDelete.style.display='inline-flex'; $addToggle.checked=true; $addDelete.dataset.source=source; }

  $watchInput.addEventListener('input', async ()=>{ const q=$watchInput.value.trim(); if(q.length<2) return; const rs=(await nominatimSearch(q)).filter(isCountryishResult).slice(0,8); let dl=$id('world-watch-dl'); if(!dl){ dl=document.createElement('datalist'); dl.id='world-watch-dl'; document.body.appendChild(dl); $watchInput.setAttribute('list','world-watch-dl'); } dl.innerHTML=rs.map(r=>`<option value="${esc(r.display_name?.split(',')?.[0]||'')}"></option>`).join(''); }, evtOpts);
  $watchAdd.addEventListener('click', async ()=>{ const q=$watchInput.value.trim(); const r=(await nominatimSearch(q)).find(isCountryishResult); const code=iso2(r?.address?.country_code||r?.country_code); if(!code) return; state.watch[code]={code,label:r?.display_name?.split(',')?.[0]||getCountryEnglishName(code)||code}; persist(); $watchInput.value=''; renderAll(); }, evtOpts);

  $watchList.addEventListener('click',e=>{ const b=e.target.closest('button[data-act="remove-watch"]'); if(!b) return; delete state.watch[iso2(b.dataset.code)]; persist(); renderAll(); }, evtOpts);

  $addQuery.addEventListener('input', async ()=>{ pendingPick=null; $addResults.innerHTML=''; const q=$addQuery.value.trim(); if(q.length<2) return; const kind=$addKind.value; const rs=await nominatimSearch(q); const items=(kind==='country'?rs.filter(isCountryishResult):rs.filter(isPlaceResult)).slice(0,8); $addResults.innerHTML=items.map((r,i)=>`<div class="world-item"><div><div class="name">${esc((r.display_name||'—').split(',')[0])}</div><div class="meta">${esc((r.address?.country_code||'').toUpperCase())} · ${esc(r.type||'')}</div></div><div class="actions"><button class="btn" data-pick="${i}">Elegir</button></div></div>`).join('')||'<div class="geo-empty">Sin resultados.</div>';
    $addResults.querySelectorAll('button[data-pick]').forEach(btn=>btn.addEventListener('click',()=>{ const r=items[Number(btn.dataset.pick)||0]; pendingPick={code:iso2(r?.address?.country_code||r?.country_code),name:(r.display_name||'—').split(',')[0],lon:Number(r.lon),lat:Number(r.lat)}; $addQuery.value=pendingPick.name; }, {once:true}));
  }, evtOpts);

  $addSave.addEventListener('click', async ()=>{
    const kind=$addKind.value; const now=Date.now(); const sourceId=worldState.editId;
    const rec={ id: sourceId || `${now}_${Math.random().toString(16).slice(2)}`, ts: now, dateKey: $addStart.value||todayKey(), startDate:$addStart.value||'', endDate:$addEnd.value||'', note:$addNote.value.trim(), status:$addStatus.value||'visited', kind, countryCode: iso2(pendingPick?.code), subdivision:$addSubdiv.value.trim(), city:$addCity.value.trim(), placeName:$addQuery.value.trim(), lat:Number.isFinite(Number(pendingPick?.lat))?Number(pendingPick.lat):null, lon:Number.isFinite(Number(pendingPick?.lon))?Number(pendingPick.lon):null, emoji:$addEmoji.value.trim(), folder:$addFolder.value.trim() };
    if(!rec.countryCode && kind!=='pin') return;

    const upsert=(arr)=>{ const i=arr.findIndex(v=>v.id===rec.id); if(i>=0) arr[i]={...arr[i],...rec}; else arr.push(rec); };
    if(kind==='pin'){ upsert(state.customPins); }
    else if(kind==='subdivision'){ upsert(state.areaVisits); upsert(state.timelineEntries); }
    else { upsert(state.visits); upsert(state.timelineEntries); }

    persist(); worldState.editId=null; $addDelete.style.display='none'; $addToggle.checked=false; $addResults.innerHTML=''; await renderAll();
  }, evtOpts);

  $addDelete.addEventListener('click', async ()=>{
    const id=worldState.editId; if(!id) return;
    state.visits=state.visits.filter(v=>v.id!==id); state.customPins=state.customPins.filter(v=>v.id!==id); state.areaVisits=state.areaVisits.filter(v=>v.id!==id); state.timelineEntries=state.timelineEntries.filter(v=>v.id!==id);
    persist(); worldState.editId=null; $addDelete.style.display='none'; $addToggle.checked=false; await renderAll();
  }, evtOpts);

  $visitsList.addEventListener('click',e=>{ const btn=e.target.closest('button[data-act]'); if(!btn) return; const id=btn.dataset.id; const rec=state.visits.find(v=>v.id===id); if(!rec) return; if(btn.dataset.act==='del-record'){ state.visits=state.visits.filter(v=>v.id!==id); state.timelineEntries=state.timelineEntries.filter(v=>v.id!==id); persist(); renderAll(); return; } if(btn.dataset.act==='edit-record') openEdit(rec,'visit'); }, evtOpts);
  $pinsList.addEventListener('click',e=>{ const btn=e.target.closest('button[data-act]'); if(!btn) return; const id=btn.dataset.id; const rec=state.customPins.find(v=>v.id===id); if(!rec) return; if(btn.dataset.act==='del-record'){ state.customPins=state.customPins.filter(v=>v.id!==id); state.timelineEntries=state.timelineEntries.filter(v=>v.id!==id); persist(); renderAll(); return; } if(btn.dataset.act==='edit-record') openEdit(rec,'pin'); }, evtOpts);
  $subdivisionList.addEventListener('click', e=>{ const btn=e.target.closest('button[data-act="mark-subdivision"]'); if(!btn) return; $addKind.value='subdivision'; $addQuery.value=getCountryEnglishName(btn.dataset.code)||btn.dataset.code; pendingPick={code:btn.dataset.code,name:$addQuery.value,lon:null,lat:null}; $addSubdiv.value=btn.dataset.name; $addToggle.checked=true; }, evtOpts);

  $markCurrent?.addEventListener('click', ()=>{ if(!navigator.geolocation) return; navigator.geolocation.getCurrentPosition((pos)=>{ $addKind.value='pin'; pendingPick={code:'',name:'Ubicación actual',lat:pos.coords.latitude,lon:pos.coords.longitude}; $addQuery.value='Ubicación actual'; $addToggle.checked=true; }, ()=>{}); }, evtOpts);

  $filter.addEventListener('change',renderAll,evtOpts); $statusFilter.addEventListener('change',renderAll,evtOpts); $pinFolderFilter.addEventListener('input',renderAll,evtOpts);
  await initFirebaseSync(); await renderAll();
}

export function destroy(){ if(worldState.abortController){ worldState.abortController.abort(); worldState.abortController=null; } if(worldState.firebaseUnsub){ worldState.firebaseUnsub(); worldState.firebaseUnsub=null; } if(worldState.remoteWriteTimer){ clearTimeout(worldState.remoteWriteTimer); worldState.remoteWriteTimer=0; } if(nominatimAbort){ nominatimAbort.abort(); nominatimAbort=null; } worldState.hasResolvedFirstRemoteSnapshot=false; worldState.initialized=false; }
export function getListenerCount(){ let count=0; if(worldState.abortController) count++; if(worldState.firebaseUnsub) count++; if(worldState.remoteWriteTimer) count++; return count; }
