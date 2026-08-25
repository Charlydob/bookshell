#!/usr/bin/env python3
import json, sys, uuid, copy, re
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/bookshell-api/Bookshell-Reminders-v3-PostgreSQL.json")
dst = Path(sys.argv[2] if len(sys.argv) > 2 else "/opt/bookshell-api/Bookshell-Reminders-v4-PostgreSQL.json")

data = json.loads(src.read_text())
data["name"] = "Bookshell - Reminders v4 PostgreSQL"
data["active"] = False
data["versionId"] = str(uuid.uuid4())
nodes = {n["name"]: n for n in data["nodes"]}

js = nodes["Interpretar Telegram"]["parameters"]["jsCode"]

def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"No pude aplicar parche: {label}")
    return text.replace(old, new, 1)

js = must_replace(js,
"""const TZ = 'Europe/Zurich';
const DEFAULT_HOUR = 9;
const now = new Date();""",
"""const TZ = 'Europe/Zurich';
const DEFAULT_HOUR = 9;
const now = new Date();

const state = $getWorkflowStaticData('global');
state.pendingCustomAlert = state.pendingCustomAlert || {};
const staleCustom = state.pendingCustomAlert[chatId];
if (staleCustom && Date.now() - Number(staleCustom.createdAt || 0) > 30 * 60 * 1000) {
  delete state.pendingCustomAlert[chatId];
}""", "estado conversación")

helper = r"""
function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseSmartQuery(value) {
  const raw = String(value || '').trim();
  const plain = normalizeSearchText(raw);
  let m = raw.match(/^\/buscar\s+(.+)$/i);
  if (m) return { mode:'search', query:m[1].trim(), range:'all' };
  m = raw.match(/^\/horas\s+(.+)$/i);
  if (m) {
    let q=m[1].trim(), range='all';
    if (/\besta\s+semana\b/i.test(q)) { range='this_week'; q=q.replace(/\besta\s+semana\b/ig,'').trim(); }
    if (/\beste\s+mes\b/i.test(q)) { range='this_month'; q=q.replace(/\beste\s+mes\b/ig,'').trim(); }
    return {mode:'hours',query:q,range};
  }
  m = raw.match(/\bcu[aá]ntas?\s+horas?\s+(?:de\s+)?(.+?)\s+(?:he\s+hecho|hice|tengo|hubo)?\s*(esta\s+semana|este\s+mes)?\s*\??$/i);
  if (m) return {mode:'hours',query:String(m[1]||'').trim(),range:String(m[2]||'').toLowerCase().includes('semana')?'this_week':(String(m[2]||'').toLowerCase().includes('mes')?'this_month':'all')};
  m = raw.match(/\bqu[eé]\s+d[ií]as?\s+(?:ha\s+habido|hubo|tuve|ten[ií]a)\s+(.+?)\s*\??$/i);
  if (m) return {mode:'history',query:m[1].trim(),range:'all'};
  m = raw.match(/\bqu[eé]\s+d[ií]a\s+(?:llega|es|tengo|hay)\s+(.+?)\s*\??$/i);
  if (m) return {mode:'when',query:m[1].trim(),range:'all'};
  m = raw.match(/\bcu[aá]ndo\s+(?:llega|es|tengo|hay)\s+(.+?)\s*\??$/i);
  if (m) return {mode:'when',query:m[1].trim(),range:'all'};
  m = raw.match(/^(?:busca|buscar)\s+(.+)$/i);
  if (m) return {mode:'search',query:m[1].trim(),range:'all'};
  if (/^\/?(comandos|ayuda|help)$/.test(plain)) return {mode:'help',query:'',range:'all'};
  return null;
}

function commandHelp() {
  return [
    '🧭 Comandos de Bookshell','',
    '📋 /hoy · /manana · /semana · /proxima · /todos',
    '🔎 /buscar texto',
    '⏱ /horas texto [esta semana|este mes]','',
    'También puedes escribir:',
    '• qué día llega el piano',
    '• qué días ha habido clase de alemán',
    '• cuántas horas de alemán hice esta semana','',
    'Para crear:',
    '• recuérdame mañana a las 18 comprar leche',
    '• clase de alemán (deberes) el jueves de 19:30 a 20:30','',
    'En 🔔 Avisos puedes elegir 🕐 Hora concreta.',
    '/cancelar sale de la hora personalizada.'
  ].join('\n');
}

"""
js = must_replace(js, "function cleanTitle(value) {", helper + "function cleanTitle(value) {", "ayuda/búsqueda")

