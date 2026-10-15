// Pure as-of engine: each feature has an explicit conservative not-before timestamp.
// Delays are research proxies, NOT proof of actual historical publication time or archived vintage.
const DAY=86400000;
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const fmt=t=>{const p=Object.fromEntries(ny.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)}};
const dateMs=d=>Date.parse(d+'T00:00:00Z');
const nextDay=d=>new Date(dateMs(d)+DAY).toISOString().slice(0,10);
const priorDay=d=>new Date(dateMs(d)-DAY).toISOString().slice(0,10);
const availability=(row,lagDays)=>dateMs(row.date)+lagDays*DAY;
const strictDate=d=>/^20\d\d-\d\d-\d\d$/.test(d)&&Number.isFinite(dateMs(d));
function buildAsOf(rows,lagDays){
 if(!Number.isInteger(lagDays)||lagDays<0)throw Error('Invalid lag');
 const grouped=new Map();
 for(const row of rows){if(!strictDate(row.date)||!Number.isFinite(row.value))continue;
  if(!grouped.has(row.date))grouped.set(row.date,[]);grouped.get(row.date).push(row)}
 const out=[...grouped].filter(([,items])=>items.length===1).map(([,items])=>({date:items[0].date,value:items[0].value,available_utc_ms:availability(items[0],lagDays)})).sort((a,b)=>a.available_utc_ms-b.available_utc_ms);
 return {rows:out,duplicates_excluded:[...grouped].filter(([,a])=>a.length!==1).length};
}
function atOrBefore(sorted,utcMs){let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid].available_utc_ms<=utcMs)lo=mid+1;else hi=mid}return lo?sorted[lo-1]:null}
function build4h(raw,nowMs){
 const seen=new Map(),quality={raw:raw.length,missing_ohlc:0,off_hour:0,unclosed:0,duplicate_hours:0,nonconsecutive_groups:0,incomplete_groups:0};
 for(const x of raw){
  if(!Number.isFinite(x.t)||![x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0)||x.h<Math.max(x.o,x.c)||x.l>Math.min(x.o,x.c)){quality.missing_ohlc++;continue}
  if(x.t%3600000!==0){quality.off_hour++;continue}
  if(x.t+3600000>nowMs){quality.unclosed++;continue}
  if(!seen.has(x.t))seen.set(x.t,[]);seen.get(x.t).push(x);
 }
 const groups=new Map();
 for(const [t,rows] of seen){if(rows.length!==1){quality.duplicate_hours+=rows.length;continue}
  const p=fmt(t),session=p.hour>=18?p.date:priorDay(p.date);
  const slot=Math.floor((p.hour>=18?p.hour-18:p.hour+6)/4);
  if(slot>=5)continue;
  const key=session+'#'+slot;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(rows[0]);
 }
 const candles=[];
 for(const [key,items] of groups){items.sort((a,b)=>a.t-b.t);
  if(items.length!==4){quality.incomplete_groups++;continue}
  if(items.some((x,i)=>i>0&&x.t-items[i-1].t!==3600000)){quality.nonconsecutive_groups++;continue}
  const first=items[0],last=items[3];candles.push({session_date:key.slice(0,10),slot:Number(key.slice(11)),start_ms:first.t,close_ms:last.t+3600000,open:first.o,high:Math.max(...items.map(x=>x.h)),low:Math.min(...items.map(x=>x.l)),close:last.c});
 }
 candles.sort((a,b)=>a.start_ms-b.start_ms);
 return {candles,quality};
}
function coverage(candles,sources,mandatory){const count={},lastSample=[];let violations=0,complete=0;
 for(const c of candles){let ok=true;const snapshot={close_utc:new Date(c.close_ms).toISOString(),session_date:c.session_date};
  for(const k of mandatory){const data=atOrBefore(sources[k]?.rows||[],c.close_ms);
   if(data&&data.available_utc_ms<=c.close_ms){count[k]=(count[k]||0)+1;snapshot[k]={observation_date:data.date,not_before_utc:new Date(data.available_utc_ms).toISOString(),value:data.value}}
   else{ok=false;count[k]=count[k]||0}
   if(data&&data.available_utc_ms>c.close_ms)violations++;
  }
  if(ok)complete++;
  if(c===candles[0]||c===candles.at(-1))lastSample.push({close_utc:snapshot.close_utc,all_required_available:ok,asof_dates:Object.fromEntries(mandatory.map(k=>[k,snapshot[k]?.observation_date||null]))});
 }
 return {candle_count:candles.length,complete,complete_pct:candles.length?+(100*complete/candles.length).toFixed(1):null,source_coverage:Object.fromEntries(mandatory.map(k=>[k,{joined_candles:count[k]||0,pct:candles.length?+(100*(count[k]||0)/candles.length).toFixed(1):null}])),future_time_violations:violations,earliest_and_latest_sample:lastSample};
}
module.exports={DAY,fmt,dateMs,nextDay,priorDay,buildAsOf,atOrBefore,build4h,coverage};
