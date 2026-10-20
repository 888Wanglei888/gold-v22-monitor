// 2026 gold S2: original maximum-4 pyramids vs more than 4 units; backtest research.
// All scenarios share SAME Yahoo GC=F hourly candles, 55/20 day signal, Wilder N, 2N protective unit stops and 0.5N add spacing.
// Legacy 2026 mixed-macro source is reused purely to match prior pure Turtle simulator; MACRO FACTORS ARE OFF.
// Formal audit caveats: continuous contract rolls, 1h OHLC ambiguity, no bid-ask or COMEX contract-size execution.
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
function simulate(bars,levels,loaded,kind,from,to,{initial=10000,forceClose=true,notionalLimit=5,unitLimit=4,perOzSlip=.2,roundtripBps=10}={}){
 const first=bars.findIndex(x=>x.s>=from),last=bars.findLastIndex(x=>x.s<=to);
 if(first<0||last<=first)throw Error('Bad period '+from);
 const slices=bars.slice(first,last+1),fcache=new Map(),events=[],trades=[],snapshots=[],month={};
 let cash=initial,pos=null,peak=initial,dd=0,closed=0,entries=0,adds=0,entryBlocked=0,addBlocked=0,adverseFlags=0,noData=0,maxLeverage=0,maxUnitsHeld=0,blockedByLeverage=0,unitAddAttempts=0;
 const slippage=perOzSlip, fee=roundtripBps/20000; // each side of full roundtrip
 const macro=(b,side)=>({vote:{},crossAdverse:false,confirm:true,observations:4}); // all variants PURE Turtle
 function eqAt(mid){return cash+(pos?pos.legs.reduce((s,u)=>s+u.side*u.qty*(mid-u.entry)-u.qty*mid*fee,0):0)}
 function eq(b){return eqAt(b.c)}
 function currentLeverage(b){const equity=eq(b),gross=pos?pos.legs.reduce((s,u)=>s+u.qty*b.c,0):0;return equity>0?gross/equity:Infinity;}
 function mark(b){const e=eq(b);peak=Math.max(peak,e);dd=Math.max(dd,100*(1-e/peak));maxLeverage=Math.max(maxLeverage,currentLeverage(b));maxUnitsHeld=Math.max(maxUnitsHeld,pos?.legs.length||0);
  snapshots.push({session:b.s,time:new Date(b.t).toISOString(),equity:e,position:pos?.side||0});
  if(b.s>='2026-01-01'){
    const m=b.s.slice(0,7);if(!month[m])month[m]={first:e,last:e,peak:e,trough:e};
    const z=month[m];z.last=e;z.peak=Math.max(z.peak,e);z.trough=Math.min(z.trough,e);}
 }
 // Each unit has a separate 2N stop; shared 20-day exit applies to all.
 function closeSelected(b,items){
  if(!pos||!items.length)return;
  const p=pos;
  for(const item of items){
   const u=item.leg,px=item.quote-u.side*slippage;
   const exitFee=u.qty*px*fee,profit=u.side*u.qty*(px-u.entry)-exitFee;
   cash+=profit;p.realizedPnl+=profit;
   p.exits.push({time:new Date(b.t).toISOString(),reason:item.reason,price:round(px,2),pnl_usd:round(profit,2)});
   p.legs.splice(p.legs.indexOf(u),1);
   events.push({kind:'unit_exit',time:new Date(b.t).toISOString(),reason:item.reason,side:u.side,qty:round(u.qty,4),pnl:round(profit,2)});
  }
  if(p.legs.length===0){
   trades.push({entry:p.entry_time,exit:new Date(b.t).toISOString(),entry_session:p.entry_session,exit_session:b.s,
    side:p.side,units:p.totalUnits,adds:p.adds,exit_reason:items.at(-1).reason,pnl_usd:round(p.realizedPnl-p.entryFees,2),
    final_equity_usd:round(cash,2),entry_quote:p.firstEntry,exit_quote:p.exits.at(-1).price,unit_exits:p.exits});
   closed++;pos=null;
  }
 }
 function close(b,px,reason){if(pos)closeSelected(b,pos.legs.map(leg=>({leg,quote:px,reason})));}
 function newUnit(b,side,level,n,m,reason,half){
  const at=side===1?Math.max(b.o,level)+slippage:Math.min(b.o,level)-slippage;
  const e=eqAt(b.o),qtyByRisk=initial*.01*(half?.5:1)/n; // size uses OPEN, never hour CLOSE
  if(e<=0||!(n>0))return false;
  const currentNotional=pos?pos.legs.reduce((s,u)=>s+u.qty*at,0):0;
  const maxQty=Math.max(0,(e*notionalLimit-currentNotional)/at);
  const qty=Math.min(qtyByRisk,maxQty);
  if(!(qty>1e-8)){blockedByLeverage++;return false}
  if(reason==='add'&&pos&&pos.totalUnits>=unitLimit)return false;
  if(pos)for(const u of pos.legs)u.stop+=side*.5*n;
  else pos={side,legs:[],entry_time:new Date(b.t).toISOString(),entry_session:b.s,firstEntry:round(at,2),adds:0,totalUnits:0,realizedPnl:0,entryFees:0,exits:[]};
  const u={side,entry:at,n,stop:at-side*2*n,qty};
  const entryFee=qty*at*fee;
  cash-=entryFee;pos.entryFees+=entryFee;
  pos.legs.push(u);pos.totalUnits++;if(reason==='add')pos.adds++;
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
   const side=pos.side,trail=side===1?l.lo20:l.hi20;
   const exiting=[];
   for(const leg of [...pos.legs]){
    const boundary=side===1?Math.max(leg.stop,trail):Math.min(leg.stop,trail);
    const hit=side===1?b.l<=boundary:b.h>=boundary;
    if(!hit)continue;
    exiting.push({leg,quote:side===1?Math.min(b.o,boundary):Math.max(b.o,boundary),
     reason:(side===1?trail>=leg.stop:trail<=leg.stop)?'20_day_channel':'unit_2N_protective'});
   }
   if(exiting.length){closeSelected(b,exiting);exitedThisBar=true;}
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
   while(pos&&pos.totalUnits<unitLimit&&step<150){
    const side=pos.side,next=pos.nextAdd,hit=side===1?b.h>=next:b.l<=next;
    if(!hit)break;
    const m=macro(b,side);
    if((kind==='add'||kind==='combined')&&!m.confirm){addBlocked++;break}
    const half=(kind==='risk'||kind==='combined')&&m.crossAdverse;
    unitAddAttempts++;
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
  entries,adds,entryBlocked,addBlocked,adverseFlags,noData,unitLimit,notionalLimit,maxLeverage:round(maxLeverage,2),maxUnitsHeld,blockedByLeverage,unitAddAttempts,
  trades,events,month,snapshots,starts_2026:round(first2026?.equity,2)};
}
async function main(){
 const g=await gold1h(),lev=dailyLevels(g.bars),results={},start='2026-01-01',end='2026-10-16';
 if(g.bars.length<9500)throw Error('Incomplete gold hourly data');
 const scenarios=[];
 for(const limit of [4,6,8,12,20,500]){
   const label=limit===500?'no_unit_cap':String(limit)+'_units';
   scenarios.push({label:label+'_max5x',unitLimit:limit,notionalLimit:5});
 }
 for(const limit of [4,6,8,12,20,500]){
   const label=limit===500?'no_unit_cap':String(limit)+'_units';
   scenarios.push({label:label+'_max10x',unitLimit:limit,notionalLimit:10});
 }
 for(const limit of [4,8,12,20,500]){
   const label=limit===500?'no_unit_cap':String(limit)+'_units';
   scenarios.push({label:label+'_unlevered_cap',unitLimit:limit,notionalLimit:1e10});
 }
 for(const o of scenarios){
   results[o.label]={};
   for(const period of [['flat2026',start],['carry2025','2025-04-01']]){
    const [key,from]=period;
    const z=simulate(g.bars,lev.levels,null,'pure',from,end,{unitLimit:o.unitLimit,notionalLimit:o.notionalLimit});
    if(period[0]==='carry2025'){
      const prev=z.snapshots.filter(x=>x.session<start).at(-1),final=z.snapshots.at(-1);
      z.year2026_return_pct=prev&&final?round(100*(final.equity/prev.equity-1),2):null;
      const initial2026=prev?.equity||10000;let localPeak=initial2026,dd2026=0;
      for(const snap of z.snapshots)if(snap.session>=start){
       localPeak=Math.max(localPeak,snap.equity);
       dd2026=Math.max(dd2026,100*(1-snap.equity/localPeak))}
      z.year2026_drawdown_pct=round(dd2026,2);
    }
    results[o.label][key]=z;
   }
 }
 const meta={generated_utc:new Date().toISOString(),
  price_source:'Yahoo GC=F front continuous gold futures hourly OHLC; valid completed through 2026-10-16',
  sample:{first:g.first,last:g.last,bars:g.bars.length,excluded:g.bad,periods:['2026-01-01 flat','2025-04-01 carry to 2026-10-16']},
  rules:{s2entry:'55 completed days channel',s2exit:'20 completed days opposite channel',N:'20 Wilder ATR prior completed day',
   add:'0.5 times prior day N from prior actual add fill, same size each unit 1 percent initial capital/N',
   unitStops:'each unit initial 2N; old units move 0.5N after each add; 20 day channel exit unchanged',
   costs:'0.2 USD/oz each side slip plus 5bp each side fee',
   sizing:'initial equity USD 10000; synthetic fractional gold ounce; fixed qty 1 percent initial account / N of entry/add day',
   leverage:'cap tests 5x,10x, uncapped. Max allowed computed using beginning hourly OPEN instead of same hour CLOSE; excludes exchange margin/carry',
   execution:'same-hour uncertain stop assumed adverse; 2026 end forced close to compare complete campaigns'},
  limitations:[
   '100x or unlimited leverage results are risk stress only, not feasible live. No maintenance margin liquidation or financing charges',
   'GC continuous rolls may fabricate price jumps and untradeable entries; not actual dated contract fills',
   '1h OHLC unknown ordering: conservative exit preference, but cannot prove true 1min/5min path',
   'Original Turtle full money management is more complex: volatility N, unit scaling, annual risk reductions and correlation book',
   '2025-carry start in April and forced closure in 2026 is a sensitivity scenario only; not full live original signals',
   'No short-volatility options or macro indicators here; one parameter varied: pyramid cap.'
  ]};
 fs.mkdirSync('research-data',{recursive:true});
 const raw={meta,results};
 fs.writeFileSync('research-data/GOLD_2026_TURTLE_UNLIMITED_ADDS_RESULTS.json',JSON.stringify(raw,null,2));
 const header='version,period,campaigns,wins,win_pct,adds,total_entries,max_units,blocked_leverage,final_usd,return_pct,year2026_return_pct,max_dd_pct,year2026_dd_pct,max_leverage,profit_factor';
 const lines=[header];
 for(const [id,v] of Object.entries(results))for(const [period,z] of Object.entries(v)){
  lines.push([id,period,z.n_trades,z.n_winners,z.hit_pct,z.adds,z.entries,z.maxUnitsHeld,z.blockedByLeverage,z.final_usd,z.return_pct,
   z.year2026_return_pct??'',z.max_drawdown_pct,z.year2026_drawdown_pct??'',z.maxLeverage,z.profit_factor].join(','));
 }
 fs.writeFileSync('research-data/GOLD_2026_TURTLE_UNLIMITED_ADDS_SUMMARY.csv',lines.join('\n')+'\n');
 console.log('META',JSON.stringify(meta.sample));
 console.log('SUMMARY\n'+lines.join('\n'));
 for(const variant of ['4_units_max5x','6_units_max5x','8_units_max5x','12_units_max5x','20_units_max5x','no_unit_cap_max5x','no_unit_cap_max10x','no_unit_cap_unlevered_cap']){
  const z=results[variant].flat2026;
  console.log('CAMPAIGNS',variant,JSON.stringify(z.trades.map(x=>({from:x.entry_session,to:x.exit_session,side:x.side,units:x.units,pnl:x.pnl_usd,reason:x.exit_reason}))));
 }
}
main().catch(e=>{console.error('FATAL',e.stack||e);process.exitCode=1});