js = must_replace(js,
"""  const alertMatch = callbackData.match(/^alert_(5m|15m|1h|2h|1d|1w):(.+)$/);""",
"""  if (callbackData.startsWith('alert_custom:')) {
    const reminderId = callbackData.split(':')[1];
    state.pendingCustomAlert[chatId] = { reminderId, createdAt: Date.now() };
    return [{json:{action:'reply',chatId,replyText:'🕐 ¿A qué hora de ese día quieres que te avise?\\nEscribe 09:00, 13 o 13:30.\\n\\n/cancelar para salir.'}}];
  }

  const alertMatch = callbackData.match(/^alert_(5m|15m|1h|2h|1d|1w):(.+)$/);""", "callback hora")

js = must_replace(js,
"""// ----- CONSULTAS -----
const range = listRange(text);""",
"""const activeCustom = state.pendingCustomAlert[chatId];
if (activeCustom) {
  if (/^\\/?cancelar$/i.test(text)) {
    delete state.pendingCustomAlert[chatId];
    return [{json:{action:'reply',chatId,replyText:'↩️ Hora personalizada cancelada.'}}];
  }
  const tm = text.match(/^\\s*([01]?\\d|2[0-3])(?:[:.]([0-5]\\d))?\\s*$/);
  if (!tm) return [{json:{action:'reply',chatId,replyText:'Escribe solo una hora como 09:00, 13 o 13:30.'}}];
  const enteredTime = `${pad(Number(tm[1]))}:${pad(Number(tm[2] || 0))}`;
  delete state.pendingCustomAlert[chatId];
  return [{json:{action:'custom_alert_time',chatId,reminderId:activeCustom.reminderId,enteredTime}}];
}

// ----- CONSULTAS -----
const smart = parseSmartQuery(text);
if (smart?.mode === 'help') return [{json:{action:'reply',chatId,replyText:commandHelp()}}];

const range = listRange(text);""", "hora pendiente")

js = must_replace(js,
"""if (range) {
  return [{
    json: {
      action: 'list',
      chatId,
      range,
    }
  }];
}

const nowLocal = zonedParts(now);""",
"""if (range) {
  return [{json:{action:'list',chatId,range}}];
}
if (smart) {
  return [{json:{action:'search',chatId,searchMode:smart.mode,searchQuery:smart.query,searchRange:smart.range || 'all'}}];
}

const nowLocal = zonedParts(now);""", "ruta búsqueda")

js = must_replace(js,
"""        const prefix = line.slice(0, weekdayMatch.index)
          .replace(/[:\\-–—]+$/g, '')
          .trim();""",
"""        const prefix = line.slice(0, weekdayMatch.index)
          .replace(/[:\\-–—]+$/g, '')
          .replace(/\\b(?:el)\\s*$/i, '')
          .trim();""", "limpieza título")

js = js.replace("title: extra ? `${thisTitle} — ${extra.toUpperCase()}` : thisTitle,",
                "title: extra ? `${thisTitle} (${extra})` : thisTitle,", 1)

nodes["Interpretar Telegram"]["parameters"]["jsCode"] = js

nodes["Confirmar creación"]["parameters"]["text"] = """=✅ {{$json.reminder.emoji || '⏰'}} {{$json.reminder.title}}
📅 {{$json.reminder.targetDate}}{{$json.reminder.targetTime ? ' · ' + $json.reminder.targetTime + ($json.reminder.source?.metadata?.endTime ? '–' + $json.reminder.source.metadata.endTime : '') : ''}}"""
buttons = nodes["Confirmar creación"]["parameters"]["inlineKeyboard"]["rows"][0]["row"]["buttons"]
buttons[0]["text"] = "🔔 Avisos"
buttons[1]["text"] = "❌ Cancelar"

