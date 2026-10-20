// Research: 2026 gold Turtle S2 on 4h K-lines vs daily lines, 1h execution.
// No macro; compare original maximum four units, post-four virtual stop ratchet,
// and extended eight/twelve units, same execution simulator and friction.
// GC=F Yahoo continuous near-month hourly, synthetic fractional ounces, NOT CME execution.
const fs=require('node:fs');
const FROM='2026-01-01',TO='2026-10-16',WARMUP='2025-01-01';
const INIT=10000,FEE_BP=5,SLIP_USD=.20,CAP=5;
const NY=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const MS=d=>Date.parse(d+'T00:00:00Z');
const RD=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
function wall(t){const p=Object.fromEntries(NY.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {day:p.year+'-'+p.month+'-'+p.day,hour:+p.hour};}
function hourSession(b){
 const w=wall(b.t);
 const d=w.hour>=17?new Date(MS(w.day)+86400000).toISOString().slice(0,10):w.day;
 const bucket=Math.floor(((w.hour+24-17)%24)/4);
 return {day:d,bucket,key:d+'~'+bucket};
}
async function getHourGold(){
 const p1=MS(WARMUP)/1000,p2=MS('2026-10-19')/1000;
 const uri='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1h&period1='+p1+'&period2='+p2;
 const r=await fetch(uri,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(35000)});
 if(!r.ok)throw Error('Gold historical hourly feed HTTP '+r.status);
 const data=(await r.json()).chart?.result?.[0],q=data?.indicators?.quote?.[0];
 if(!data?.timestamp||!q)throw Error('Gold missing historical bars');
 const bars=[],stats={raw:0,missing:0,duplicates:0,valid:0,weekend:0},seen=new Set();
 for(let i=0;i<data.timestamp.length;i++){
  const t=data.timestamp[i]*1000;if(t>=MS('2026-10-17'))continue;
  stats.raw++;
  const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];
  if(seen.has(t)){stats.duplicates++;continue;}seen.add(t);
  if(![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||h<Math.max(o,c)||l>Math.min(o,c)){stats.missing++;continue;}
  const w=hourSession({t});const b={t,o,h,l,c,...w};
  bars.push(b);stats.valid++;
 }
 bars.sort((x,y)=>x.t-y.t);
 stats.first=new Date(bars[0]?.t).toISOString();
 stats.last=new Date(bars.at(-1)?.t).toISOString();
 const unusual=bars.filter((b,i)=>i&&Math.abs(b.o-bars[i-1].c)/bars[i-1].c>.02).map(b=>({t:new Date(b.t).toISOString(),gapPct:RD(100*(b.o/bars[bars.indexOf(b)-1].c-1),2)}));
 stats.gapsOver2Pct=unusual.slice(0,20);
 return {bars,stats};
}
function aggregate(bars,keyFn){
 const series=[],map=new Map();
 for(const b of bars){
  const key=keyFn(b),last=map.get(key);
  if(last){last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);last.c=b.c;last.count++;last.endT=b.t;}
  else{const p={key,s:b.day,o:b.o,h:b.h,l:b.l,c:b.c,startT:b.t,endT:b.t,count:1};map.set(key,p);series.push(p);}
 }
 // buckets are monotonic by incoming UTC hour sequence; data are sorted.
 for(let i=0;i<series.length;i++){
  const x=series[i],prev=series[i-1];
  x.tr=prev?Math.max(x.h-x.l,Math.abs(x.h-prev.c),Math.abs(x.l-prev.c)):x.h-x.l;
  if(i===19)x.n=series.slice(0,20).reduce((s,q)=>s+q.tr,0)/20;
  else if(i>19)x.n=(19*series[i-1].n+x.tr)/20;
 }
 return series;
}
function lookbacks(series,entryN,exitN){
 const map=new Map();let periods=0;
 for(let i=Math.max(20,entryN);i<series.length;i++){
  const prior=series.slice(i-entryN,i),opp=series.slice(i-exitN,i),cur=series[i],p=series[i-1];
  if(cur.startT<=p.endT)throw Error('Overlapping periods');
  map.set(cur.key,{n:p.n,priceKnownUntil:p.endT,hi:Math.max(...prior.map(x=>x.h)),lo:Math.min(...prior.map(x=>x.l)),
   exitHi:Math.max(...opp.map(x=>x.h)),exitLo:Math.min(...opp.map(x=>x.l))});periods++;
 }
 return {map,periods};
}
function sim(bars,pre,mode,capUnits,risk,period){
 const posArray=[],trades=[],events=[],monthly={},stats={entries:0,adds:0,virtual:0,blocked:0,entryHourStops:0,addHourStops:0,unitsExited:0,exitCh:0,exitStop:0,positionEOD:0,ambiguousBothLevels:0};
 let cash=INIT,p=null,peak=INIT,dd=0,maxLev=0,maxUnits=0;
 const FEE=FEE_BP/10000;
 const equity=(mark)=>cash+(p?p.units.reduce((sum,u)=>sum+u.side*u.q*(mark-u.at)-u.q*mark*FEE,0):0);
 const leverage=(mark,e)=>p?p.units.reduce((s,u)=>s+u.q*mark,0)/Math.max(1,e):0;
 function addUnit(b,level,side,n,isAdd){
  const entry=side===1?Math.max(b.o,level)+SLIP_USD:Math.min(b.o,level)-SLIP_USD;
  const e=equity(b.o),qAim=INIT*risk/n;
  const prevNotional=p?p.units.reduce((s,u)=>s+u.q*entry,0):0;
  const qCap=Math.max(0,(e*CAP-prevNotional)/entry);
  const q=Math.min(qAim,qCap);
  if(e<=0||q<qAim*.25){stats.blocked++;return false;}
  if(p){for(const u of p.units)u.stop+=side*.5*n;}
  else{p={started:new Date(b.t).toISOString(),side,units:[],total:0,adds:0,
   nextAdd:null,lastFill:null,pnl:0,entryFees:0,unitsClosed:0,exits:[],entryAt:entry,virtualCount:0,maxUnits:0};}
  const fee=q*entry*FEE;
  cash-=fee;p.entryFees+=fee;
  p.units.push({side,q,at:entry,stop:entry-side*2*n,n});
  p.total++;p.maxUnits=Math.max(p.maxUnits,p.units.length);
  p.nextAdd=entry+side*.5*n;p.lastFill=entry;
  if(isAdd){p.adds++;stats.adds++;}else stats.entries++;
  events.push({kind:isAdd?'add':'entry',time:new Date(b.t).toISOString(),price:RD(entry,3),units:p.total,qty:RD(q,5)});
  return true;
 }
 function exitUnits(b,list){
  if(!p||!list.length)return;
  const trade=p;
  for(const {unit,level,why} of list){
   if(!trade.units.includes(unit))continue;
   const px=unit.side===1?Math.min(b.o,level)-SLIP_USD:Math.max(b.o,level)+SLIP_USD;
   const pnl=unit.side*unit.q*(px-unit.at)-unit.q*px*FEE;
   cash+=pnl;trade.pnl+=pnl;
   trade.exits.push({time:new Date(b.t).toISOString(),price:RD(px,3),why,pnl:RD(pnl,2)});
   trade.units.splice(trade.units.indexOf(unit),1);trade.unitsClosed++;stats.unitsExited++;
   if(why==='20_ch')stats.exitCh++;else stats.exitStop++;
  }
  if(!trade.units.length){
   trades.push({entry:trade.started,exit:new Date(b.t).toISOString(),side:trade.side,maxUnits:trade.maxUnits,totalUnits:trade.total,
      adds:trade.adds,virtual:trade.virtualCount,pnlUsd:RD(trade.pnl-trade.entryFees,2),entryPrice:RD(trade.entryAt,2),
      reason:trade.exits.at(-1)?.why,unitExits:trade.exits});
   p=null;
  }
 }
 let lastBar=null,positionCrossedButNotEntered=0;
 for(const b of bars){
  if(b.day<FROM||b.day>TO)continue;
  const key=period==='4h'?b.key:b.day;
  const lv=pre.map.get(key);
  if(!lv)continue;
  if(lv.priceKnownUntil>=b.t)throw Error('Lookahead period at '+new Date(b.t).toISOString());
  let didExit=false;
  if(p){
   const side=p.side,trail=side===1?lv.exitLo:lv.exitHi,exits=[];
   for(const u of [...p.units]){
    const stop=u.stop,at=side===1?Math.max(stop,trail):Math.min(stop,trail);
    const hit=side===1?b.l<=at:b.h>=at;
    if(hit)exits.push({unit:u,level:at,why:(side===1?trail>=stop:trail<=stop)?'20_ch':'2N_stop'});
   }
   if(exits.length){exitUnits(b,exits);didExit=true;}
  }
  if(!p&&!didExit){
   const long=b.h>=lv.hi,short=b.l<=lv.lo;
   if(long!==short){
    const side=long?1:-1,at=long?lv.hi:lv.lo;
    if(addUnit(b,at,side,lv.n,false)){
     const exits=p.units.filter(u=>u.side===1?b.l<=u.stop:b.h>=u.stop);
     if(exits.length){stats.entryHourStops++;
      exitUnits(b,exits.map(unit=>({unit,level:unit.stop,why:'entry_hour_stop'})));didExit=true;}
    }
   }else if(long&&short)stats.ambiguousBothLevels++;
  }
  // System's next add threshold is recalculated ONLY from the latest executed add
  // (or the most recent virtual stop ratchet). 4h ATR uses last completed 4h candle.
  if(p&&!didExit){
   let guard=0;
   while(p&&guard<150){
    const side=p.side,target=p.nextAdd;
    if(!(side===1?b.h>=target:b.l<=target))break;
    const extend=p.total>=capUnits;
    if(!extend){
      if(!addUnit(b,target,side,lv.n,true))break;
    }else if(mode==='virtual'){
      for(const u of p.units)u.stop+=side*.5*lv.n;
      p.nextAdd=target+side*.5*lv.n;p.virtualCount++;stats.virtual++;
    }else break;
    guard++;
    const hit=p.units.filter(u=>side===1?b.l<=u.stop:b.h>=u.stop);
    if(hit.length){stats.addHourStops++;
     exitUnits(b,hit.map(unit=>({unit,level:unit.stop,why:extend?'virtual_hour_stop':'add_hour_stop'})));didExit=true;break;}
   }
  }
  const endEq=equity(b.c),lev=leverage(b.c,endEq);
  if(!Number.isFinite(endEq))throw Error('Bad equity');
  peak=Math.max(peak,endEq);dd=Math.max(dd,100*(1-endEq/peak));maxLev=Math.max(maxLev,lev);
  maxUnits=Math.max(maxUnits,p?.units.length||0);
  const mm=b.day.slice(0,7);monthly[mm]=RD(endEq);
  lastBar=b;
 }
 if(!lastBar)throw Error('No bars in period');
 const endEquity=equity(lastBar.c),wins=trades.filter(x=>x.pnlUsd>0),losses=trades.filter(x=>x.pnlUsd<0),winGross=wins.reduce((s,x)=>s+x.pnlUsd,0),lossGross=-losses.reduce((s,x)=>s+x.pnlUsd,0);
 return {period,mode,maxUnitsAllowed:capUnits,risk,
  endingEquity:RD(endEquity),returnPct:RD(100*(endEquity/INIT-1)),maxDrawdownPct:RD(dd),
  maxLeverage:RD(maxLev),maxActualUnits:maxUnits,tradesCompleted:trades.length,wins:wins.length,winRate:trades.length?RD(100*wins.length/trades.length,1):null,
  profitFactor:lossGross?RD(winGross/lossGross,3):null,stats,openPosition:p?{entry:p.started,units:p.units.length,side:p.side,floatPnl:RD(endEquity-cash,2)}:null,
  firstTrade:trades[0]?{entry:trades[0].entry,exit:trades[0].exit,pnlUsd:trades[0].pnlUsd}:null,
  month:monthly,trades,events:events.slice(0,130)};
}
async function main(){
 const gold=await getHourGold(),h=gold.bars;
 const four=aggregate(h,b=>b.key),daily=aggregate(h,b=>b.day);
 const frameworks=[
  {id:'4h_55_20',description:'55 completed 4h candles 20 completed 4h candles exit (fast time frame)',period:'4h',levels:lookbacks(four,55,20)},
  {id:'4h_330_120',description:'330 completed 4h candles 120 completed 4h exit (rough 55/20 daily span)',period:'4h',levels:lookbacks(four,330,120)},
  {id:'daily_55_20',description:'55 completed NY17 daily candles 20 daily exit (earlier study baseline)',period:'daily',levels:lookbacks(daily,55,20)}
 ];
 const risk=Number(process.env.TURTLE_4H_RISK??.005);if(!(risk>0&&risk<=.02))throw Error('Bad risk');
 const out={meta:{generatedUtc:new Date().toISOString(),start:FROM,end:TO,source:'Yahoo GC=F continuous nearest futures 1h OHLC',
  quality:gold.stats,bar4hCount:four.length,dailyCount:daily.length,
  periods:frameworks.map(z=>({id:z.id,description:z.description,initialized:z.levels.periods})),
  assumptions:{riskPerN:risk,account:INIT,feeBpsPerSide:FEE_BP,slippagePerOzPerSide:SLIP_USD,leverageEntryLimit:CAP,
   initialUnits:1,maxUnits:4,stop:'2N per unit; older units 0.5N ratchet on adding or post-cap virtual step',
   close:'previous completed 20 candle opposite Donchian',entry:'previous completed 55 candle HH/LL',
   actualFills:'1h OHLC execution proxy; no intrahour ordering',
   n:'20 candle Wilder ATR prior completed candle; each 4h uses NY 17 local anchored 4h buckets',
   limitations:['No real 4h bars provided; aggregated from hourly GC=F Yahoo price','GC=F continuous futures untradeable price gaps around rolls','Not real CME GC contracts or ticks and lacks broker liquidation','5x leverage cap tested on new unit orders only; leverage can exceed later','Same 1h highs/lows cannot resolve entry and exit order; pessimistic stop handling','N and 55/20 measured in 4h candles vs 55/20 daily; fast strategy has a different economic holding horizon',
    '4h 330/120 is approximate; holidays shorten 4h sessions and 55 trading days is not always 330 complete 4h candles']}},results:[]};
 for(const f of frameworks){
  for(const {mode,n} of [{mode:'original',n:4},{mode:'virtual',n:4},{mode:'original',n:8},{mode:'original',n:12},{mode:'original',n:20}]){
   const res=sim(h,f.levels,mode,n,risk,f.period);
   out.results.push({framework:f.id,...res});
   console.log('RESULT',f.id,mode,n,res.returnPct,res.maxDrawdownPct,res.tradesCompleted,res.wins,res.stats.entries,res.stats.adds,res.stats.virtual,res.maxLeverage,JSON.stringify(res.openPosition));
  }
 }
 const dir='research-data';fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(dir+'/GOLD_TURTLE_2026_4H_CHANNELS_REPLAY.json',JSON.stringify(out,null,2));
 const csv=['framework,mode,max_units,risk_per_N,trades,wins,win_pct,entries,adds,virtual_steps,end_usd,return_pct,max_dd_pct,max_lev,open_units,both_level_hours,entry_hour_stops,add_hour_stops'];
 for(const v of out.results){csv.push([v.framework,v.mode,v.maxUnitsAllowed,v.risk,v.tradesCompleted,v.wins,v.winRate,v.stats.entries,v.stats.adds,v.stats.virtual,v.endingEquity,v.returnPct,v.maxDrawdownPct,v.maxLeverage,v.openPosition?.units||0,v.stats.ambiguousBothLevels,v.stats.entryHourStops,v.stats.addHourStops].join(','))}
 fs.writeFileSync(dir+'/GOLD_TURTLE_2026_4H_CHANNELS_SUMMARY.csv',csv.join('\n')+'\n');
 const led=['framework,mode,max_units,entry,exit,side,units,real_adds,virtual_steps,pnl_usd,reason'];
 for(const r of out.results)for(const t of r.trades)led.push([r.framework,r.mode,r.maxUnitsAllowed,t.entry,t.exit,t.side,t.maxUnits,t.adds,t.virtual,t.pnlUsd,t.reason].join(','));
 fs.writeFileSync(dir+'/GOLD_TURTLE_2026_4H_CHANNELS_TRADES.csv',led.join('\n')+'\n');
 console.log('COVERAGE',JSON.stringify(out.meta));
 console.log(csv.join('\n'));
}
main().catch(e=>{console.error('FATAL',e.stack||e);process.exitCode=1});
