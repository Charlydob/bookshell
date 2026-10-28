// Projects persist ISO UTC instants; the device zone is used only at the UI boundary.
export function dayKey(value){const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function localInput(value){if(!value)return '';const d=new Date(value);return `${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
export function instantFromInput(value,original){
 if(original&&localInput(original)===value)return original;
 const d=new Date(value);
 if(!Number.isFinite(d.getTime())||localInput(d)!==value)throw new Error('Esta hora no existe en tu zona por el cambio horario. Elige otra hora.');
 return d.toISOString();
}
export function onDay(entry,key){
 const value=entry.kind==='event'?entry.startAt||entry.dueAt:entry.dueAt||entry.startAt;
 if(!value)return false;
 const first=dayKey(value);
 if(entry.kind==='event'&&entry.endAt){const end=new Date(entry.endAt);if(end.getTime()>new Date(value).getTime())return key>=first&&key<=dayKey(new Date(end.getTime()-1));}
 return first===key;
}
export function monthCells(month){const start=new Date(month.getFullYear(),month.getMonth(),1,12);start.setDate(start.getDate()-(start.getDay()+6)%7);return Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i,12));}