nodes["Menú avisos"]["parameters"]["text"] = "🔔 ¿Cuándo quieres otro aviso?"
rows = nodes["Menú avisos"]["parameters"]["inlineKeyboard"]["rows"]
if not any(any(b.get("text") == "🕐 Hora concreta" for b in r["row"]["buttons"]) for r in rows):
    rows.append({"row":{"buttons":[{"text":"🕐 Hora concreta","additionalFields":{"callback_data":"=alert_custom:{{$json.reminderId}}"}}]}})

nodes["Formatear lista"]["parameters"]["jsCode"] = r"""const response=$json||{},rs=Array.isArray(response.reminders)?response.reminders:[],total=Number(response.total||rs.length||0),range=String(response.range||'all');
const labels={today:'Hoy',tomorrow:'Mañana',this_week:'Esta semana',next_week:'Próxima semana',all:'Recordatorios'};
const dn=['dom','lun','mar','mié','jue','vie','sáb'];
function fd(x=''){const m=String(x).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return x||'sin fecha';const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return `${dn[d.getUTCDay()]} ${m[3]}/${m[2]}`;}
function line(r){const s=String(r.targetTime||''),e=String(r.endTime||r.source?.metadata?.endTime||''),clock=s?`${s}${e?`–${e}`:''}`:'sin hora';return `• ${fd(r.targetDate)} · ${clock} · ${r.emoji||'⏰'} ${r.title}`;}
if(!rs.length)return [{json:{text:`📭 ${labels[range]||labels.all}: ninguno.`}}];
let text=`📋 ${labels[range]||labels.all} (${total})\n\n${rs.map(line).join('\n')}`;if(total>rs.length)text+=`\n\n…mostrando ${rs.length} de ${total}.`;return [{json:{text}}];"""

router = nodes["Router"]
existing_actions = {r["conditions"]["conditions"][0]["rightValue"] for r in router["parameters"]["rules"]["values"]}
def add_rule(action, key):
    if action in existing_actions: return
    router["parameters"]["rules"]["values"].append({
      "conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"strict","version":3},
      "conditions":[{"id":str(uuid.uuid4()),"leftValue":"={{ $json.action }}","rightValue":action,"operator":{"type":"string","operation":"equals"}}],"combinator":"and"},
      "renameOutput":True,"outputKey":key})
add_rule("search","buscar")
add_rule("custom_alert_time","hora personalizada")

telegram_creds = copy.deepcopy(nodes["Enviar lista"].get("credentials"))
http_ver = nodes["Consultar lista"]["typeVersion"]
code_ver = nodes["Formatear lista"]["typeVersion"]
tel_ver = nodes["Enviar lista"]["typeVersion"]
secret = nodes["Añadir aviso en Bookshell"]["parameters"]["headerParameters"]["parameters"][0]["value"]

def mk(name, typ, params, pos, ver, creds=None):
    x={"parameters":params,"id":str(uuid.uuid4()),"name":name,"type":typ,"typeVersion":ver,"position":pos}
    if creds: x["credentials"]=copy.deepcopy(creds)
    return x

