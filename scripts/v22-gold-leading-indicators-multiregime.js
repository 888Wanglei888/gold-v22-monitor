// Independent daily-market extension: 2019-2022 research calibration, 2023-2024 validation,
// 2025-2026 later-period check. Fixed economic signs; no full V2.2 trading claim.
const fs=require('node:fs');
const {buildAsOf,atOrBefore,DAY}=require('../lib/endpoints/v22-asof-core');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const dateMs=s=>Date.parse(s+'T00:00:00Z');
const fmt=x=>x?new Date(x).toISOString().slice(0,10):null;
const delayBy={DFII10:3,DGS2:3,DGS10:3,T10YIE:3,THREEFYTP10:3,VIXCLS:3,DXY:2,TGA:3};
const definitions=[
 {id:'DXY',name:'美元指数 DXY',lookback:5,sign:-1,age:7},
 {id:'DFII10',name:'10年实际利率',lookback:5,sign:-1,age:8},
 {id:'DGS2',name:'2年美债收益率',lookback:5,sign:-1,age:8},
 {id:'DGS10',name:'10年名义收益率',lookback:5,sign:-1,age:8},
 {id:'T10YIE',name:'10年通胀补偿',lookback:5,sign:1,age:8},
 {id:'THREEFYTP10',name:'10年期限溢价（信用折价假设）',lookback:5,sign:1,age:8},
 {id:'VIXCLS',name:'VIX恐慌指数（避险假设）',lookback:5,sign:1,age:8},
 {id:'GLD_TONNES_DELTA',name:'GLD黄金ETF持仓变化',lookback:5,sign:1,age:9,sum:true},
 {id:'TGA',name:'财政TGA余额变化',lookback:5,sign:-1,age:9},
 {id:'COT_NET',name:'CFTC管理资金黄金净多',lookback:4,sign:1,age:30},
 {id:'COT_OI',name:'CFTC黄金期货OI总量',lookback:4,sign:1,age:30},
 {id:'GOLD_MOM5',name:'黄金自身5日趋势',lookback:5,sign:1},
 {id:'GOLD_MOM20',name:'黄金自身20日趋势',lookback:20,sign:1}
];
const round=(x,p=3)=>Number.isFinite(x)?+x.toFixed(p):null;
const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sg=x=>x>0?1:x<0?-1:0;
const quant=(a,q)=>{if(!a.length)return null;let z=[...a].sort((a,b)=>a-b);return z[Math.floor((z.length-1)*q)]};
async function fred(id){
 const r=await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd=2018-01-01',{signal:AbortSignal.timeout(28000)});
 if(!r.ok)throw Error('FRED '+id+' HTTP '+r.status);
 const lines=(await r.text()).split(/\r?\n/);
 if(!lines[0].includes(id))throw Error('FRED header '+id);
 return lines.slice(1).map(x=>x.replaceAll('"','').trim().split(',')).filter(x=>x.length===2&&x[1]&&x[1]!=='.'&&Number.isFinite(+x[1])).map(x=>({date:x[0],value:+x[1]}));
}
async function yahoo(symbol){
 const start=Math.floor(Date.parse('2018-01-01T00:00:00Z')/1000),end=Math.floor(Date.parse('2026-10-17T00:00:00Z')/1000);
 const u='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1='+start+'&period2='+end+'&interval=1d';
 const r=await fetch(u,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error('Yahoo '+symbol+' '+r.status);
 const x=(await r.json()).chart?.result?.[0],q=x?.indicators?.quote?.[0];if(!q)throw Error('Yahoo '+symbol+' empty');
 return x.timestamp.map((ts,i)=>({date:fmt(ts*1000),open:q.open[i],close:q.close[i],high:q.high[i],low:q.low[i]}))
  .filter(x=>Number.isFinite(x.close)&&Number.isFinite(x.open)&&x.close>0&&x.open>0).sort((a,b)=>a.date.localeCompare(b.date));
}
function asof(src,t,ageDays){let a=atOrBefore(src?.rows||[],t);return a&&t-dateMs(a.date)<=ageDays*DAY?a:null}
function change(src,t,n,age,sum){const x=asof(src,t,age);if(!x)return null;let a=src.rows,lo=0,hi=a.length;while(lo<hi){let m=(lo+hi)>>1;if(a[m].available_utc_ms<=t)lo=m+1;else hi=m}const ix=lo-1;if(ix<n)return null;return sum?a.slice(ix-n+1,ix+1).reduce((z,x)=>z+x.value,0):a[ix].value-a[ix-n].value}
function assess(xs,h,threshold){
 let e=xs.filter(x=>x.fwd[h]!=null&&Math.abs(x.delta)>=threshold&&x.pred!==0);
 let num=e.length,good=e.filter(x=>x.pred*x.fwd[h]>0).length,br=e.filter(x=>x.fwd[h]>0).length;
 let non=[],last=-Infinity;for(const x of e){if(x.index-last>=h){non.push(x);last=x.index}}
 return {n:num,hit_pct:num?round(good/num*100,1):null,gold_always_long_hit_pct:num?round(br/num*100,1):null,
  avg_after_10bp_cost_pct:round(average(e.map(x=>x.pred*x.fwd[h]-.1))),same_days_always_long_net_pct:round(average(e.map(x=>x.fwd[h]-.1))),
  excess_vs_always_long_pct:round(average(e.map(x=>(x.pred-1)*x.fwd[h]))),
  nonoverlap_n:non.length,nonoverlap_hit_pct:non.length?round(100*non.filter(x=>x.pred*x.fwd[h]>0).length/non.length,1):null,
  nonoverlap_avg_net_pct:round(average(non.map(x=>x.pred*x.fwd[h]-.1)))};
}
function corr(a,b){if(a.length<5||a.length!==b.length)return null;let ma=average(a),mb=average(b),num=0,aa=0,bb=0;for(let i=0;i<a.length;i++){let x=a[i]-ma,y=b[i]-mb;num+=x*y;aa+=x*x;bb+=y*y}return aa>0&&bb>0?num/Math.sqrt(aa*bb):null}
async function main(){
 const [prices,etfprices,fx,...rates]=await Promise.all([yahoo('GC=F'),yahoo('GLD'),yahoo('DX-Y.NYB'),...['DFII10','DGS2','DGS10','T10YIE','THREEFYTP10','VIXCLS'].map(fred)]);
 const src=await loadResearchInputs();
 const ids=['DFII10','DGS2','DGS10','T10YIE','THREEFYTP10','VIXCLS'];
 const sources={};for(let i=0;i<ids.length;i++)sources[ids[i]]=buildAsOf(rates[i],3);
 sources.DXY=buildAsOf(fx.map(x=>({date:x.date,value:x.close})),2);
 for(const id of ['GLD_TONNES_DELTA','COT_NET','COT_OI'])sources[id]=src.sources[id];
 // Use 2019-2026 same-source daily TGA archive maintained by research branch, latest version not certified historical vintage.
 const csv=fs.readFileSync('research-data/official_tga_daily_2019_20261014.csv','utf8');
 const tga=csv.trim().split(/\r?\n/).slice(1).map(x=>x.replaceAll('"','').split(',')).filter(x=>x.length===2&&Number.isFinite(+x[1])).map(x=>({date:x[0],value:+x[1]}));
 sources.TGA=buildAsOf(tga,3);
 const cohorts={calibration:'2019-01-01:2022-12-31',validation:'2023-01-01:2024-12-31',later_evaluation:'2025-01-01:2026-10-16'};
 const periods=[{name:'calibration',start:'2019-01-01',end:'2022-12-31'},
  {name:'validation',start:'2023-01-01',end:'2024-12-31'},
  {name:'later_evaluation',start:'2025-01-01',end:'2026-10-16'}];
 const eventsByFactor={};
 const result={created_utc:new Date().toISOString(),status:'expanded_daily_gold_oos_macro_lead_experiment_research_only',
  sources:{gold:'Yahoo GC=F continuous front futures daily 2018-2026',confirm_gold:'Yahoo GLD ETF US equity daily 2018-2026',
   dollar:'Yahoo DX-Y.NYB daily with 2-calendar-day conservative delay',
   fred:'FRED 2018-2026 data with 3-calendar-day conservative delay',gld_cot:'Project as-of sources GLD archive, CFTC published reports conservatively lagged',
   treasury:'Treasury FiscalData current-vintage 2019-2026 daily TGA with 3-day lag'},
  design:{start:'2019-01-01',end:'2026-10-16',cohorts,threshold:'60th percentile absolute indicator move estimated 2019-2022 only; CFTC late-start exception uses 2024 calibration',
   sign_rule:'Economically hypothesized fixed sign, NOT optimized by outcomes',gold_signal_time:'23:59:59 UTC on completed daily Yahoo date label',
   execution:'next available gold daily OPEN, exit that or third or fifth following trading day CLOSE',
   cost:'10 bps round trip; no financing or realistic COMEX roll/fees beyond flat cost',
   note:'Overlapping events, not independent strategy, not certified publication vintages; calibration/validation periods NOT truly untouched research'},
  raw_counts:{gold_prices:prices.length,gld_prices:etfprices.length,dxy:fx.length,tga:tga.length,source_errors:src.source_errors},
  indicators:{},warnings:[]};
 if(prices.length<1800||etfprices.length<1800)throw Error('Insufficient long daily market history');
 for(const f of definitions){
  let events=[];
  for(let i=22;i<prices.length-5;i++){
   let r=prices[i];if(r.date<'2019-01-01')continue;
   const t=dateMs(r.date)+DAY-1000;
   let delta=f.id.startsWith('GOLD_MOM')?100*(r.close/prices[i-f.lookback].close-1):change(sources[f.id],t,f.lookback,f.age,f.sum);
   if(!Number.isFinite(delta)||sg(delta)===0)continue;
   let pred=sg(delta)*f.sign,fwd={};
   for(const h of [1,3,5])fwd[h]=prices[i+h]&&prices[i+1]?100*(prices[i+h].close/prices[i+1].open-1):null;
   events.push({date:r.date,index:i,delta,pred,fwd,past_gold_5d_pct:100*(r.close/prices[i-5].close-1)});
  }
  eventsByFactor[f.id]=events;
  const byPeriod={};for(const p of periods)byPeriod[p.name]=events.filter(x=>x.date>=p.start&&x.date<=p.end);
  // CFTC series begins in 2024 due source range; do NOT pretend threshold comes from 2019-2022.
  const thresholdSource=byPeriod.calibration.length>=60?byPeriod.calibration:events.filter(x=>x.date<'2025-01-01');
  const threshold=quant(thresholdSource.map(x=>Math.abs(x.delta)),.6);
  const metrics={name:f.name,threshold_abs_calibrated:round(threshold,6),calibration_period:byPeriod.calibration.length>=60?'2019-2022':'2024 partial (CFTC only)',coverage_events:events.length,
   horizons:{}};
  for(const h of [1,3,5])metrics.horizons[h]=Object.fromEntries(periods.map(p=>[p.name,assess(byPeriod[p.name],h,threshold)]));
  metrics.correlation_check=Object.fromEntries(periods.map(p=>{const z=byPeriod[p.name];return [p.name,{lagged_factor_vs_PRIOR_gold5:round(corr(z.map(x=>x.delta*f.sign),z.map(x=>x.past_gold_5d_pct))),lagged_factor_vs_FUTURE_gold3:round(corr(z.filter(x=>x.fwd[3]!=null).map(x=>x.delta*f.sign),z.filter(x=>x.fwd[3]!=null).map(x=>x.fwd[3])))}]}));
  result.indicators[f.id]=metrics;
 }
 const gldByDate=new Map(etfprices.map((x,i)=>[x.date,i]));
 result.crosscheck_gld_stock_price={};
 for(const id of ['COT_OI','COT_NET','DXY','DFII10','THREEFYTP10','TGA','GLD_TONNES_DELTA','GOLD_MOM20']){
  const threshold=result.indicators[id].threshold_abs_calibrated;
  const ee=(eventsByFactor[id]||[]).filter(x=>x.date>='2025-01-01'&&gldByDate.has(x.date)).map(x=>{
   const i=gldByDate.get(x.date),fwd={};for(const h of [1,3,5])fwd[h]=etfprices[i+h]&&etfprices[i+1]?100*(etfprices[i+h].close/etfprices[i+1].open-1):null;
   return {...x,fwd,index:i};
  });
  result.crosscheck_gld_stock_price[id]={three_days:assess(ee,3,threshold),five_days:assess(ee,5,threshold)};
 }
 const oe=eventsByFactor.COT_OI||[];
 const oiCohorts={};for(const type of ['OI_UP_PRICE_UP','OI_UP_PRICE_DOWN','OI_DOWN_PRICE_UP','OI_DOWN_PRICE_DOWN']){
  const positiveOI=type.startsWith('OI_UP'),positivePrice=type.endsWith('PRICE_UP');
  const base=oe.filter(e=>e.date>='2025-01-01'&&(e.delta>0)===positiveOI&&(e.past_gold_5d_pct>0)===positivePrice);
  oiCohorts[type]={gold_3days_follow_PRICE_TREND:assess(base.map(e=>({...e,pred:sg(e.past_gold_5d_pct),delta:e.past_gold_5d_pct})),3,0),gold_3days_follow_OI_SIGN:assess(base,3,0)};
 }
 result.oi_price_four_quadrants=oiCohorts;
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-gold-leading-indicators-multiregime-latest.json',JSON.stringify(result,null,2));
 let rows=[['id','indicator','threshold','2019_2022_n','2019_2022_hit3d','2023_2024_n','2023_2024_hit3d','2025_2026_n','2025_2026_hit3d','2025_2026_PnL3d_pct','2025_2026_matched_long_PnL3d_pct','2025_2026_nonoverlap_n','2025_2026_nonoverlap_hit']];
 for(const [id,r] of Object.entries(result.indicators)){let m=r.horizons[3];rows.push([id,r.name,r.threshold_abs_calibrated,m.calibration.n,m.calibration.hit_pct,m.validation.n,m.validation.hit_pct,m.later_evaluation.n,m.later_evaluation.hit_pct,m.later_evaluation.avg_after_10bp_cost_pct,m.later_evaluation.same_days_always_long_net_pct,m.later_evaluation.nonoverlap_n,m.later_evaluation.nonoverlap_hit_pct])}
 const clean=x=>x==null?'':String(x).includes(',')?'"'+String(x).replace(/"/g,'""')+'"':String(x);
 fs.writeFileSync('reports/v22-gold-leading-indicators-multiregime-summary.csv',rows.map(r=>r.map(clean).join(',')).join('\n')+'\n');
 console.log(JSON.stringify({counts:result.raw_counts,cohorts:cohorts,indicators:Object.fromEntries(Object.entries(result.indicators).map(([k,v])=>[k,{threshold:v.threshold_abs_calibrated,cohorts:v.horizons[3]}]))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
