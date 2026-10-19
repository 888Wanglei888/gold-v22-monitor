// Gold Turtle S2 55/20 + 0.5N pyramid / macro 2026 research (fixed hypotheses).
// 2025 Yahoo GC=F 1h history warms up a NY 17:00 daily ATR/N; 2026 through 10/16,
// with original prior-closed-day 55 entry /20 exit levels. Source research only.
const fs=require('node:fs');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const {delta,sumWindow}=require('../lib/endpoints/v22-cross-market-core');
const ms=d=>Date.parse(d+'T00:00:00Z');
const DAY=86400000,round=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function session(t){const v=Object.fromEntries(ny.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const day=v.year+'-'+v.month+'-'+v.day;return Number(v.hour)>=17?new Date(ms(day)+DAY).toISOString().slice(0,10):day}
async function gold1h(){
 const start=Math.floor(ms('2025-01-01')/1000),end=Math.floor(ms('2026-10-19')/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1h&period1='+start+'&period2='+end;
 const r=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw Error('Gold 1h Yahoo HTTP '+r.status);
 const j=(await r.json()).chart?.result?.[0],quote=j?.indicators?.quote?.[0];if(!j?.timestamp||!quote)throw Error('No 1h gold');
 const seen=new Set(),out=[],bad={invalid:0,duplicate:0};
 j.timestamp.forEach((ts,i)=>{let t=ts*1000,o=quote.open[i],h=quote.high[i],l=quote.low[i],c=quote.close[i];
 if(t>=ms('2026-10-17')||t<ms('2025-01-01'))return;
 if(seen.has(t)){bad.duplicate++;return;}seen.add(t);
 if(![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||h<Math.max(o,c)||l>Math.min(o,c)){bad.invalid++;return}
 out.push({t,o,h,l,c,s:session(t)});
 });
 out.sort((a,b)=>a.t-b.t);
 return {bars:out,bad,first:new Date(out[0].t).toISOString(),last:new Date(out.at(-1).t).toISOString()};
}
function dailyLevels(bars){
 let days=[],map=new Map();
 for(let b of bars){let d=map.get(b.s);
  if(!d){d={date:b.s,open:b.o,high:b.h,low:b.l,close:b.c,bars:0};map.set(b.s,d);days.push(d)}
  d.high=Math.max(d.high,b.h);d.low=Math.min(d.low,b.l);d.close=b.c;d.bars++;
 }
 days.sort((a,b)=>a.date.localeCompare(b.date));
 for(let i=0;i<days.length;i++){const d=days[i],prior=days[i-1];const tr=prior?Math.max(d.high-d.low,Math.abs(d.high-prior.close),Math.abs(d.low-prior.close)):d.high-d.low;
  if(i===19)d.n=days.slice(0,19).reduce((s,x)=>s+x.tr,0)/20+tr/20;
  else if(i>19)d.n=(days[i-1].n*19+tr)/20;
  d.tr=tr;
 }
 const levels=new Map();for(let i=55;i<days.length;i++){
  const prev=days.slice(i-55,i),last=days[i-1];
  levels.set(days[i].date,{n:last.n,prev:last.date,hi55:Math.max(...prev.map(x=>x.high)),lo55:Math.min(...prev.map(x=>x.low)),
   lo20:Math.min(...prev.slice(-20).map(x=>x.low)),hi20:Math.max(...prev.slice(-20).map(x=>x.high))});
 }
 return {days,levels};
}
function fundamentals(loaded,at,side){
 const src=loaded.sources,max=loaded.maxAgeDays;
 const real=delta(src,'DFII10',at,7,max),dxy=delta(src,'DXY',at,7,max),
  tga=delta(src,'TGA',at,7,max),gld=sumWindow(src,'GLD_TONNES_DELTA',at,7),
  cot=delta(src,'COT_NET',at,28,max);
 const sign=(x,s)=>!Number.isFinite(x)?0:x===0?0:(s*x>0?1:-1);
 const vote={real:sign(real,-side),dxy:sign(dxy,-side),tga:sign(tga,-side),gld:sign(gld,side)};
 const macro=[vote.real,vote.dxy],flow=[vote.tga,vote.gld];
 const macroAdv=macro.filter(x=>x===1).length,flowAdv=flow.filter(x=>x===1).length,
 macroAgainst=macro.filter(x=>x===-1).length,flowAgainst=flow.filter(x=>x===-1).length;
 return {values:{real,dxy,tga,gld,cot},vote,macroAdv,flowAdv,macroAgainst,flowAgainst,
  crossAdverse:macroAgainst>=1&&flowAgainst>=1,confirm:macroAdv>=1&&flowAdv>=1,
  observations:Object.values(vote).filter(x=>x!==0).length};
}
const specs={
 pure:{name:'A_纯55日海龟'},
 veto:{name:'B_基本面跨类别反对则不入场'},
 risk:{name:'C_基本面不利时半仓'},
 add:{name:'D_基本面支持时才能加仓'},
 combined:{name:'E_不利半仓且加仓需基本面支持'}
};
function simulate(bars,levels,loaded,kind,from,to,{initial=10000,forceClose=true,notionalLimit=5,perOzSlip=.2,roundtripBps=10}={}){
 const first=bars.findIndex(x=>x.s>=from),last=bars.findLastIndex(x=>x.s<=to);
 if(first<0||last<=first)throw Error('Bad period '+from);
 const slices=bars.slice(first,last+1),fcache=new Map(),events=[],trades=[],snapshots=[],month={};
 let cash=initial,pos=null,peak=initial,dd=0,closed=0,entries=0,adds=0,entryBlocked=0,addBlocked=0,adverseFlags=0,noData=0;
 const slippage=perOzSlip, fee=roundtripBps/20000; // each side of full roundtrip
 const macro=(b,side)=>{let key=b.s+':'+side;let v=fcache.get(key);
   if(!v){v=fundamentals(loaded,b.t,side);fcache.set(key,v)}return v};
 function eq(b){const mid=b.c;return cash+(pos?pos.legs.reduce((s,u)=>s+u.side*u.qty*(mid-u.entry)-u.qty*mid*fee,0):0)}
 function mark(b){const e=eq(b);peak=Math.max(peak,e);dd=Math.max(dd,100*(1-e/peak));
  if(b.s>='2026-01-01'){snapshots.push({session:b.s,time:new Date(b.t).toISOString(),equity:e,position:pos?.side||0});
    const m=b.s.slice(0,7);if(!month[m])month[m]={first:e,last:e,peak:e,trough:e};
    const z=month[m];z.last=e;z.peak=Math.max(z.peak,e);z.trough=Math.min(z.trough,e);}}
 function close(b,px,reason){
  if(!pos)return;const p=pos,closePx=px-p.side*slippage,allQty=p.legs.reduce((s,u)=>s+u.qty,0);
  let sum=0;
  for(const u of p.legs){const profit=u.side*u.qty*(closePx-u.entry)-u.qty*closePx*fee;cash+=profit;sum+=profit}
  trades.push({entry:p.entry_time,exit:new Date(b.t).toISOString(),entry_session:p.entry_session,exit_session:b.s,
   side:p.side,units:p.legs.length,adds:p.adds,exit_reason:reason,pnl_usd:round(sum,2),
   final_equity_usd:round(cash,2),entry_quote:p.firstEntry,exit_quote:round(closePx,2)});
  events.push({kind:'exit',time:new Date(b.t).toISOString(),reason,side:p.side,qty:round(allQty,4),pnl:round(sum,2)});
  closed++;pos=null;
 }
 function newUnit(b,side,level,n,m,reason,half){
  const at=side===1?Math.max(b.o,level)+slippage:Math.min(b.o,level)-slippage;
  const e=Math.max(1,eq(b)),qtyByRisk=initial*.01*(half?.5:1)/n;
  const currentNotional=pos?pos.legs.reduce((s,u)=>s+u.qty*at,0):0;
  const maxQty=Math.max(0,(e*notionalLimit-currentNotional)/at);
  const qty=Math.min(qtyByRisk,maxQty);
  if(!(qty>0)){return false}
  if(pos)for(const u of pos.legs)u.stop+=side*.5*n;
  else pos={side,legs:[],entry_time:new Date(b.t).toISOString(),entry_session:b.s,firstEntry:round(at,2),adds:0};
  const u={side,entry:at,n,stop:at-side*2*n,qty};
  cash-=qty*at*fee;
  pos.legs.push(u);if(reason==='add')pos.adds++;
  pos.nextAdd=at+side*.5*n;
  if(reason==='entry')entries++;else adds++;
  events.push({kind:reason,time:new Date(b.t).toISOString(),side,entry:round(at,2),stop:round(u.stop,2),qty:round(qty,4),
    units:pos.legs.length,macro:{votes:m.vote,confirm:m.confirm,adverse:m.crossAdverse}});
  return true;
 }
 for(let i=first;i<=last;i++){
  const b=bars[i],l=levels.get(b.s);
  if(!l){mark(b);continue}
  // Closed session pricing and N known before every bar in that session.
  if(!(l.prev<b.s&&Number.isFinite(l.n)))throw Error('Lookahead N '+b.s);
  let exitedThisBar=false;
  if(pos){
   const s=pos.side;
   const stops=pos.legs.map(u=>u.stop);
   const protective=s===1?Math.max(...stops):Math.min(...stops);
   const trail=s===1?l.lo20:l.hi20;
   // Two competing exits: first price crossing on downside/upside, worst same-hour
   // ambiguous intra-hour rebounds are not resolvable with OHLC.
   const boundary=s===1?Math.max(protective,trail):Math.min(protective,trail);
   const hit=s===1?b.l<=boundary:b.h>=boundary;
   if(hit){const quote=s===1?Math.min(b.o,boundary):Math.max(b.o,boundary);
    close(b,quote,(s===1?trail>=protective:trail<=protective)?'20_day_channel':'unit_2N_protective');exitedThisBar=true;}
  }
  if(!pos&&!exitedThisBar){
   const hitL=b.h>=l.hi55,hitS=b.l<=l.lo55;
   if(hitL!==hitS&&(hitL||hitS)){
    const side=hitL?1:-1,m=macro(b,side);
    if(m.crossAdverse)adverseFlags++;
    if(m.observations<2)noData++;
    if(kind==='veto'&&m.crossAdverse){entryBlocked++;events.push({kind:'entry_veto',time:new Date(b.t).toISOString(),side,macro:m.vote});}
    else{
      const half=(kind==='risk'||kind==='combined')&&m.crossAdverse;
      newUnit(b,side,side===1?l.hi55:l.lo55,l.n,m,'entry',half);
      // If entry bar has also touched initial stop, assume adverse path first.
      if(pos&&pos.legs.some(u=>u.side===1?b.l<=u.stop:b.h>=u.stop)){
       const stops=pos.legs.map(u=>u.stop),stop=side===1?Math.max(...stops):Math.min(...stops);
       close(b,stop,'entry_hour_ambiguous_stop');exitedThisBar=true;
      }
    }
   }
  }
  // Pyramid at next 0.5N threshold; use prior closed day's ATR.
  if(pos&&!exitedThisBar){
   let step=0;
   while(pos&&pos.legs.length<4&&step<3){
    const side=pos.side,next=pos.nextAdd,hit=side===1?b.h>=next:b.l<=next;
    if(!hit)break;
    const m=macro(b,side);
    if((kind==='add'||kind==='combined')&&!m.confirm){addBlocked++;break}
    const half=(kind==='risk'||kind==='combined')&&m.crossAdverse;
    if(!newUnit(b,side,next,l.n,m,'add',half)){addBlocked++;break}
    step++;
    const stopped=pos.legs.some(u=>u.side===1?b.l<=u.stop:b.h>=u.stop);
    if(stopped){const stops=pos.legs.map(u=>u.stop),stop=side===1?Math.max(...stops):Math.min(...stops);
      close(b,stop,'add_hour_ambiguous_stop');exitedThisBar=true}
   }
  }
  mark(b);
 }
 const lastBar=bars[last],endEquity=eq(lastBar);
 if(forceClose&&pos){close(lastBar,lastBar.c,'forced_study_end');snapshots[snapshots.length-1].equity=cash}
 const wins=trades.filter(x=>x.pnl_usd>0),loss=trades.filter(x=>x.pnl_usd<0),
   grossWins=wins.reduce((s,x)=>s+x.pnl_usd,0),grossLoss=-loss.reduce((s,x)=>s+x.pnl_usd,0);
 const first2026=snapshots.find(x=>x.session.startsWith('2026'));
 const priorBar=bars.slice(0,first).length?null:null;
 return {kind,from,to,final_usd:round(forceClose?cash:endEquity,2),return_pct:round(100*((forceClose?cash:endEquity)/initial-1),2),
  max_drawdown_pct:round(dd,2),n_trades:trades.length,n_winners:wins.length,
  hit_pct:trades.length?round(100*wins.length/trades.length,1):null,
  gross_profit:round(grossWins,2),gross_loss:round(grossLoss,2),profit_factor:grossLoss>0?round(grossWins/grossLoss):null,
  entries,adds,entryBlocked,addBlocked,adverseFlags,noData,
  trades,events,month,snapshots,starts_2026:round(first2026?.equity,2)};
}
async function main(){
 const [gold,features]=await Promise.all([gold1h(),loadResearchInputs()]);
 const {days,levels}=dailyLevels(gold.bars);
 if(gold.bars.length<9500)throw Error('Insufficient 2025/26 hourly GC candles');
 const closed2026=days.filter(x=>x.date>='2026-01-01'&&x.date<='2026-10-16').length;
 const configs={};
 for(const policy of Object.keys(specs)){
  configs[policy]={
    flat2026:simulate(gold.bars,levels,features,policy,'2026-01-01','2026-10-16'),
    continuous2025_to2026:simulate(gold.bars,levels,features,policy,'2025-04-01','2026-10-16')};
 }
 // Mark-to-market performance for 2026 within continuous 2025-open portfolio using
 // final mark of 2025 and latest of 2026. Same invested 2025 start across policies.
 for(const [p,v] of Object.entries(configs)){
  const s=v.continuous2025_to2026.snapshots,bar2025=s.filter(x=>x.session<='2025-12-31').at(-1),
   bar2026=s.filter(x=>x.session<='2026-10-16').at(-1);
  v.continuous2025_to2026.prior_year_end_equity=round(bar2025?.equity,2);
  v.continuous2025_to2026.year2026_return_pct=bar2025?round(100*(bar2026.equity/bar2025.equity-1),2):null;
 }
 const result={run_utc:new Date().toISOString(),
  status:'exploratory_2026_macro_turtle_55_day_hourly_proxy_not_verified_original_turtle_or_V22',
  data:{gold_source:'Yahoo GC=F hourly continuous nearest futures, USD/oz',hour_bars:gold.bars.length,first:gold.first,last:gold.last,
  price_bad:gold.bad,ny17_session_days_2026:closed2026,
  fundamental_sources:Object.fromEntries(['DFII10','DXY','TGA','GLD_TONNES_DELTA','COT_NET'].map(id=>[id,features.coverage[id]])),
  source_errors:features.source_errors},
  fixed_design:{
   basis:'55 completed NY17 FX-style sessions high-low gold futures channel; 20 completed sessions exit, ATR20 Wilder from completed daily sessions',
   entry:'first hourly OHLC that touches 55 day breakout; one open position, no S1 previous signal filter',
   stops:'2N initial per unit, old stops moved 0.5N per add, 0.5N pyramid up to total 4',
   capital:'$10k synthetic divisible ounces, 1N movement is 1% initial assigned account capital, aggregate max 5x exposure',
   execution:'Yahoo 1h GC=F OHLC has no bid/ask; roundtrip 10bps + $0.20/oz per side; same-hour stop first if ambiguity',
   asof:'at entry/add quote hour only, FRED real yield lag3 calendar days, DXY lag2, TGA official lag3, GLD official ounces lag3, data latest vintage; historical publication dates and exceptions not guaranteed',
   macro:'7 calendar days changes of 10Y real yields and DXY (inverse) plus TGA (inverse) and GLD physical holdings (same-direction); if TGA decreases is treated as a crude pro-gold liquidity proxy; CFTC 28 day delta only diagnostics',
   macro_cross_adverse:'one or more opposing monetary indicators AND one or more opposing flow indicators',
   macro_confirm_to_add:'one or more supporting monetary indicator AND one or more supporting flow indicator',
   variants:specs,
   no_optimizer:true,parameters_fixed_before_running:true,
   extreme_cautions:['2026 GC=F continuous futures include contract roll gaps; no actual CME contract-level orderbook or true intrabar path','ATR/session adapted for NY17; CME GC actual settlement and close may differ','CFTC is weekly with reporting delay, GLD tonnage is not fund dollar flow','Latest FRED/DTS vintages are not certified original-release databases','End-of-study forced close 2026-10-16 (not original turtle exit)','2019-2025 macro regimes already studied in same research project; 2026 is not absolutely pristine holdout','Exact 2026 5m quotes unavailable; hourly is not 5min','Original Turtle single-market cash account size and weekly N table not fully replicated']},
  results:configs
 };
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_TURTLE_2026_MACRO_HOURLY_REPLAY.json',JSON.stringify(result,null,2));
 const header=['rule','mode','trade_count','wins','hit_pct','adds','entry_blocked','add_blocked','ending_usd','return_pct','2026_return_pct_continuous','maxdd_pct','profit_factor','cross_adverse_count'];
 const csv=[header.join(',')];
 for(const [k,v] of Object.entries(configs))for(const [n,x] of Object.entries(v)){
  csv.push([k,n,x.n_trades,x.n_winners,x.hit_pct,x.adds,x.entryBlocked,x.addBlocked,x.final_usd,x.return_pct,x.year2026_return_pct??'',x.max_drawdown_pct,x.profit_factor,x.adverseFlags].join(','))}
 fs.writeFileSync('research-data/GOLD_TURTLE_2026_MACRO_HOURLY_SUMMARY.csv',csv.join('\n')+'\n');
 const led=['rule,mode,entry,exit,side,units,adds,pnl_usd,final_usd,reason'];
 for(const [k,v] of Object.entries(configs))for(const [mode,x] of Object.entries(v))for(const t of x.trades)
  led.push([k,mode,t.entry,t.exit,t.side,t.units,t.adds,t.pnl_usd,t.final_equity_usd,t.exit_reason].join(','));
 fs.writeFileSync('research-data/GOLD_TURTLE_2026_MACRO_HOURLY_TRADES.csv',led.join('\n')+'\n');
 console.log('COVERAGE',JSON.stringify(result.data));
 for(const [k,v] of Object.entries(configs))for(const [mode,x] of Object.entries(v))console.log('RESULT',k,mode,JSON.stringify(Object.fromEntries(Object.entries(x).filter(([a])=>!['trades','events','snapshots','month'].includes(a)))),'TRADES',JSON.stringify(x.trades));
}
main().catch(e=>{console.error('FATAL',e.stack||String(e));process.exitCode=1});