search_code = r"""const response=$json||{},all=Array.isArray(response.reminders)?response.reminders:(Array.isArray(response.data)?response.data:[]);
const i=$('Interpretar Telegram').first().json||{},mode=String(i.searchMode||'search'),query=String(i.searchQuery||'').trim(),range=String(i.searchRange||'all');
const norm=(v='')=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,;:()[\]{}"']/g,' ').replace(/\s+/g,' ').trim();
const terms=norm(query).split(' ').filter(x=>x.length>1),score=r=>{const h=norm(`${r.title||''} ${r.description||''} ${r.category||''}`),q=norm(query);let s=0;for(const t of terms)if(h.includes(t))s++;if(q&&h.includes(q))s+=3;if(q&&norm(r.title||'').includes(q))s+=3;return s;};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function addDays(x,n){const [y,m,d]=x.split('-').map(Number),z=new Date(Date.UTC(y,m-1,d+n));return `${z.getUTCFullYear()}-${String(z.getUTCMonth()+1).padStart(2,'0')}-${String(z.getUTCDate()).padStart(2,'0')}`;}
function bounds(){if(range==='this_month')return{from:today.slice(0,7)+'-01',until:today.slice(0,7)+'-31'};if(range==='this_week'){const [y,m,d]=today.split('-').map(Number),wd=new Date(Date.UTC(y,m-1,d)).getUTCDay(),mo=addDays(today,-((wd+6)%7));return{from:mo,until:addDays(mo,6)}}return{from:'',until:''};}
const b=bounds(),inRange=r=>(!b.from||String(r.targetDate||'')>=b.from)&&(!b.until||String(r.targetDate||'')<=b.until);
let m=all.map(r=>({r,s:score(r)})).filter(x=>x.s>0&&inRange(x.r)).sort((a,b)=>`${a.r.targetDate||''}T${a.r.targetTime||'00:00'}`.localeCompare(`${b.r.targetDate||''}T${b.r.targetTime||'00:00'}`)).map(x=>x.r);
const dn=['dom','lun','mar','mié','jue','vie','sáb'];function fd(x=''){const z=String(x).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!z)return x||'sin fecha';const d=new Date(Date.UTC(+z[1],+z[2]-1,+z[3]));return `${dn[d.getUTCDay()]} ${z[3]}/${z[2]}`;}const et=r=>String(r.endTime||r.source?.metadata?.endTime||'');
const line=r=>`• ${fd(r.targetDate)} · ${r.targetTime||'sin hora'}${et(r)?`–${et(r)}`:''} · ${r.title||'Recordatorio'}`;
function mins(s,e){if(!/^\d{2}:\d{2}$/.test(s)||!/^\d{2}:\d{2}$/.test(e))return 0;const [sh,sm]=s.split(':').map(Number),[eh,em]=e.split(':').map(Number);let x=(eh*60+em)-(sh*60+sm);if(x<0)x+=1440;return x;}
if(!m.length)return [{json:{text:`🔎 No encuentro recordatorios que coincidan con “${query}”.`}}];
if(mode==='when'){const f=m.filter(r=>String(r.targetDate||'')>=today&&String(r.status||'pending')!=='cancelled'),r=f[0]||m[m.length-1];return[{json:{text:`📌 ${r.title}\n${fd(r.targetDate)}${r.targetTime?` · ${r.targetTime}${et(r)?`–${et(r)}`:''}`:''}`}}];}
if(mode==='hours'){const d=m.filter(r=>r.targetTime&&et(r)),sum=d.reduce((a,r)=>a+mins(String(r.targetTime),et(r)),0),h=Math.floor(sum/60),mm=sum%60,where=range==='this_week'?' esta semana':(range==='this_month'?' este mes':'');let t=`⏱ ${query}${where}: ${mm?`${h} h ${mm} min`:`${h} h`} en ${d.length} evento${d.length===1?'':'s'}.`;if(d.length)t+=`\n\n${d.slice(0,20).map(line).join('\n')}`;if(m.length>d.length)t+=`\n\nℹ️ ${m.length-d.length} coincidencia(s) sin hora final no se sumaron.`;return[{json:{text:t}}];}
const shown=mode==='history'?m.slice(-20):m.slice(0,20),title=mode==='history'?`🗓 Historial: ${query}`:`🔎 Resultados: ${query}`;let t=`${title} (${m.length})\n\n${shown.map(line).join('\n')}`;if(m.length>shown.length)t+=`\n\n…mostrando ${shown.length} de ${m.length}.`;return[{json:{text:t}}];"""

