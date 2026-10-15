// Research-only integrity audit for Yahoo GC=F hourly bars.
// It does not convert a continuous Yahoo series into executable COMEX futures.
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function nyParts(ts){
 const parts=Object.fromEntries(ny.formatToParts(new Date(ts*1000)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour)};
}
const prevDay=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10)};
const iso=t=>new Date(t*1000).toISOString();
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800');
 try{
  const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+Math.floor(Date.UTC(2025,1,1)/1000)+'&period2='+Math.floor(Date.now()/1000)+'&interval=1h';
  const response=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
  if(!response.ok)throw Error('Yahoo GC=F HTTP '+response.status);
  const j=(await response.json()).chart?.result?.[0];if(!j)throw Error('GC=F chart missing');
  const raw=j.timestamp||[],q=j.indicators?.quote?.[0]||{},now=Math.floor(Date.now()/1000);
  const valid=[],reasons={missing_or_invalid_ohlc:0,not_exact_utc_hour:0,unclosed_current_hour:0,duplicate_hour:0,duplicate_timestamp:0};
  const exactSeen=new Set(),hourCounts=new Map();
  for(let i=0;i<raw.length;i++){
   const t=raw[i],o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i];
   if(exactSeen.has(t))reasons.duplicate_timestamp++;exactSeen.add(t);
   if(![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)&&Number.isFinite(t)){reasons.missing_or_invalid_ohlc++;continue}
   if(!Number.isFinite(t)||![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||h<Math.max(o,c)||l>Math.min(o,c)){reasons.missing_or_invalid_ohlc++;continue}
   if(t%3600!==0){reasons.not_exact_utc_hour++;continue}
   if(t+3600>now){reasons.unclosed_current_hour++;continue}
   const k=Math.floor(t/3600);hourCounts.set(k,(hourCounts.get(k)||0)+1);
   valid.push({t,o,h,l,c,key:k});
  }
  const unique=valid.filter(x=>{
   if(hourCounts.get(x.key)!==1){reasons.duplicate_hour++;return false}
   return true;
  }).sort((a,b)=>a.t-b.t);
  const buckets=new Map();
  for(const x of unique){
   const p=nyParts(x.t),session=(p.hour>=18?p.day:prevDay(p.day));
   const slot=Math.floor((p.hour>=18?p.hour-18:p.hour+6)/4);
   if(slot>=5)continue; // 14-17 ET includes the daily CME break; never fabricate an OHLC candle.
   const key=session+'#'+slot;
   if(!buckets.has(key))buckets.set(key,[]);
   buckets.get(key).push(x);
  }
  const monthly=new Map(),candles=[];
  let excluded_incomplete=0,excluded_nonconsecutive=0,excluded_unclosed=0;
  for(const [key,b] of buckets){
   b.sort((x,y)=>x.t-y.t);
   if(b.length!==4){excluded_incomplete++;continue}
   if(b.some((x,i)=>i>0&&x.t-b[i-1].t!==3600)){excluded_nonconsecutive++;continue}
   if(b[3].t+3600>now){excluded_unclosed++;continue}
   const session=key.split('#')[0],slot=Number(key.split('#')[1]);
   const candle={session_date:session,session_slot:slot,first_hour_utc:iso(b[0].t),close_time_utc:iso(b[3].t+3600),open:b[0].o,high:Math.max(...b.map(x=>x.h)),low:Math.min(...b.map(x=>x.l)),close:b[3].c};
   if(candle.low>Math.min(candle.open,candle.close)||candle.high<Math.max(candle.open,candle.close))throw Error('Aggregate OHLC invariant failed');
   candles.push(candle);
   const m=session.slice(0,7);monthly.set(m,(monthly.get(m)||0)+1);
  }
  candles.sort((a,b)=>a.first_hour_utc.localeCompare(b.first_hour_utc));
  const months=[...monthly].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,closed_4h_candles])=>({month,closed_4h_candles}));
  const byYear=Object.fromEntries([2025,2026].map(y=>[y,candles.filter(x=>x.session_date.startsWith(String(y))).length]));
  const asOf=iso(now);
  const counts={raw_hours:raw.length,distinct_raw_timestamps:exactSeen.size,valid_ohlc_on_hour_nonduplicated:unique.length,...reasons,candidate_buckets:buckets.size,closed_session_aligned_4h:candles.length,excluded_incomplete_buckets:excluded_incomplete,excluded_nonconsecutive_buckets:excluded_nonconsecutive,excluded_unclosed_buckets:excluded_unclosed};
  const latestMonth=months.at(-1)?.month||null;
  res.status(200).json({status:'research_cme_session_hour_integrity_audited',as_of:asOf,source:'Yahoo GC=F 1h proxy',new_york_session_anchor:'18:00 America/New_York (17:00 CT) daily CME Globex re-open, DST aware',four_hour_slots:'18-22,22-02,02-06,06-10,10-14 New York local; 14-18 session-break overlap explicitly excluded',counts,closed_4h_by_year:byYear,closed_4h_by_month:months,first_accepted_candle:candles[0]||null,last_accepted_candle:candles.at(-1)||null,latest_month:latestMonth,data_quality_gate_passed_for_live_execution:false,full_v22_backtest_ready:false,limitations:['Current GC=F continuous proxy is not a specific executable/roll-adjusted futures contract','Hours with duplicated timestamps/ambiguous hourly OHLC are rejected, not averaged','Calendar holidays, exchange session irregularities, source revisions and broker exchange time-stamps are not independently certified','4h candles are closed only when all four distinct consecutive hourly intervals are validated','No signal is generated; Treasury, DXY, real yields, reserves, gold ETF and CFTC as-of joins are still required']});
 }catch(e){res.status(200).json({status:'v22_ohlc_integrity_blocked',error:String(e),no_invented_data:true,data_quality_gate_passed_for_live_execution:false,full_v22_backtest_ready:false})}
};
