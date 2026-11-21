'use strict';
const {parts,wallInstant,validZone}=require('./notification-time');
function shiftDays(value,days,{dayMode='elapsed',timezone}={}){
 const old=new Date(value);
 if(dayMode==='elapsed')return new Date(old.getTime()+days*86400000).toISOString();
 validZone(timezone);
 const p=parts(old,timezone),date=new Date(p.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);
 const time=`${String(p.hour).padStart(2,'0')}:${String(p.minutes).padStart(2,'0')}`;
 return new Date(wallInstant(date.toISOString().slice(0,10),time,timezone).getTime()+old.getUTCSeconds()*1000+old.getUTCMilliseconds()).toISOString();
}
module.exports={shiftDays};