new_nodes = [
 mk("Consultar búsqueda","n8n-nodes-base.httpRequest",{"url":"http://bookshell-api-api-1:3002/reminders?limit=100","options":{}},[660,300],http_ver),
 mk("Formatear búsqueda","n8n-nodes-base.code",{"jsCode":search_code},[900,300],code_ver),
 mk("Enviar búsqueda","n8n-nodes-base.telegram",{"chatId":"1451166389","text":"={{ $json.text }}","additionalFields":{"appendAttribution":False}},[1140,300],tel_ver,telegram_creds),
 mk("Consultar recordatorio hora","n8n-nodes-base.httpRequest",{"url":"=http://bookshell-api-api-1:3002/reminders/{{$json.reminderId}}","options":{}},[660,520],http_ver),
 mk("Preparar aviso hora","n8n-nodes-base.code",{"jsCode":r"""const r0=$json||{},r=r0.reminder||r0.data||r0,i=$('Interpretar Telegram').first().json||{},id=String(i.reminderId||r.id||''),clock=String(i.enteredTime||''),date=String(r.targetDate||r.target_date||''),tz=String(r.timezone||'Europe/Zurich');
function p(d){const a=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d),o={};for(const x of a)if(x.type!=='literal')o[x.type]=Number(x.value);return o}function off(d){const x=p(d);return Date.UTC(x.year,x.month-1,x.day,x.hour,x.minute,x.second)-d.getTime()}const [y,m,d]=date.split('-').map(Number),[h,mi]=clock.split(':').map(Number),wall=Date.UTC(y,m-1,d,h,mi),probe=new Date(wall),o=off(probe);let n=new Date(wall-o),o2=off(n);if(o2!==o)n=new Date(wall-o2);if(n<=new Date())throw new Error(`La hora ${clock} del ${date} ya ha pasado.`);return[{json:{reminderId:id,enteredTime:clock,notifyAt:n.toISOString()}}];"""},[900,520],code_ver),
 mk("Añadir aviso hora","n8n-nodes-base.httpRequest",{"method":"POST","url":"=http://bookshell-api-api-1:3002/automation/reminders/{{$json.reminderId}}/alerts","sendHeaders":True,"headerParameters":{"parameters":[{"name":"X-Bookshell-Automation-Secret","value":secret}]},"sendBody":True,"contentType":"raw","rawContentType":"application/json","body":"={{ JSON.stringify({mode:'absolute', notifyAt:$json.notifyAt, channel:'telegram'}) }}","options":{}},[1140,520],nodes["Añadir aviso en Bookshell"]["typeVersion"]),
 mk("Confirmar aviso hora","n8n-nodes-base.telegram",{"chatId":"1451166389","text":"=✅ Aviso añadido para las {{ $('Preparar aviso hora').first().json.enteredTime }}.","additionalFields":{"appendAttribution":False}},[1380,520],tel_ver,telegram_creds),
]
names={n["name"] for n in data["nodes"]}
for n in new_nodes:
    if n["name"] not in names: data["nodes"].append(n)

c=data["connections"]
ro=c["Router"]["main"]
while len(ro)<8: ro.append([])
ro[6]=[{"node":"Consultar búsqueda","type":"main","index":0}]
ro[7]=[{"node":"Consultar recordatorio hora","type":"main","index":0}]
c["Consultar búsqueda"]={"main":[[{"node":"Formatear búsqueda","type":"main","index":0}]]}
c["Formatear búsqueda"]={"main":[[{"node":"Enviar búsqueda","type":"main","index":0}]]}
c["Consultar recordatorio hora"]={"main":[[{"node":"Preparar aviso hora","type":"main","index":0}]]}
c["Preparar aviso hora"]={"main":[[{"node":"Añadir aviso hora","type":"main","index":0}]]}
c["Añadir aviso hora"]={"main":[[{"node":"Confirmar aviso hora","type":"main","index":0}]]}

dst.write_text(json.dumps(data,ensure_ascii=False,indent=2))
print(f"OK: {dst}")
