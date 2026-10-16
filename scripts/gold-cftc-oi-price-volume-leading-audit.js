// GOLD OI + price + volume research, NOT a live signal.
// Sources: Official CFTC futures-only disaggregated GOLD 088691 (2018-2026);
// Yahoo GC=F and GLD daily price; latest historical revisions not archived.
// Explicit conservative CFTC release lag and 2025 shutdown revised release calendar.
const fs=require('node:fs');
const ONE=864e5,utc=d=>Date.parse(d+'T00:00:00Z'),fmt=ms=>new Date(ms).toISOString().slice(0,10);
const plus=(d,n)=>fmt(utc(d)+n*ONE);
const pct=(a,b)=>(a/b-1)*100;
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const round=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
const sg=x=>x>0?1:x<0?-1:0;
const shutdown={"2025-09-30":"2025-11-19","2025-10-07":"2025-11-21","2025-10-14":"2025-11-25","2025-10-21":"2025-12-02","2025-10-28":"2025-12-05","2025-11-04":"2025-12-09","2025-11-10":"2025-12-10","2025-11-18":"2025-12-12","2025-11-25":"2025-12-15","2025-12-02":"2025-12-17","2025-12-09":"2025-12-19","2025-12-16":"2025-12-23","2025-12-23":"2025-12-29","2025-12-30":"2026-01-05","2026-01-06":"2026-01-09","2026-01-13":"2026-01-16","2026-01-20":"2026-01-23"};
const cutoffShutdownReport=a=>false;
async function cot(){
 const p=new URLSearchParams({cftc_contract_market_code:'088691','$where':"report_date_as_yyyy_mm_dd >= '2018-01-01T00:00:00'","$order":"report_date_as_yyyy_mm_dd ASC","$limit":"1200"});
 const u='https://publicreporting.cftc.gov/resource/72hh-3qpy.json?'+p,r=await fetch(u,{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('CFTC HTTP '+r.status);
 const rows=await r.json();if(!Array.isArray(rows)||rows.length<350)throw Error('CFTC incomplete '+rows.length);
 return rows.map(x=>({date:x.report_date_as_yyyy_mm_dd?.slice(0,10),oi:+x.open_interest_all,mmLong:+x.m_money_positions_long_all,mmShort:+x.m_money_positions_short_all,market:x.market_and_exchange_names}))
 .filter(x=>/^20\d\d-\d\d-\d\d$/.test(x.date)&&[x.oi,x.mmLong,x.mmShort].every(Number.isFinite)&&x.oi>0&&x.market.toUpperCase().includes('GOLD'))
 .sort((a,b)=>a.date.localeCompare(b.date));
}
async function daily(symbol){
 const u='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1=1514764800&period2=1792252800&interval=1d';
 const r=await fetch(u,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});if(!r.ok)throw Error('Yahoo '+symbol+' '+r.status);
 const x=(await r.json()).chart?.result?.[0],q=x?.indicators?.quote?.[0];if(!q)throw Error('Yahoo missing '+symbol);
 return x.timestamp.map((t,i)=>({date:fmt(t*1000),o:q.open[i],c:q.close[i],h:q.high[i],l:q.low[i],v:q.volume[i]})).filter(x=>[x.o,x.c].every(Number.isFinite)&&x.o>0&&x.c>0).sort((a,b)=>a.date.localeCompare(b.date));
}
function getEvent(all,price,gld,lag){const map=new Map(gld.map((x,i)=>[x.date,i])),events=[],excluded={calendar:0,late:0,short_history:0,duplicate_release:0,missing_price:0};let prevChosen=-1;
 for(let i=4;i<all.length;i++){
   const rep=all[i],date=rep.date;if(date<'2019-01-01')continue;
   if(cutoffShutdownReport(date)){excluded.calendar++;continue}
   let avail=plus(date,lag);if(shutdown[date]&&shutdown[date]>avail)avail=shutdown[date];
   if(avail>'2026-10-16'){excluded.late++;continue}
   const j=price.findIndex(x=>x.date>avail);
   if(j<65||j>price.length-11){excluded.missing_price++;continue}
   const signalIdx=j-1,latest=price[signalIdx],prior=price[signalIdx-5];if(!prior){excluded.short_history++;continue}
   const oi1=pct(rep.oi,all[i-1].oi),oi4=pct(rep.oi,all[i-4].oi),mm1=(rep.mmLong-rep.mmShort)-(all[i-1].mmLong-all[i-1].mmShort),
     mm4=(rep.mmLong-rep.mmShort)-(all[i-4].mmLong-all[i-4].mmShort);
   const mom5=pct(latest.c,prior.c),vol5=price.slice(signalIdx-4,signalIdx+1).map(x=>x.v),
     vol60=price.slice(signalIdx-59,signalIdx+1).map(x=>x.v),volratio=vol60.every(x=>Number.isFinite(x)&&x>10000)?mean(vol5)/mean(vol60):null;
   // Same event date represents only one usable knowledge point; if two catch-up publications align, select newest report.
   if(j===prevChosen){events.pop();excluded.duplicate_release++}prevChosen=j;
   const fut={};for(const h of [1,3,5,10]){const finish=price[j+h-1];fut[h]=finish?100*(finish.c/price[j].o-1):null}
   const gldidx=map.get(price[j].date),glr={};for(const h of [1,3,5,10]){const finish=gld[gldidx+h-1];glr[h]=gldidx!=null&&finish&&finish.date<=plus(price[j].date,25)?100*(finish.c/gld[gldidx].o-1):null}
   const mmyear=date.slice(0,4);
   events.push({report_date:date,available_date:avail,signal_date:latest.date,entry_date:price[j].date,entry_index:j,oi1,oi4,mm1,mm4,mom5,volratio,fut,glr,year:Number(price[j].date.slice(0,4))});
 }
 return {events,excluded}
}
function direct(s,e){let x={P5:sg(e.mom5),OI1:sg(e.oi1),OI4:sg(e.oi4),MM4:sg(e.mm4),OI4_PRICE5:sg(e.oi4)===sg(e.mom5)?sg(e.mom5):0,
 OI1_PRICE5:sg(e.oi1)===sg(e.mom5)?sg(e.mom5):0,
 OI4_MM4_PRICE5:sg(e.oi4)===sg(e.mm4)&&sg(e.mm4)===sg(e.mom5)?sg(e.mom5):0,
 OI4_PRICE5_VOLUME:sg(e.oi4)===sg(e.mom5)&&e.volratio>=1.15&&e.year>=2021?sg(e.mom5):0,
 OI4_UP_PRICE5_UP:sg(e.oi4)>0&&sg(e.mom5)>0?1:0,
 OI4_UP_PRICE5_DOWN_TREND:sg(e.oi4)>0&&sg(e.mom5)<0?-1:0,
 OI4_UP_PRICE5_DOWN_REVERSAL:sg(e.oi4)>0&&sg(e.mom5)<0?1:0};
 return x[s]||0;
}
const strategies=['P5','OI1','OI4','MM4','OI4_PRICE5','OI1_PRICE5','OI4_MM4_PRICE5','OI4_PRICE5_VOLUME','OI4_UP_PRICE5_UP','OI4_UP_PRICE5_DOWN_TREND','OI4_UP_PRICE5_DOWN_REVERSAL'];
function calc(events,strat,h,asset='fut',filter=null){
 let e=events.filter(x=>x[asset][h]!=null&&(!filter||filter(x)));
 const picked=e.map(x=>({...x,side:direct(strat,x)})).filter(x=>x.side!==0);
 const n=picked.length;
 const arr=picked.map(x=>x[asset][h]*x.side-0.1), baseline=picked.map(x=>x[asset][h]-0.1);
 const success=picked.filter(x=>x[asset][h]*x.side>0).length;
 const non=[];let last=-1e5;for(const x of picked){if(x.entry_index-last>=h){non.push(x);last=x.entry_index}}
 let win=non.filter(x=>x[asset][h]*x.side>0).length;
 return {n,longs:picked.filter(x=>x.side>0).length,shorts:picked.filter(x=>x.side<0).length,win:n?success:0,
  hit:n?round(100*success/n,1):null,mean_net:round(mean(arr)),same_events_buyhold:round(mean(baseline)),edge_vs_buyhold:round(mean(arr)-mean(baseline)),
  nonoverlap_n:non.length,nonoverlap_hit:non.length?round(100*win/non.length,1):null,nonoverlap_net:round(mean(non.map(x=>x[asset][h]*x.side-0.1)))};
}
function yearset(name){return ({train:[2019,2020,2021,2022],validate:[2023,2024],test:[2025,2026]})[name]}
function summary(events,asset='fut'){
 return Object.fromEntries(strategies.map(k=>[k,Object.fromEntries(['train','validate','test'].map(cohort=>[cohort,Object.fromEntries([1,3,5,10].map(h=>[h,calc(events.filter(x=>yearset(cohort).includes(x.year)),k,h,asset)]))]))]))
}
function classify(e){return (e.mom5>0?'PRICE_UP':'PRICE_DOWN')+'__'+(e.oi4>0?'OI_UP':'OI_DOWN')}
async function main(){
 const [a,p,g]=await Promise.all([cot(),daily('GC=F'),daily('GLD')]);
 let bylag={};for(const lag of [7,15]){
   const result=getEvent(a,p,g,lag);
   let events=result.events;
   bylag[lag]={excluded:result.excluded,n:events.length,period:Object.fromEntries(['train','validate','test'].map(x=>[x,events.filter(e=>yearset(x).includes(e.year)).length])),
    gold:summary(events,'fut'),gld:summary(events,'glr'),
    oi_price_four_quadrants:Object.fromEntries(['PRICE_UP__OI_UP','PRICE_UP__OI_DOWN','PRICE_DOWN__OI_UP','PRICE_DOWN__OI_DOWN'].map(cat=>[cat,Object.fromEntries(['train','validate','test'].map(cohort=>[cohort,{n:events.filter(x=>classify(x)===cat&&yearset(cohort).includes(x.year)).length,trend:calc(events.filter(x=>classify(x)===cat&&yearset(cohort).includes(x.year)),'P5',5),oi:calc(events.filter(x=>classify(x)===cat&&yearset(cohort).includes(x.year)),'OI4',5)}]))])),
    price_volume_quality:Object.fromEntries([2019,2020,2021,2022,2023,2024,2025,2026].map(y=>{let z=p.filter(x=>x.date.startsWith(String(y)));return [y,{n:z.length,vol_gt_10000:z.filter(x=>x.v>10000).length,median_daily_volume:Math.round((z.map(x=>x.v).sort((u,v)=>u-v)[Math.floor(z.length/2)]||0))}]})),
    examples:events.slice(-6).map(x=>({report:x.report_date,available:x.available_date,entry:x.entry_date,oi4:round(x.oi4,2),price5:round(x.mom5,2),mm4:x.mm4,volume_ratio:round(x.volratio)}))};
 }
 const out={generated_at:new Date().toISOString(),status:'CFTC_OI_PRICE_VOLUME_INDEPENDENT_RESEARCH_NO_TRADING',
  sources:{cot:'https://publicreporting.cftc.gov/resource/72hh-3qpy.json CFTC 088691 GOLD futures-only',gold:'Yahoo GC=F continuous front future daily, not exchange-certified fills',gld:'Yahoo GLD ETF daily stock OHLC'},
  methodology:{COT_conservative_lags_days:[7,15],COT_2025_shutdown_actual_calendar_from:'https://www.cftc.gov/PressRoom/PressReleases/9147-25',
   exclusion_dates:'2025-12-30 through 2026-01-20 as release schedule ambiguous in sample',
   signal:'use last fully observed GC=F trading session preceding next full trading day after assumed COT release',
   trade:'enter next GC=F/GLD daily open after release, exit 1/3/5/10 observed trading days later close',
   cost_pct_round_trip:0.1,volume_warning:'Yahoo GC=F volume anomalous 2018-2019; volume strategy restricted year >= 2021 and last60 daily volumes all>10000',
   future_price_always_after_signal:true,holdout:'2019-2022 train, 2023-2024 validation, 2025-2026 later holdout; choices and hypotheses exploratory',
   market_bias:'futures continuous roll artifact, commodity carry, intraday news releases, holidays; latest historical COT snapshot not independent saved release vintage; nonoverlapping sensitivity reported'},
  raw_count:{CFTC_rows:a.length,start:a[0].date,end:a.at(-1).date,GC_prices:p.length,GLD_prices:g.length},
  bylag};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_CFTC_OI_PRICE_VOLUME_2019_2026_results.json',JSON.stringify(out,null,2));
 const hdr=['lag','strategy','cohort','asset','horizon_days','n','longs','shorts','hit_pct','average_return_net_pct','matched_alwayslong_return_pct','excess_vs_long_pct','nonoverlap_n','nonoverlap_hit_pct','nonoverlap_net_pct'],rows=[];
 for(const lag of [7,15])for(const asset of ['gold','gld'])for(const st of strategies)for(const cohort of ['train','validate','test'])for(const h of [1,3,5,10]){
  const d=bylag[lag][asset][st][cohort][h];rows.push([lag,st,cohort,asset,h,d.n,d.longs,d.shorts,d.hit,d.mean_net,d.same_events_buyhold,d.edge_vs_buyhold,d.nonoverlap_n,d.nonoverlap_hit,d.nonoverlap_net].join(','))
 }
 fs.writeFileSync('research-data/GOLD_CFTC_OI_PRICE_VOLUME_2019_2026_summary.csv',[hdr.join(','),...rows].join('\n')+'\n');
 for(const lag of [7,15]){console.log('LAG',lag,'period',JSON.stringify(bylag[lag].period),'excluded',JSON.stringify(bylag[lag].excluded));
  for(const s of strategies){const b=bylag[lag].gold[s];console.log('RESULT',lag,s,...['train','validate','test'].map(k=>[k,b[k][5].n,b[k][5].hit,b[k][5].mean_net,b[k][5].same_events_buyhold,b[k][5].nonoverlap_n,b[k][5].nonoverlap_hit].join(':')))}
 }
 console.log('EXAMPLES',JSON.stringify(bylag[7].examples));
}
main().catch(e=>{console.error(e);process.exitCode=1});
