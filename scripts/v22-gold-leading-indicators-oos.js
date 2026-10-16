// Research-only, no live trading signals. Historical data is as-of lagged but not revision-vintage certified.
const fs=require('node:fs');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const {buildAsOf,atOrBefore,DAY}=require('../lib/endpoints/v22-asof-core');
const round=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const quant=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.floor((s.length-1)*p)]};
const sign=x=>x>0?1:x<0?-1:0;
async function fred(id){
 const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd=2024-01-01';
 const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw Error(id+' HTTP '+r.status);
 const lines=(await r.text()).trim().split(/\r?\n/);
 if(!lines[0].includes(id))throw Error('Bad '+id+' header');
 return lines.slice(1).map(line=>line.replaceAll('"','').trim().split(',')).filter(x=>x.length>=2&&x[1]!=='.'&&x[1]!==''&&Number.isFinite(+x[1])).map(x=>({date:x[0],value:+x[1]}));
}
function snap(src,t,ageDays){const rows=src?.rows||[],x=atOrBefore(rows,t);return x&&t-Date.parse(x.date+'T00:00:00Z')<=(ageDays*DAY)?x:null}
function trailing(src,t,n,ageDays,mode='delta'){
 const x=snap(src,t,ageDays);if(!x)return null;
 const arr=src.rows||[];let lo=0,hi=arr.length;
 while(lo<hi){let m=(lo+hi)>>1;if(arr[m].available_utc_ms<=t)lo=m+1;else hi=m}
 const last=lo-1;if(last<0)return null;
 if(mode==='sum'){if(last+1<n)return null;return arr.slice(last-n+1,last+1).reduce((s,x)=>s+x.value,0)}
 if(last<n)return null;
 return arr[last].value-arr[last-n].value;
}
function sd(values){if(values.length<3)return null;const m=mean(values),v=mean(values.map(x=>(x-m)**2));return Math.sqrt(v)}
function makeDays(candles){
 const groups=new Map();
 for(const c of candles){if(!groups.has(c.session_date))groups.set(c.session_date,[]);groups.get(c.session_date).push(c)}
 return [...groups].map(([date,bars])=>{bars.sort((a,b)=>a.start_ms-b.start_ms);return {date,close_ms:bars.at(-1).close_ms,open:bars[0].open,close:bars.at(-1).close,bars:bars.length,slots:bars.map(x=>x.slot)};})
 .filter(x=>x.bars>=4).sort((a,b)=>a.date.localeCompare(b.date));
}
const factors=[
 {id:'DXY',name:'美元指数 DXY（5次公布）',direction:-1,lookback:5,age:7},
 {id:'DFII10',name:'10年实际利率（5次公布）',direction:-1,lookback:5,age:8},
 {id:'DGS2',name:'2年美债利率（5次公布）',direction:-1,lookback:5,age:8},
 {id:'DGS10',name:'10年名义收益率（5次公布）',direction:-1,lookback:5,age:8},
 {id:'T10YIE',name:'10年通胀补偿（5次公布）',direction:1,lookback:5,age:8},
 {id:'THREEFYTP10',name:'10年期限溢价（5次公布，信用折价假说）',direction:1,lookback:5,age:8},
 {id:'GLD_TONNES_DELTA',name:'GLD ETF 持仓净变化（5次公布）',direction:1,lookback:5,age:9,mode:'sum'},
 {id:'COT_NET',name:'CFTC 管理资金净多（4周）',direction:1,lookback:4,age:30},
 {id:'COT_OI',name:'CFTC 黄金持仓总量（4周）',direction:1,lookback:4,age:30},
 {id:'WRESBAL',name:'银行准备金（4周）',direction:1,lookback:4,age:24},
 {id:'TGA',name:'财政部TGA余额（5次公布）',direction:-1,lookback:5,age:9},
 {id:'RRPONTSYD',name:'ON RRP余额（5次公布）',direction:-1,lookback:5,age:8},
 {id:'VIXCLS',name:'VIX恐慌指数（5次公布，避险假说）',direction:1,lookback:5,age:8},
 {id:'SOFR_IORB',name:'SOFR-IORB利差（7天变化）',direction:-1,age:8},
 {id:'GOLD_MOM5',name:'黄金自身5日动量',direction:1,lookback:5,age:0},
 {id:'GOLD_MOM20',name:'黄金自身20日动量',direction:1,lookback:20,age:0}
];
function evaluate(events,h,threshold){
 const sub=events.filter(x=>x.fwd[h]!=null&&Math.abs(x.delta)>=threshold&&sign(x.delta)!==0);
 const longs=sub.filter(x=>x.pred===1),shorts=sub.filter(x=>x.pred===-1);
 const pnl=sub.map(x=>x.pred*x.fwd[h]-0.1),longPnl=sub.map(x=>x.fwd[h]-0.1);
 return {n:sub.length,longs:longs.length,shorts:shorts.length,hit_pct:sub.length?round(100*sub.filter(x=>x.pred*x.fwd[h]>0).length/sub.length,1):null,
  mean_signed_return_pct:round(mean(sub.map(x=>x.pred*x.fwd[h])),3),
  mean_after_cost_pct:round(mean(pnl),3),
  same_events_always_long_hit_pct:sub.length?round(100*sub.filter(x=>x.fwd[h]>0).length/sub.length,1):null,
  same_events_always_long_after_cost_pct:round(mean(longPnl),3),
  excess_over_long_pct:round(mean(pnl)-mean(longPnl),3),
  correlation_of_signal_with_forward_return:sub.length>15?round(pearson(sub.map(x=>x.delta),sub.map(x=>x.fwd[h])),3):null,
  nonoverlap_every_h_event:nonoverlap(sub,h)};
}
function nonoverlap(events,h){
 const selected=[];let last=-Infinity;
 for(const x of events){if(x.day_idx-last>=h){selected.push(x);last=x.day_idx}}
 return {n:selected.length,hit_pct:selected.length?round(100*selected.filter(x=>x.pred*x.fwd[h]>0).length/selected.length,1):null,mean_after_cost_pct:round(mean(selected.map(x=>x.pred*x.fwd[h]-0.1)),3)};
}
function pearson(a,b){let ma=mean(a),mb=mean(b),z=0,x=0,y=0;for(let i=0;i<a.length;i++){let da=a[i]-ma,db=b[i]-mb;z+=da*db;x+=da*da;y+=db*db}return x>0&&y>0?z/Math.sqrt(x*y):null}
async function main(){
 const src=await loadResearchInputs(),extra=await Promise.allSettled(['DGS2','THREEFYTP10','VIXCLS'].map(fred));
 const xids=['DGS2','THREEFYTP10','VIXCLS'],errors={...src.source_errors};
 for(let i=0;i<xids.length;i++)if(extra[i].status==='fulfilled')src.sources[xids[i]]=buildAsOf(extra[i].value,3);else errors[xids[i]]=String(extra[i].reason);
 const days=makeDays(src.gold),trainStart='2025-06-02',trainEnd='2025-12-31',testStart='2026-01-01';
 if(days.length<260)throw Error('Incomplete gold daily data '+days.length);
 const observations={};
 for(const f of factors){
  const ev=[];
  for(let i=20;i<days.length-5;i++){
   const day=days[i],t=day.close_ms;
   if(day.date<trainStart)continue;
   let delta=null;
   if(f.id.startsWith('GOLD_MOM'))delta=100*(day.close/days[i-f.lookback].close-1);
   else if(f.id==='SOFR_IORB'){
    const curS=snap(src.sources.SOFR,t,8),curI=snap(src.sources.IORB,t,8);
    const priorS=snap(src.sources.SOFR,t-7*DAY,15),priorI=snap(src.sources.IORB,t-7*DAY,15);
    if(curS&&curI&&priorS&&priorI)delta=(curS.value-curI.value)-(priorS.value-priorI.value);
   } else delta=trailing(src.sources[f.id],t,f.lookback,f.age,f.mode);
   if(!Number.isFinite(delta))continue;
   const fwd={};for(const h of [1,3,5]){
    // The signal is only calculated at the completed daily close. Enter at NEXT daily session OPEN.
    // Exit at the close of the h-th subsequent NY gold session. Excludes undefined/gappy starts.
    if(days[i+h]&&days[i+1])fwd[h]=round(100*(days[i+h].close/days[i+1].open-1),6);
   }
   ev.push({date:day.date,day_idx:i,delta,pred:sign(delta)*f.direction,fwd});
  }
  const train=ev.filter(x=>x.date<=trainEnd),test=ev.filter(x=>x.date>=testStart);
  const threshold=quant(train.map(x=>Math.abs(x.delta)).filter(x=>x>0),.6);
  const stats={id:f.id,name:f.name,direction_hypothesis:f.direction,observed_train_days:train.length,observed_holdout_days:test.length,
   threshold_abs_change_2025:round(threshold,6),forward_horizons:{}};
  for(const h of [1,3,5])stats.forward_horizons[h]={train_2025:evaluate(train,h,threshold),holdout_2026:evaluate(test,h,threshold)};
  observations[f.id]={stats,events:ev};
 }
 const combined={};
 const byFactor=observations,keys=['DXY','DFII10','DGS2','THREEFYTP10','GLD_TONNES_DELTA','TGA'];
 for(const type of ['DXY_REAL_AGREE','DXY_REAL_TERM_PREMIUM_RISE','REAL_DOWN_GLD_UP','DXY_REAL_GOLD_MOMENTUM']){
  const map=new Map();
  for(const id of keys.concat(['GOLD_MOM5']))for(const e of byFactor[id]?.events||[]){let row=map.get(e.date)||{};row[id]=e;map.set(e.date,row)}
  const ev=[];
  for(const [date,r] of map){
   const dx=r.DXY,real=r.DFII10,term=r.THREEFYTP10,etf=r.GLD_TONNES_DELTA,mom=r.GOLD_MOM5;
   if(!dx||!real||dx.pred===0||real.pred===0)continue;
   let pred=0;
   if(type==='DXY_REAL_AGREE'&&dx.pred===real.pred)pred=dx.pred;
   if(type==='DXY_REAL_TERM_PREMIUM_RISE'&&dx.pred===1&&real.pred===1&&term&&term.delta>0)pred=1;
   if(type==='REAL_DOWN_GLD_UP'&&real.pred===1&&etf&&etf.delta>0)pred=1;
   if(type==='DXY_REAL_GOLD_MOMENTUM'&&dx.pred===real.pred&&mom&&mom.pred===dx.pred)pred=dx.pred;
   if(pred===0)continue;
   ev.push({date,day_idx:dx.day_idx,delta:pred,pred,fwd:dx.fwd});
  }
  ev.sort((a,b)=>a.date.localeCompare(b.date));
  const train=ev.filter(e=>e.date<=trainEnd),test=ev.filter(e=>e.date>=testStart);
  combined[type]={train_events:train.length,holdout_events:test.length,forward_horizons:Object.fromEntries([1,3,5].map(h=>[h,{train:evaluate(train,h,0),holdout:evaluate(test,h,0)}]))};
 }
 const output={created_utc:new Date().toISOString(),status:'research_only_leading_factor_oos_test',
  gold_source:'Yahoo GC=F 1h -> New York-session 4h -> complete daily aggregates, fractional execution proxy',
  experiment:{training_period:'2025-06-02 to 2025-12-31',holdout_period:'2026-01-01 to last complete session',strict_prior_feature_lag:true,
   signal_time:'LAST completed 4h gold bar of the daily NY session; all macro features lagged and observed before signal',
   entry:'NEXT NY trading session first available 4h open',exit:'close of 1st/3rd/5th trading session after signal',
   filter:'absolute factor change above TRAIN-ONLY 60th percentile nonzero observed changes; direction hypothesis fixed ex ante',
   execution_cost_pct_roundtrip:0.1,trade_events_overlap:true,overlap_sensitivity_included:true,nontrading_hypothesis_study:true,
   these_are_not_original_V22_trade_results:true},
  coverage:{gold_4h_candles:src.gold.length,usable_gold_sessions:days.length,first_date:days[0].date,last_date:days.at(-1).date,
   missing_sources:errors,extra_series:xids.filter(id=>src.sources[id]?.rows?.length).map(id=>({id,observations:src.sources[id].rows.length})),
   source_history_not_revision_vintage_certified:true},
  results:Object.fromEntries(Object.values(observations).map(x=>[x.stats.id,x.stats])),combinations:combined};
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/v22-gold-leading-indicators-oos-latest.json',JSON.stringify(output,null,2));
 const headers=['id','indicator','train_events','holdout_events','threshold_abs_2025','train_3d_n','train_3d_hit_pct','train_3d_net_pct','holdout_1d_n','holdout_1d_hit_pct','holdout_1d_net_pct','holdout_3d_n','holdout_3d_hit_pct','holdout_3d_net_pct','holdout_3d_same_event_long_pct','holdout_3d_excess_vs_long_pct','holdout_5d_n','holdout_5d_hit_pct','holdout_5d_net_pct','holdout_5d_nonoverlap_n','holdout_5d_nonoverlap_hit_pct'];
 const rows=Object.values(observations).map(x=>{const s=x.stats,a=s.forward_horizons;return [s.id,s.name,s.observed_train_days,s.observed_holdout_days,s.threshold_abs_change_2025,a[3].train_2025.n,a[3].train_2025.hit_pct,a[3].train_2025.mean_after_cost_pct,a[1].holdout_2026.n,a[1].holdout_2026.hit_pct,a[1].holdout_2026.mean_after_cost_pct,a[3].holdout_2026.n,a[3].holdout_2026.hit_pct,a[3].holdout_2026.mean_after_cost_pct,a[3].holdout_2026.same_events_always_long_after_cost_pct,a[3].holdout_2026.excess_over_long_pct,a[5].holdout_2026.n,a[5].holdout_2026.hit_pct,a[5].holdout_2026.mean_after_cost_pct,a[5].holdout_2026.nonoverlap_every_h_event.n,a[5].holdout_2026.nonoverlap_every_h_event.hit_pct]});
 const escape=v=>v==null?'':/[,\"\n]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
 fs.writeFileSync('reports/v22-gold-leading-indicators-oos-summary.csv',[headers.join(','),...rows.map(row=>row.map(escape).join(','))].join('\n')+'\n');
 console.log(JSON.stringify({status:output.status,coverage:output.coverage,results:Object.fromEntries(Object.entries(output.results).map(([id,r])=>[id,{train:r.observed_train_days,test:r.observed_holdout_days,holdout_1d:r.forward_horizons[1].holdout_2026,holdout_3d:r.forward_horizons[3].holdout_2026,holdout_5d:r.forward_horizons[5].holdout_2026}])),combinations:combined},null,2));
}
main().catch(e=>{console.error('RESEARCH_FAILED',e);process.exitCode=1});
