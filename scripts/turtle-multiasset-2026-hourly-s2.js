// 2026 multi-market Turtle System 2, research-only.
// Frozen universe: GC SI CL HO ZN ZB ES NQ 6E 6J HG KC, unselected by returns.
// Uses valid Yahoo GC=F etc hourly bars, previous fully completed NY 17:00 session
// 55-day Donchian entry, 20-day exit, 20-day Wilder N, four 0.5N pyramids,
// two-N independent unit stops. Costs 5bps/side + 1bp/side slippage. Synthetic
// fractional contract equivalents, NOT CME contract-rounding or risk-certified.
const fs=require('node:fs');
const dayMs=d=>Date.parse(d+'T00:00:00Z');
const DAY=86400000,round=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
const START='2026-01-01',END='2026-10-16';
const RISK_PER_N=Number(process.env.TURTLE_RISK_PER_N??'0.01');
if(!(RISK_PER_N>0&&RISK_PER_N<=.02))throw Error('Risk per N out of allowed range');
const SYMBOLS=[
 {s:'GC=F',name:'黄金',group:'precious',category:'贵金属'},
 {s:'SI=F',name:'白银',group:'precious',category:'贵金属'},
 {s:'CL=F',name:'原油',group:'energy',category:'能源'},
 {s:'HO=F',name:'取暖油',group:'energy',category:'能源'},
 {s:'ZN=F',name:'10年美债',group:'rates',category:'美债'},
 {s:'ZB=F',name:'30年美债',group:'rates',category:'美债'},
 {s:'ES=F',name:'标普500',group:'equities',category:'股指'},
 {s:'NQ=F',name:'纳斯达克100',group:'equities',category:'股指'},
 {s:'6E=F',name:'欧元',group:'fx',category:'外汇'},
 {s:'6J=F',name:'日元',group:'fx',category:'外汇'},
 {s:'HG=F',name:'铜',group:'industrials',category:'工业金属'},
 {s:'KC=F',name:'咖啡',group:'softs',category:'农产品'},
];
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function session(ts){const x=Object.fromEntries(ny.formatToParts(new Date(ts)).filter(z=>z.type!=='literal').map(z=>[z.type,z.value]));
 const date=x.year+'-'+x.month+'-'+x.day;return Number(x.hour)>=17?new Date(dayMs(date)+DAY).toISOString().slice(0,10):date;
}
async function get(sym){
 const p1=dayMs('2025-01-01')/1000,p2=dayMs('2026-10-19')/1000;
 const uri='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?interval=1h&period1='+p1+'&period2='+p2;
 const response=await fetch(uri,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(35000)});
 if(!response.ok)throw Error('http '+response.status+' '+sym);
 const j=(await response.json()).chart.result?.[0],q=j?.indicators?.quote?.[0];
 if(!j?.timestamp||!q)throw Error('no quote '+sym);
 let bad=0,duplicates=0,valid=[],seen=new Set();
 for(let i=0;i<j.timestamp.length;i++){
  const t=j.timestamp[i]*1000; if(t>=dayMs('2026-10-17'))continue;
  const b={t,s:session(t),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]};
  if(seen.has(t)){duplicates++;continue}seen.add(t);
  if(![b.o,b.h,b.l,b.c].every(x=>Number.isFinite(x)&&x>0)||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)){bad++;continue}
  valid.push(b)
 }
 valid.sort((a,b)=>a.t-b.t);
 const map=new Map();
 for(let b of valid){let d=map.get(b.s);if(!d){d={s:b.s,o:b.o,h:b.h,l:b.l,c:b.c,bars:0};map.set(b.s,d)}
  d.h=Math.max(d.h,b.h);d.l=Math.min(d.l,b.l);d.c=b.c;d.bars++}
 const days=[...map.values()].sort((a,b)=>a.s.localeCompare(b.s));
 const levels=new Map();
 for(let i=0;i<days.length;i++){
  const d=days[i],tr=i?Math.max(d.h-d.l,Math.abs(d.h-days[i-1].c),Math.abs(d.l-days[i-1].c)):d.h-d.l;
  d.tr=tr;
  if(i===19)d.n=days.slice(0,20).reduce((sum,x)=>sum+x.tr,0)/20;
  else if(i>19)d.n=(days[i-1].n*19+tr)/20;
  if(i>=55){const past=days.slice(i-55,i),p20=past.slice(-20);
   levels.set(d.s,{n:days[i-1].n,previousSession:days[i-1].s,hi55:Math.max(...past.map(x=>x.h)),lo55:Math.min(...past.map(x=>x.l)),
     hi20:Math.max(...p20.map(x=>x.h)),lo20:Math.min(...p20.map(x=>x.l))})}
 }
 const dates=days.filter(x=>x.s>=START&&x.s<=END);
 const anomalies=days.slice(1).filter((d,i)=>Math.abs(d.c/days[i].c-1)>.20).map(x=>({day:x.s,pct:round(100*(x.c/days[days.indexOf(x)-1].c-1),2)}));
 return {sym,bars:valid.filter(x=>x.s<=END),days,levels,quality:{hour_bars:valid.length,bad_ohlc_or_empty:bad,duplicates,
  sessions2026:dates.length,first:valid[0]?new Date(valid[0].t).toISOString():null,last:valid.at(-1)?new Date(valid.at(-1).t).toISOString():null,
  firstClose2026:dates[0]?.c,lastClose2026:dates.at(-1)?.c,largeOneSessionMovesAbove20Pct:anomalies.slice(0,15)}};
}
function study(data,selected,variant,start=START,end=END){
 const assetById=new Map(selected.map(x=>[x.s,x])),sets=new Map(selected.map(x=>[x.s,data[x.s]]));
 const events=[];
 for(const asset of selected)for(const b of data[asset.s].bars)if(b.s>=start&&b.s<=end&&data[asset.s].levels.has(b.s))events.push({...b,symbol:asset.s});
 events.sort((a,b)=>a.t-b.t||a.symbol.localeCompare(b.symbol));
 let cash=1000000,positions=new Map(),lastPrice=new Map(),peak=1000000,minEq=1000000,maxDD=0,
 entryCount=0,addCount=0,closedCampaigns=[],unitExitCount=0,attemptsBlocked={group:0,direction:0,leverage:0},
 history=[],riskLevels=[];
 const bpsFee=Number(process.env.TURTLE_FEE_BPS_SIDE??5)/10000,bpsSlip=Number(process.env.TURTLE_SLIP_BPS_SIDE??1)/10000,maxGrossLeverage=5;
 if(!Number.isFinite(bpsFee)||!Number.isFinite(bpsSlip)||bpsFee<0||bpsSlip<0)throw Error('Invalid cost assumptions');
 const cashBeforeClose=()=>cash;
 function equity(){let total=cash;for(const p of positions.values())for(const u of p.units){
  const price=lastPrice.get(p.symbol)??u.entry;
  total+=u.side*u.qty*(price-u.entry)-u.qty*price*bpsFee;
 }return total;}
 function gross(){let g=0;for(const p of positions.values())for(const u of p.units)g+=u.qty*(lastPrice.get(p.symbol)??u.entry);return g}
 function groupUnits(group){let n=0;for(const p of positions.values())if(p.group===group)n+=p.units.length;return n}
 function directionUnits(side){let n=0;for(const p of positions.values())if(p.side===side)n+=p.units.length;return n}
 const fill=(quote,side)=>quote*(1+side*bpsSlip);
 function sellUnits(b,pos,items){
  for(const {u,quote,why} of items){
   const final=fill(quote,-u.side),profit=u.side*u.qty*(final-u.entry)-u.qty*final*bpsFee;
   cash+=profit;
   pos.pnl+=profit; pos.exits.push({when:new Date(b.t).toISOString(),why,price:round(final,6),pnl:round(profit,2)});
   pos.units.splice(pos.units.indexOf(u),1);unitExitCount++;
  }
  if(!pos.units.length){
   const t={symbol:pos.symbol,sector:pos.group,side:pos.side,entered:pos.started,exit:new Date(b.t).toISOString(),
     units:pos.totalUnits,adds:pos.totalUnits-1,reason:items.at(-1).why,pnl:round(pos.pnl-pos.fees,2),exits:pos.exits,
     heldFromBefore2026:pos.started.slice(0,10)<START};
   closedCampaigns.push(t);
   positions.delete(pos.symbol);
  }
 }
 function newUnit(b,asset,side,level,n,reason){
  let pos=positions.get(asset.s);
  if(pos&&pos.totalUnits>=4)return false;
  if(variant==='corr'){
   if(groupUnits(asset.group)>=6){attemptsBlocked.group++;return false}
   if(directionUnits(side)>=12){attemptsBlocked.direction++;return false}
  }
  const mark=equity(),price=side===1?Math.max(b.o,level):Math.min(b.o,level);
  if(mark<=0)return false;
  const entry=fill(price,side);
  const desiredQty=(mark*RISK_PER_N)/n; // 1 N price move = 1% of current portfolio equity.
  const free=Math.max(0,mark*maxGrossLeverage-gross());
  if(free/entry < desiredQty*.25){attemptsBlocked.leverage++;return false}
  const qty=Math.min(desiredQty,free/entry);
  if(pos){
   // Turtle rule: after each 0.5N add, ratchet old unit stops by 0.5N.
   // Each unit keeps its own unit stop, and 20-day exit remains portfolio-wide.
   for(const u of pos.units)u.stop+=side*.5*n;
  }else{
   pos={symbol:asset.s,group:asset.group,side,started:new Date(b.t).toISOString(),units:[],totalUnits:0,fees:0,pnl:0,exits:[],lastAdd:null};
   positions.set(asset.s,pos);
  }
  const fee=qty*entry*bpsFee;
  cash-=fee;pos.fees+=fee;
  pos.units.push({side,qty,entry,stop:entry-side*2*n,n});
  pos.totalUnits++;pos.lastAdd=entry;pos.nextAdd=entry+side*.5*n;
  if(reason==='entry')entryCount++;else addCount++;
  riskLevels.push({date:new Date(b.t).toISOString(),symbol:asset.s,kind:reason,side,price:round(entry,6),n:round(n,6),
   qty:round(qty,5),equity:round(mark,2),units:pos.totalUnits});
  return true;
 }
 let currentTime=null;
 function snapshot(time){
  const e=equity();peak=Math.max(peak,e);minEq=Math.min(minEq,e);maxDD=Math.max(maxDD,100*(1-e/peak));
  history.push({date:new Date(time).toISOString(),equity:e,openPositions:positions.size,grossRatio:gross()/Math.max(1,e)});
 }
 for(let i=0;i<events.length;i++){
  const b=events[i],asset=assetById.get(b.symbol),levels=sets.get(b.symbol).levels.get(b.s);
  if(currentTime!==null&&currentTime!==b.t)snapshot(currentTime);
  currentTime=b.t;
  if(!(levels.previousSession<b.s&&levels.n>0))throw Error('lookahead '+b.symbol+' '+b.s);
  lastPrice.set(b.symbol,b.o);
  let pos=positions.get(b.symbol);
  let exited=false;
  if(pos){
   const trail=pos.side===1?levels.lo20:levels.hi20,which=[];
   for(const u of [...pos.units]){
    const bound=pos.side===1?Math.max(u.stop,trail):Math.min(u.stop,trail),
       hit=pos.side===1?b.l<=bound:b.h>=bound;
    if(hit)which.push({u,quote:pos.side===1?Math.min(b.o,bound):Math.max(b.o,bound),
      why:(pos.side===1?trail>=u.stop:trail<=u.stop)?'20d_exit':'2N_stop'});
   }
   if(which.length){sellUnits(b,pos,which);exited=true}
  }
  pos=positions.get(b.symbol);
  if(!pos&&!exited){
   const hitLong=b.h>=levels.hi55,hitShort=b.l<=levels.lo55;
   if(hitLong!==hitShort){
    const side=hitLong?1:-1,price=hitLong?levels.hi55:levels.lo55;
    if(newUnit(b,asset,side,price,levels.n,'entry')){
     pos=positions.get(b.symbol);
     // Unknown hour path. Any entry-hour return across stop assumed stop first (pessimistic).
     const crossing=pos.units.filter(u=>side===1?b.l<=u.stop:b.h>=u.stop);
     if(crossing.length){sellUnits(b,pos,crossing.map(u=>({u,quote:u.stop,why:'same_hour_stop'})));exited=true}
    }
   }
  }
  pos=positions.get(b.symbol);
  if(pos&&!exited){
   let addsThisHour=0;
   while(pos&&pos.units.length&&pos.totalUnits<4&&addsThisHour<3){
    const side=pos.side,trigger=pos.nextAdd,touch=side===1?b.h>=trigger:b.l<=trigger;
    if(!touch)break;
    if(!newUnit(b,asset,side,trigger,levels.n,'add'))break;
    addsThisHour++;
    pos=positions.get(b.symbol);
    const crossing=pos.units.filter(u=>side===1?b.l<=u.stop:b.h>=u.stop);
    if(crossing.length){
      sellUnits(b,pos,crossing.map(u=>({u,quote:u.stop,why:'same_hour_stop_after_add'})));
      pos=positions.get(b.symbol);
      exited=true;break;
    }
   }
  }
  lastPrice.set(b.symbol,b.c);
 }
 if(currentTime!==null)snapshot(currentTime);
 const startEquity=history.find(x=>x.date.slice(0,10)>=START)?.equity??1000000;
 const last2025=history.filter(x=>x.date.slice(0,10)<START).at(-1)?.equity;
 const final=equity(),bySym={},openPositions=[];
 for(const p of positions.values()){
  const price=lastPrice.get(p.symbol),floatPnl=p.units.reduce((sum,u)=>sum+u.side*u.qty*(price-u.entry)-u.qty*price*bpsFee,0);
  openPositions.push({symbol:p.symbol,side:p.side,units:p.units.length,entry:p.started,unrealized:round(floatPnl,2)});
 }
 for(const t of closedCampaigns){
  const p=bySym[t.symbol]??(bySym[t.symbol]={pnl:0,trades:0,wins:0});
  p.pnl+=t.pnl;p.trades++;if(t.pnl>0)p.wins++;
 }
 for(const p of openPositions){let x=bySym[p.symbol]??(bySym[p.symbol]={pnl:0,trades:0,wins:0});x.openFloatingPnl=(x.openFloatingPnl||0)+p.unrealized}
 const wins=closedCampaigns.filter(x=>x.pnl>0);
 const maxGrossRatio=history.length?Math.max(...history.map(x=>x.grossRatio)):0;
 let eq2026peak=last2025??1000000,dd2026=0,first2026=null;
 for(const h of history)if(h.date.slice(0,10)>=START){if(first2026===null)first2026=h.equity;eq2026peak=Math.max(eq2026peak,h.equity);dd2026=Math.max(dd2026,100*(1-h.equity/eq2026peak))}
 return {start,end,variant,markets:selected.length,initial:1000000,finalEquity:round(final,2),
  wholeSampleReturnPct:round(100*(final/1000000-1),2),
  calendar2026ReturnPct:round(100*(final/(last2025??1000000)-1),2),
  maxDrawdownWholePct:round(maxDD,2),maxDrawdown2026Pct:round(dd2026,2),
  maxGrossRatio:round(maxGrossRatio,2),campaigns:closedCampaigns.length,winCount:wins.length,winPct:closedCampaigns.length?round(100*wins.length/closedCampaigns.length,2):null,
  entryCount,addCount,unitExitCount,blocked:attemptsBlocked,openPositions,bySym,closedCampaigns,
  history:history.filter((_,i)=>i===0||i===history.length-1||history[i].date.slice(0,10)!==history[i+1]?.date.slice(0,10))
    .map(x=>({...x,equity:round(x.equity,2),grossRatio:round(x.grossRatio,3)})),
  riskLevels:riskLevels.slice(0,80)};
}
async function main(){
 const found=await Promise.allSettled(SYMBOLS.map(x=>get(x.s)));
 const data={},errors={},quality={};
 for(let i=0;i<found.length;i++){const s=SYMBOLS[i].s,job=found[i];
  if(job.status==='fulfilled'){
   data[s]=job.value;quality[s]=job.value.quality;
   if(job.value.quality.sessions2026<160||job.value.days.length<300){errors[s]='inadequate valid session coverage';delete data[s]}
  }else errors[s]=String(job.reason);}
 const available=SYMBOLS.filter(x=>data[x.s]); if(!data['GC=F'])throw Error('Gold missing');
 const variants=[];
 for(const start of [START,'2025-04-01']){
  for(const [name,universe,limits] of [
   ['gold_only',SYMBOLS.filter(x=>x.s==='GC=F'),'corr'],
   ['twelve_uncapped',available,'uncapped'],
   ['twelve_correlated_cap',available,'corr'],
  ]){
   const r=study(data,universe,limits,start,END);r.name=name;variants.push(r);
  }
 }
 const final={generated_utc:new Date().toISOString(),
  status:'exploratory multiasset 2026 hourly continuous futures proxy; original Turtle not fully replicated',
  period:'2026-01-01 to 2026-10-16 completed sessions, plus separate 2025-04 carry scenario',
  symbols:SYMBOLS,quality,sourceErrors:errors,riskPerN:RISK_PER_N,costBpsEachSide:Number(process.env.TURTLE_FEE_BPS_SIDE??5),slippageBpsEachSide:Number(process.env.TURTLE_SLIP_BPS_SIDE??1),
  rules:{entry:'55 fully completed NY17 sessions high/low',
   exit:'20 fully completed NY17 sessions reverse high/low',
   N:'20 session Wilder ATR last completed NY17 session, initialized via 20 session simple mean',
   pyramids:'0.5N additions up to four lifetime units per campaign, each 2N individual stop ratchets by 0.5N when adds',
   sizing:'Synthetic fractional futures-equivalent units; N*qty=RISK_PER_N fraction current account equity; 2N nominal stop=2*RISK_PER_N of equity; run 0.0025, 0.005 and 0.01',
   correlationLimits:'Market 4 units; metals GC SI share group limit 6, energy CL HO group limit 6, bonds ZN ZB 6, equities ES NQ 6, FX 6E 6J 6, HG and KC separate; each side portfolio <=12',
   grossLimit:'Gross quote-notional <=5x current mark-to-market equity AT unit entry; not a real margin model',
   fees:'Cost sensitivity: environment-variable fee and slip bps each side; defaults 5bps fee plus 1bp simulated slip; not actual market-specific fills',
   trading:'Hourly OHLC breakout/stop; stop-first on same-hour ambiguity; pessimistic intrabar assumptions; keep existing open positions at final mark, no forced exit',
   universe:'12 predeclared markets not selected by historical return; if price insufficient, exclude with reason',
   caveats:['Yahoo front continuous futures rolling and date mapping can generate artificial price jumps; futures expiry rollover not executed',
    'All instruments are synthetic fractional contracts, not actual tradable standard futures and multipliers; could not implement $10k standard futures portfolio',
    'Portfolio fills same-hour tie deterministic by sorted symbol; intrabar path and actual 1min/5min missing',
    'Different exchange session calendars are approximated with a common New York 17:00 boundary',
    'No verified bid/ask, per-symbol commission, margin interest, dynamic volatility target, or original 10/20 percent risk-ratchet',
    'Not an out-of-sample proof of allocation or statistical benefit from diversification']},
  results:variants};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/TURTLE_2026_12_MARKET_HOURLY_REPLAY.json',JSON.stringify(final,null,2));
 const headers='scenario,from,markets,closed_campaigns,wins,win_pct,entries,adds,final_usd,return_pct,max_drawdown_pct,2026_return_pct,2026_dd_pct,max_gross_leverage,group_blocked,direction_blocked,leverage_blocked';
 const csv=[headers];
 for(const v of variants)csv.push([v.name,v.start,v.markets,v.campaigns,v.winCount,v.winPct,v.entryCount,v.addCount,v.finalEquity,v.wholeSampleReturnPct,v.maxDrawdownWholePct,
    v.calendar2026ReturnPct,v.maxDrawdown2026Pct,v.maxGrossRatio,v.blocked.group,v.blocked.direction,v.blocked.leverage].join(','));
 fs.writeFileSync('research-data/TURTLE_2026_12_MARKET_HOURLY_SUMMARY.csv',csv.join('\n')+'\n');
 const trades=['scenario,from,symbol,entry,exit,side,units,adds,pnl,reason'];
 for(const v of variants)for(const t of v.closedCampaigns)trades.push([v.name,v.start,t.symbol,t.entered,t.exit,t.side,t.units,t.adds,t.pnl,t.reason].join(','));
 fs.writeFileSync('research-data/TURTLE_2026_12_MARKET_HOURLY_TRADES.csv',trades.join('\n')+'\n');
 console.log('QUALITY',JSON.stringify({sourceErrors:errors,quality}));
 for(const v of variants)console.log('RESULT',JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k])=>!['closedCampaigns','history','riskLevels'].includes(k)))));
 console.log('SUMMARY\n'+csv.join('\n'));
}
main().catch(e=>{console.error('FATAL',e.stack||e);process.exitCode=1});
