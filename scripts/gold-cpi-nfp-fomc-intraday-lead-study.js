// Research only: US CPI, NFP and FOMC event-led intraday price reaction tests.
// Hourly Yahoo continuous futures GC=F, ZT=F and Dollar DX-Y.NYB.
// Event dates from official BLS historical monthly schedules and Federal Reserve FOMC calendars.
// No actual-vs-consensus economic surprise values; ZT futures price is NOT an observed 2Y yield.
const fs=require('node:fs');
const {DateTimeFormat}=Intl;
const formatter=new DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function parts(ms){const p=Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour),min:Number(p.minute)}}
const dates={
 CPI:['2025-01-15','2025-02-12','2025-03-12','2025-04-10','2025-05-13','2025-06-11','2025-07-15','2025-08-12','2025-09-11','2025-10-24','2025-12-18',
      '2026-01-13','2026-02-13','2026-03-11','2026-04-10','2026-05-12','2026-06-10','2026-07-14','2026-08-12','2026-09-11','2026-10-14'],
 NFP:['2025-01-10','2025-02-07','2025-03-07','2025-04-04','2025-05-02','2025-06-06','2025-07-03','2025-08-01','2025-09-05','2025-11-20','2025-12-16',
      '2026-01-09','2026-02-11','2026-03-06','2026-04-03','2026-05-08','2026-06-05','2026-07-02','2026-08-07','2026-09-04','2026-10-02'],
 FOMC:['2025-01-29','2025-03-19','2025-05-07','2025-06-18','2025-07-30','2025-09-17','2025-10-29','2025-12-10',
       '2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16']
};
const allEvents=Object.entries(dates).flatMap(([kind,ds])=>ds.map(date=>({date,kind,hour:kind==='FOMC'?14:8,minute:kind==='FOMC'?0:30}))).sort((a,b)=>a.date.localeCompare(b.date));
const instruments=['GC=F','ZT=F','DX-Y.NYB'];
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const r=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
const sgn=v=>v>0?1:v<0?-1:0;
const med=x=>{if(!x.length)return null;let y=[...x].sort((a,b)=>a-b);return y[Math.floor((y.length-1)/2)]};
const pct=(a,b)=>100*(a/b-1);
async function yahoo(sym,interval,from='2025-01-01'){
 const p1=Math.floor(Date.parse(from+'T00:00:00Z')/1000),p2=Math.floor(Date.parse('2026-10-17T00:00:00Z')/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?period1='+p1+'&period2='+p2+'&interval='+interval;
 const resp=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'},signal:AbortSignal.timeout(34000)});
 if(!resp.ok)throw Error(sym+' '+interval+' HTTP '+resp.status);
 const j=await resp.json(),a=j.chart?.result?.[0],q=a?.indicators?.quote?.[0];if(!a?.timestamp||!q)throw Error(sym+' '+interval+' no data');
 return a.timestamp.map((stamp,i)=>{const t=stamp*1000,l=parts(t);return {ts:t,local_date:l.date,hour:l.hour,min:l.min,open:q.open[i],close:q.close[i],hi:q.high[i],lo:q.low[i]}})
  .filter(x=>Number.isFinite(x.open)&&Number.isFinite(x.close)&&x.open>0&&x.close>0&&Number.isFinite(x.ts))
  .sort((a,b)=>a.ts-b.ts);
}
function makeMap(bars){return new Map(bars.map(x=>[x.ts,x]));}
function findEventBar(bars,event,intervalMinutes){
 let a=bars.filter(b=>b.local_date===event.date&&b.hour===event.hour&&b.min===event.minute);
 return a.length===1?a[0]:null;
}
function evalEvent(evt,maps){
 const posHour=evt.hour,nextStart=evt.hour+1;
 const x={date:evt.date,kind:evt.kind,release_ny:evt.kind==='FOMC'?'14:00':'08:30',coverage:false};
 const bars={};for(const sym of instruments){const array=maps.hourly[sym];let current=array.find(b=>b.local_date===evt.date&&b.hour===posHour&&b.min===0),pre=array.find(b=>b.local_date===evt.date&&b.hour===posHour-1&&b.min===0);
 if(!current||!pre||current.ts-pre.ts!==3600000)return {...x,reason:'missing_or_discontinuous_first_hour_'+sym};
 bars[sym]={cur:current,pre};}
 const gold=bars['GC=F'],rate=bars['ZT=F'],usd=bars['DX-Y.NYB'];
 const first={gold_pct:pct(gold.cur.close,gold.pre.close),zt_pct:pct(rate.cur.close,rate.pre.close),dxy_pct:pct(usd.cur.close,usd.pre.close)};
 const gmaps=maps.indexHourly['GC=F'];
 const futures={};for(const h of [1,2,4]){
  const g0=gmaps.get(gold.cur.ts+3600000),target=gmaps.get(gold.cur.ts+3600000*h);
  let continuous=!!g0&&!!target;
  for(let t=1;t<=h;t++)if(!gmaps.has(gold.cur.ts+t*3600000))continuous=false;
  futures[h]=continuous?pct(target.close,g0.open):null;
 }
 return {...x,coverage:true,signal_cutoff_utc:new Date(gold.cur.ts+3600000).toISOString(),entry_utc:new Date(gold.cur.ts+3600000).toISOString(),
  rate_first_hour_pct:r(first.zt_pct,5),dxy_first_hour_pct:r(first.dxy_pct,5),gold_first_hour_pct:r(first.gold_pct,5),
  rate_side:sgn(first.zt_pct),usd_side:-sgn(first.dxy_pct),gold_side:sgn(first.gold_pct),
  later_gold_1h_pct:r(futures[1],5),later_gold_2h_pct:r(futures[2],5),later_gold_4h_pct:r(futures[4],5)};
}
function stat(arr,pred,h){
 const active=arr.map(x=>({x,dir:pred(x)})).filter(e=>e.dir!==0&&e.dir!=null&&Number.isFinite(e.x['later_gold_'+h+'h_pct']));
 const vals=active.map(e=>e.dir*e.x['later_gold_'+h+'h_pct']),n=vals.length;
 let always=active.map(e=>e.x['later_gold_'+h+'h_pct']);
 return {n,buys:active.filter(e=>e.dir>0).length,sells:active.filter(e=>e.dir<0).length,correct:n?vals.filter(v=>v>0).length:0,
  hit_pct:n?r(100*vals.filter(v=>v>0).length/n,1):null,
  mean_gross_pct:r(mean(vals)),mean_net_after_10bps_pct:r(mean(vals)-.1),
  mean_always_long_same_event_net_pct:r(mean(always)-.1),
  incremental_vs_same_event_long_pct:r(mean(vals)-mean(always))};
}
function calc(events,thr){
 const strategies={
  rate_any:e=>e.rate_side,
  dollar_any:e=>e.usd_side,
  gold_first_hour:e=>e.gold_side,
  rate_dollar_consensus:e=>e.rate_side&&e.rate_side===e.usd_side?e.rate_side:0,
  rate_dollar_consensus_gold_mismatch:e=>e.rate_side&&e.rate_side===e.usd_side&&e.gold_side!==e.rate_side?e.rate_side:0,
  strong_rate:e=>Math.abs(e.rate_first_hour_pct)>=thr.rate?e.rate_side:0,
  strong_dollar:e=>Math.abs(e.dxy_first_hour_pct)>=thr.dxy?e.usd_side:0,
  strong_rate_dollar_consensus:e=>e.rate_side&&e.rate_side===e.usd_side&&Math.abs(e.rate_first_hour_pct)>=thr.rate&&Math.abs(e.dxy_first_hour_pct)>=thr.dxy?e.rate_side:0,
  price_only_when_rate_agrees:e=>e.rate_side===e.gold_side?e.gold_side:0
 };
 return Object.fromEntries(Object.entries(strategies).map(([name,fn])=>[name,Object.fromEntries([1,2,4].map(h=>['h'+h,stat(events,fn,h)]))]));
}
async function recent5min(maps){
 const arr=allEvents.filter(e=>e.date>='2026-08-20'),items=[];
 for(const evt of arr){const mapped={};for(const sym of instruments){
   let data=maps[sym],first=findEventBar(data,evt,5);
   let pre=first&&data.find(x=>x.ts===first.ts-300000);
   if(!first||!pre){mapped[sym]=null;continue}
   const signal=pct(first.close,pre.close);
   mapped[sym]={first,signal};
  }
  if(instruments.some(x=>!mapped[x])){items.push({date:evt.date,kind:evt.kind,status:'missing_5m_reaction'});continue}
  let gold=mapped['GC=F'].first,idx=new Map(maps['GC=F'].map(z=>[z.ts,z])),future={};
  for(const h of [5,15,30,60]){
   const steps=h/5,a=idx.get(gold.ts+300000),last=idx.get(gold.ts+steps*300000);
   let ok=!!a&&!!last;for(let i=1;i<=steps;i++)if(!idx.has(gold.ts+i*300000))ok=false;
   future[h]=ok?r(pct(last.close,a.open),4):null;
  }
  items.push({date:evt.date,kind:evt.kind,release_ny:evt.kind==='FOMC'?'14:00':'08:30',
   signal_cutoff_utc:new Date(gold.ts+300000).toISOString(),
   rate_first_5m_pct:r(mapped['ZT=F'].signal,4),usd_first_5m_pct:r(mapped['DX-Y.NYB'].signal,4),
   gold_first_5m_pct:r(mapped['GC=F'].signal,4),
   gold_later_5m_pct:future[5],gold_later_15m_pct:future[15],gold_later_30m_pct:future[30],gold_later_60m_pct:future[60]});
 }
 return items;
}
async function main(){
 const [g,rates,dxy]=await Promise.all(instruments.map(sym=>yahoo(sym,'1h')));
 const hourly={'GC=F':g,'ZT=F':rates,'DX-Y.NYB':dxy};
 const maps={hourly,indexHourly:Object.fromEntries(Object.entries(hourly).map(([id,v])=>[id,makeMap(v)]))};
 const events=allEvents.map(e=>evalEvent(e,maps));
 const complete=events.filter(e=>e.coverage),train=complete.filter(e=>e.date<'2026-01-01'),test=complete.filter(e=>e.date>='2026-01-01');
 // First-hour magnitude gate uses only 2025, never 2026 outcomes. Median absolute change on eligible published events.
 const thr={rate:med(train.map(e=>Math.abs(e.rate_first_hour_pct)).filter(x=>x>0)),dxy:med(train.map(e=>Math.abs(e.dxy_first_hour_pct)).filter(x=>x>0))};
 const byCategory={};for(const kind of ['CPI','NFP','FOMC'])byCategory[kind]={train:calc(train.filter(x=>x.kind===kind),thr),test:calc(test.filter(x=>x.kind===kind),thr)};
 let micro={error:null,events:[]};try{const p1=await Promise.all(instruments.map(sym=>yahoo(sym,'5m','2026-08-20')));micro.events=await recent5min(Object.fromEntries(instruments.map((id,i)=>[id,p1[i]])));micro.counts=Object.fromEntries(instruments.map((id,i)=>[id,p1[i].length]));}
 catch(e){micro.error=String(e)}
 const result={asof_utc:new Date().toISOString(),status:'intraday_cross_asset_repricing_research_only_not_full_V22',data_sources:{official_BLS_2025_2026:'https://www.bls.gov/schedule/2025/ ; https://www.bls.gov/schedule/2026/',official_FOMC:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',Yahoo_hourly:'GC=F,Z T two year note ZT=F,DXY DX-Y.NYB continuous proxy'},
  design:{calibration_dates:'2025-01-01 to 2025-12-31',holdout_dates:'2026-01-01 to 2026-10-16',events_source:'official actual release calendar not original intended schedule; Oct/Nov 2025  BLS shutdown revisions applied',
    CPI_NFP_NY_release:'08:30',FOMC_NY_statement:'14:00',first_hour:'08:00-09:00 for BLS;14:00-15:00 for FOMC; second includes 14:30 press conference',
    signal_cutoff:'end of first 1h candle after event at 09:00 or 15:00 NY; use PREVIOUS hour close as baseline to capture release jumps',
    entry:'next 1h GOLD candle OPEN after signals entirely observed; avoid same-candle bias',
    future_exit:'end of 1/2/4 future continuous 1h bars; 4h FOMC may be missing during futures maintenance',
    cost_assumed_roundtrip_pct:0.1,not_real_intraday_market_fill:true,market_proxy:'ZT two-year note futures PRICE, not direct 2Y yield or Fed funds expectations; DXY Yahoo ICE-like proxy; continuous GC',
    threshold_2025_only:'median absolute first hour price move for rate and DXY; 2026 held out',
    no_news_surprise_data:true,research_not_causal:true,
    limitations:['hourly bars cannot distinguish whether rates or gold moved first during the FIRST reactive hour','CPI/NFP 08:00-09:00 bar includes 30 min PRE release and 30 min AFTER release; signal only after 09:00','FOMC 14:00-15:00 includes news conference at 14:30','ZF/ ZT contract rolls, Yahoo incomplete 17:00 ET maintenance, 1h bar OHLC artifacts, price availability issues','2025-2026 already used for gold research, not pristine untouched sample','no actual vs consensus CPI/NFP/SEP/Fed rate surprise, hence cannot test surprises explicitly','event time overlap with other economic releases, multiple-hypothesis comparisons','only 1H and limited 5m sensitivity; executable spreads and risk sizing not verified']},
  coverage:{events_scheduled:allEvents.length,events_complete:complete.length,by_type:Object.fromEntries(['CPI','NFP','FOMC'].map(k=>[k,{scheduled:allEvents.filter(x=>x.kind===k).length,covered:complete.filter(x=>x.kind===k).length}])),missing:events.filter(e=>!e.coverage),hourly_counts:Object.fromEntries(Object.entries(hourly).map(([k,v])=>[k,v.length])),train_events:train.length,test_events:test.length,threshold_first_hour_pct:thr},
  events,overall:{train:calc(train,thr),test:calc(test,thr)},by_type:byCategory,micro_5min:micro};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_CPI_NFP_FOMC_2025_2026_HOURLY_REPRICING.json',JSON.stringify(result,null,2));
 const cols=['date','kind','signal_cutoff_utc','rate_first_hour_pct','dxy_first_hour_pct','gold_first_hour_pct','rate_side','usd_side','gold_side','later_gold_1h_pct','later_gold_2h_pct','later_gold_4h_pct'];
 const csv=[cols.join(','),...events.map(x=>cols.map(k=>x[k]??'').join(','))].join('\n')+'\n';
 fs.writeFileSync('research-data/GOLD_CPI_NFP_FOMC_2025_2026_EVENT_ROWS.csv',csv);
 console.log(JSON.stringify({coverage:result.coverage,overall:result.overall,by_type:result.by_type,micro_5min:result.micro_5min.events,source_errors:result.micro_5min.error},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
