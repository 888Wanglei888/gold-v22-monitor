// Gold Turtle S2 M5 spot bid/ask validation: 2020-2025 plus 2019 warmup.
// Compares original 4 units vs 4 units + continued 0.5N VIRTUAL stop
// ratchets (NO extra exposure), plus optional 8/12/20 real pyramids.
// Only prior-completed NY17 daily HH/LL and Wilder N; no future price data.
// Data: evtradelabs public XAUUSD M5 Dukascopy-derived bid/ask; NOT COMEX.
const fs=require('node:fs');
const {getYear,quality}=require('./gold-xauusd-2016-m5-turtle-audit');
const RISK=Number(process.env.TURTLE_M5_RISK_PER_N??.005);
const LEV_CAP=Number(process.env.TURTLE_M5_MAX_OPEN_LEVERAGE??5);
const FEE_BPS=Number(process.env.TURTLE_M5_FEE_BPS_SIDE??5);
const SLIP=Number(process.env.TURTLE_M5_SLIP_USD_SIDE??.20);
const YEAR_START=2020,YEAR_END=2025;
const variants=[
 {name:'H4_original_4',maxUnits:4,virtual:false},
 {name:'H4_virtual_4',maxUnits:4,virtual:true},
 {name:'H4_unlimited_adds',maxUnits:500,virtual:false}
];
function pdate(i){return new Date(i*1000).toISOString().slice(0,10)}
const rd=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
const NY_HOUR=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'});
function getFourHourLevels(bars){
  let cacheHour=-1,hour=-1;const periods=[],byKey=new Map();
  for(const b of bars){
    const utcHour=Math.floor(b.ts/3600);
    if(utcHour!==cacheHour){cacheHour=utcHour;hour=Number(NY_HOUR.format(new Date(b.ts*1000)))}
    const bucket=Math.floor(((hour+24-17)%24)/4),key=b.session+'~'+bucket;
    b.fourKey=key;
    let p=byKey.get(key);
    if(!p){p={key,session:b.session,first:b.ts,last:b.ts,h:b.h,l:b.l,ah:b.ah,al:b.al,c:b.c,n:0};byKey.set(key,p);periods.push(p)}
    else{p.h=Math.max(p.h,b.h);p.l=Math.min(p.l,b.l);p.ah=Math.max(p.ah,b.ah);p.al=Math.min(p.al,b.al);p.c=b.c;p.last=b.ts}
    p.n++;
  }
  const levels=new Map();
  for(let i=0;i<periods.length;i++){
    const p=periods[i],prev=periods[i-1];
    const tr=prev?Math.max(p.h-p.l,Math.abs(p.h-prev.c),Math.abs(p.l-prev.c)):p.h-p.l;
    if(i===19)p.atr20=periods.slice(0,20).reduce((sum,x)=>sum+x.tr,0)/20; // tr defined per prior candle
    else if(i>19)p.atr20=(19*prev.atr20+tr)/20;
    p.tr=tr;
    if(i>=55){
      const r=periods.slice(i-55,i),ex=r.slice(-20);
      levels.set(p.key,{up:{55:Math.max(...r.map(x=>x.h))},
        down:{55:Math.min(...r.map(x=>x.l))},
        exitLong:{20:Math.min(...ex.map(x=>x.l))},
        exitShort:{20:Math.max(...ex.map(x=>x.ah))},
        atr20:prev.atr20,knownUntil:prev.last,previousKey:prev.key});
    }
  }
  return {levels,periods:periods.length,complete:periods.filter(x=>x.n>=36&&x.n<=48).length,
    partial:periods.filter(x=>x.n<36).length,minQuotes:Math.min(...periods.map(x=>x.n)),
    maxQuotes:Math.max(...periods.map(x=>x.n))};
}

function simulation(bars,levels,from,to,rule,{initial=10000,forceClose=false}={}){
 const first=bars.findIndex(x=>x.date>=from),last=bars.findLastIndex(x=>x.date<=to);
 if(first<0||last<first)throw Error('Missing coverage '+from);
 let cash=initial,peak=initial,maxdd=0,maxlev=0,maxunits=0;
 let pos=null,trades=[],closedUnitExits=0,entries=0,adds=0,virtualSteps=0,addBlocked=0,ambiguousAfterAdd=0;
 const history=[],tradeEvents=[];
 let priorBar=null,lastEntryIndex=-1,uncertainCount=0;
 const fee=FEE_BPS/10000;
 function mid(b){return (b.c+b.ac)*.5}
 function eq(b){let e=cash;if(pos)for(const u of pos.units){let px=u.side===1?b.c:b.ac;e+=u.side*u.qty*(px-u.fill)-u.qty*px*fee}return e}
 function equityAt(b,px=b.o){let e=cash;if(pos)for(const u of pos.units){const mark=u.side===1?px:px+Math.max(0,b.ao-b.o);e+=u.side*u.qty*(mark-u.fill)-u.qty*mark*fee}return e}
 function gross(b){return pos?pos.units.reduce((s,u)=>s+u.qty*mid(b),0):0}
 function mark(b){let e=eq(b);peak=Math.max(peak,e);maxdd=Math.max(maxdd,100*(1-e/peak));let lev=gross(b)/Math.max(1,e);maxlev=Math.max(maxlev,lev);maxunits=Math.max(maxunits,pos?.units.length||0);
  if(b.date>=from&&b.date<=to)history.push({date:b.date,ts:b.ts,equity:rd(e,4),grossLeverage:rd(lev,4),units:pos?.units.length||0})}
 function exitUnits(i,b,toExit){
  if(!pos||!toExit.length)return;
  const p=pos;
  for(const x of toExit){
   const u=x.u,lev=x.level,fill=u.side===1?Math.min(b.o,lev)-SLIP:Math.max(b.ao,lev)+SLIP;
   const gross=u.side*u.qty*(fill-u.fill),exitFee=u.qty*fill*fee,profit=gross-exitFee;
   cash+=profit;p.pnl+=profit;p.exits.push({date:b.date,ts:b.ts,reason:x.reason,fill:rd(fill,3),qty:rd(u.qty,5),unitPnl:rd(profit,2)});
   p.units.splice(p.units.indexOf(u),1);closedUnitExits++;
  }
  if(!p.units.length){
   p.closed=true;
   trades.push({entry:p.start,exit:new Date(b.ts*1000).toISOString(),side:p.side,
    units:p.totalUnits,realAdds:p.adds,virtualRatchets:p.virtualSteps,pnl_usd:rd(p.pnl-p.entryFees,2),reasons:[...new Set(p.exits.map(x=>x.reason))],
    firstEntry:rd(p.firstEntry,3),lastExit:p.exits.at(-1)?.fill,
    unitExits:p.exits,priceBarsLastExitIndex:i});
   pos=null;
  }
 }
 function getEntryLevel(b,l){
  const upper=l.up[55]+.10,lower=l.down[55]-.10;
  const long=b.h>=upper,short=b.l<=lower;
  if(long===short)return null;
  const dir=long?1:-1;
  // Require NEW threshold crossing, not mere persistent prices beyond a level.
  if(priorBar){
   const old=dir===1?priorBar.c:priorBar.c;
   if(dir===1?old>upper:old<lower)return null;
  }
  return {side:dir,quote:long?upper:lower};
 }
 function newUnit(i,b,side,trigger,n,isAdd){
  if(!(n>0))throw Error('Bad N');
  const spread=Math.max(0,b.ao-b.o);
  const bidPx=side===1?Math.max(b.o,trigger):Math.min(b.o,trigger);
  const fill=side===1?Math.max(b.ao,bidPx+spread)+SLIP:bidPx-SLIP;
  const equity=equityAt(b),available=Math.max(0,LEV_CAP*equity-gross(b));
  const desiredQty=initial*RISK/n,maxQty=available/Math.max(1,fill);
  if(!(equity>0)||!(maxQty>=desiredQty*.25)){addBlocked++;return false}
  const qty=Math.min(desiredQty,maxQty);
  if(pos){
   for(const u of pos.units)u.stop+=side*.5*n;
  }else{
   pos={side,units:[],start:new Date(b.ts*1000).toISOString(),firstEntry:fill,totalUnits:0,
    adds:0,virtualSteps:0,entryFees:0,pnl:0,exits:[],nextAdd:null};
  }
  const stop=fill-side*2*n,entryFee=fill*qty*fee;
  pos.units.push({side,qty,fill,stop,n});pos.totalUnits++;pos.entryFees+=entryFee;cash-=entryFee;
  pos.nextAdd=fill+side*.5*n;
  if(isAdd){adds++;pos.adds++}else{entries++}
  tradeEvents.push({t:b.ts,kind:isAdd?'add':'entry',side,fill:rd(fill,2),n:rd(n,2),units:pos.totalUnits});
  return true;
 }
 const counted={tradeCandles:0,missingLevel:0};
 for(let i=first;i<=last;i++){
  const b=bars[i],lev=levels.get(b.fourKey);
  if(!lev){counted.missingLevel++;priorBar=b;continue}
  if(!(lev.knownUntil<b.ts&&lev.atr20>0))throw Error('Future function '+b.fourKey);
  counted.tradeCandles++;
  let exited=false;
  if(pos){
   const side=pos.side,ch=side===1?lev.exitLong[20]:lev.exitShort[20],closeArr=[];
   for(const u of [...pos.units]){
    const boundary=side===1?Math.max(u.stop,ch):Math.min(u.stop,ch);
    const touched=side===1?b.l<=boundary:b.ah>=boundary;
    if(touched)closeArr.push({u,level:boundary,reason:(side===1?ch>=u.stop:ch<=u.stop)?'20day_channel':'2N_stop'});
   }
   if(closeArr.length){exitUnits(i,b,closeArr);exited=true}
  }
  if(!pos&&!exited){
   const entry=getEntryLevel(b,lev);
   if(entry&&newUnit(i,b,entry.side,entry.quote,lev.atr20,false)){
     lastEntryIndex=i;
     // Unknown bid/ask path inside M5; pessimistically close on a crossed stop.
     const crossing=pos.units.filter(u=>u.side===1?b.l<=u.stop:b.ah>=u.stop);
     if(crossing.length){uncertainCount++;
      exitUnits(i,b,crossing.map(u=>({u,level:u.stop,reason:'entry_bar_stop_ambiguous'})));exited=true}
   }
  }
  if(pos&&!exited){
    let loops=0;
    while(pos&&pos.totalUnits<rule.maxUnits&&loops<500){
      const side=pos.side,trigger=pos.nextAdd;
      const touched=side===1?b.h>=trigger:b.l<=trigger;
      if(!touched)break;
      if(!newUnit(i,b,side,trigger,lev.atr20,true))break;
      loops++;
      const crossing=pos.units.filter(u=>u.side===1?b.l<=u.stop:b.ah>=u.stop);
      if(crossing.length){ambiguousAfterAdd++;
        exitUnits(i,b,crossing.map(u=>({u,level:u.stop,reason:'add_bar_stop_ambiguous'})));exited=true;break}
    }
    // Independent counterfactual control: no new units after 4, but every +0.5N further
    // favorable move ratchets existing stops by +0.5N.
    if(pos&&!exited&&rule.virtual&&pos.totalUnits>=4){
      let virtualLoops=0;
      while(pos&&virtualLoops<500){
        const side=pos.side,trigger=pos.nextAdd;
        if(!(side===1?b.h>=trigger:b.l<=trigger))break;
        for(const u of pos.units)u.stop+=side*.5*lev.atr20;
        pos.nextAdd=trigger+side*.5*lev.atr20;
        virtualSteps++;pos.virtualSteps++;virtualLoops++;
        const crossing=pos.units.filter(u=>u.side===1?b.l<=u.stop:b.ah>=u.stop);
        if(crossing.length){ambiguousAfterAdd++;exitUnits(i,b,crossing.map(u=>({u,level:u.stop,reason:'virtual_stop_bar_ambiguous'})));exited=true;break}
      }
    }
  }
  priorBar=b;mark(b);
 }
 const lastBar=bars[last],lastEquity=eq(lastBar),openPosition=pos?{side:pos.side,units:pos.units.length,totalUnits:pos.totalUnits,floatPnl:rd(lastEquity-cash,2),entryDate:pos.start}:null;
 // Do not force an artificial year-end exit; equity is always mark-to-market.
 if(forceClose&&pos){exitUnits(last,lastBar,pos.units.map(u=>({u,level:u.side===1?lastBar.c:lastBar.ac,reason:'study_end_forced'})));}
 const wins=trades.filter(x=>x.pnl_usd>0),loss=trades.filter(x=>x.pnl_usd<0),grossWin=wins.reduce((a,b)=>a+b.pnl_usd,0),grossLoss=-loss.reduce((a,b)=>a+b.pnl_usd,0);
 const yearly={},startEquityByYear={};
 let prevEquity=initial;
 for(const h of history){
  const y=h.date.slice(0,4);
  if(!yearly[y])yearly[y]={openEquity:prevEquity,high:prevEquity,lastEquity:h.equity,maxdd:0};
  const z=yearly[y];z.lastEquity=h.equity;z.high=Math.max(z.high,h.equity);z.maxdd=Math.max(z.maxdd,100*(1-h.equity/z.high));
  prevEquity=h.equity;
 }
 for(const y of Object.keys(yearly)){const z=yearly[y];z.returnPct=rd(100*(z.lastEquity/z.openEquity-1),2);z.maxdd=rd(z.maxdd,2);z.openEquity=rd(z.openEquity,2);z.lastEquity=rd(z.lastEquity,2)}
 return {variant:rule.name,from,to,initial,finalEquity:rd(lastEquity,2),returnPct:rd(100*(lastEquity/initial-1),2),maxDDPct:rd(maxdd,2),
  maxLeverage:rd(maxlev,2),maxUnitsHeld:maxunits,entries,adds,virtualSteps,blocked:addBlocked,ambiguousAfterAdd,
  uncertainEntryCount:uncertainCount,tradeCount:trades.length,wins:wins.length,winPct:trades.length?rd(100*wins.length/trades.length,1):null,
  grossProfit:rd(grossWin,2),grossLoss:rd(grossLoss,2),profitFactor:grossLoss>0?rd(grossWin/grossLoss,3):null,
  openPosition,yearly,firstLast:{firstDate:bars[first]?.date,lastDate:lastBar.date,firstTs:bars[first]?.ts,lastTs:lastBar.ts},
  trades,tradeEvents:tradeEvents.filter(x=>x.t>=Date.parse('2025-01-01T00:00:00Z')/1000).slice(-45),
  monthly:history.reduce((a,b)=>{const m=b.date.slice(0,7);a[m]=b.equity;return a},{}),diagnostics:counted};
}
async function main(){
 const years=[2019,2020,2021,2022,2023,2024,2025];
 console.log('FETCH_BEGIN',new Date().toISOString());
 const all=await Promise.all(years.map(async y=>{const d=await getYear(y);return {y,...d}}));
 const meta={};
 for(const r of all){const q=quality(r.rows);meta[r.y]={rows:r.rows.length,compressed_bytes:r.compressed_bytes,median_spread:q.median_open_spread_usd,
   p95_spread:q.p95_open_spread_usd,negative_spread:q.spread_negative,dup:q.duplicate,invalid:q.invalid,
   timestamps:[r.rows[0]?.ts,r.rows.at(-1)?.ts]};if(q.invalid||q.duplicate||q.chronology_violations||q.spread_negative>200)throw Error('Bad source '+r.y+' '+JSON.stringify(q))}
 const bars=all.flatMap(x=>x.rows).sort((a,b)=>a.ts-b.ts);
 const aggregated=getFourHourLevels(bars),levels=aggregated.levels;
 if(bars.length<450000||levels.size<1000)throw Error('Not enough M5 4H coverage');
 console.log('AGGREGATION',JSON.stringify(Object.fromEntries(Object.entries(aggregated).filter(([x])=>x!=='levels'))));
 const results={continuous:{},annualReset:{}};
 for(const rule of variants){
  results.continuous[rule.name]=simulation(bars,levels,'2020-01-01','2025-12-31',rule);
  for(let y=YEAR_START;y<=YEAR_END;y++){
   results.annualReset[y]??={};
   results.annualReset[y][rule.name]=simulation(bars,levels,y+'-01-01',y+'-12-31',rule);
  }
  console.log('COMPLETE',rule.name,results.continuous[rule.name].returnPct,results.continuous[rule.name].maxDDPct);
 }
 const output={status:'XAUUSD spot M5 Dukascopy-derived proxy; not COMEX real futures execution',
  rulesFrozenBeforeNewHistoricalRun:true,generatedUtc:new Date().toISOString(),quote_source:'evtradelabs XAUUSD M5 bid/ask JSON.gz 2019-2025',
  dataQuality:meta,allBars:bars.length,fourHourAggregate:Object.fromEntries(Object.entries(aggregated).filter(([x])=>x!=='levels')),
  assumptions:{entry:'S2 55 full prior NY17 anchored 4 HOUR candles HH/LL break, fresh crossing',exit:'S2 20 full prior NY17 anchored 4 HOUR candles opposite channel',
  n:'Wilder N using prior completed 4 HOUR candle only',adds:'each added unit after 0.5N favorable bid price move (symmetric short)',
  stops:'individual 2N stops ratcheted 0.5N whenever real add; virtual group continues ratchet every further 0.5N without opening additional units',
  account:'Synthetic divisible spot gold ounces, $10k initial/yearly reset; fixed initial account exposure per N, NOT integer COMEX 100oz futures contracts',
  tradeCosts:'Observed bid/ask per 5minute bar + $'+SLIP+'/oz per side slippage + '+FEE_BPS+'bps per side fee (illustrative not historical real broker)',
  leverage:'gross quote notional at entry <= '+LEV_CAP+' times current account equity, check before new order; no maintenance margin liquidation',riskPerN:RISK,
  noForcedYearEndExit:true,entryDefinition:'new crossing relative prior 5minute bid close avoids repeated entry solely for persistent above-channel quotes',
  ambiguity:'if the same 5minute bid-ask bar can trigger add AND stopped old/new units, conservative stop-first immediate post-add mark',
  general:'2026 hourly futures model separately, not comparable as same spot execution/time granularity'},
  results};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_TURTLE_2020_2025_H4_UNLIMITED_VS_TRAIL_REPLAY.json',JSON.stringify(output,null,2));
 const summary=['period,variant,from,to,trades,wins,win_pct,entries,adds,virtual_ratchets,max_units,final_usd,return_pct,maxdd_pct,max_gross_leverage,profit_factor,open_units,ambiguities'];
 for(const [k,z] of Object.entries(results.continuous)){summary.push(['continuous_2020_2025',k,z.from,z.to,z.tradeCount,z.wins,z.winPct,z.entries,z.adds,z.virtualSteps,z.maxUnitsHeld,z.finalEquity,z.returnPct,z.maxDDPct,z.maxLeverage,z.profitFactor,z.openPosition?.units||0,z.ambiguousAfterAdd].join(','))}
 for(let y=2020;y<=2025;y++)for(const [k,z] of Object.entries(results.annualReset[y])){
   summary.push(['year_reset_'+y,k,z.from,z.to,z.tradeCount,z.wins,z.winPct,z.entries,z.adds,z.virtualSteps,z.maxUnitsHeld,z.finalEquity,z.returnPct,z.maxDDPct,z.maxLeverage,z.profitFactor,z.openPosition?.units||0,z.ambiguousAfterAdd].join(','))}
 fs.writeFileSync('research-data/GOLD_TURTLE_2020_2025_H4_UNLIMITED_VS_TRAIL_SUMMARY.csv',summary.join('\n')+'\n');
 const trades=['mode,period,variant,entry,exit,side,units,adds,virtual_ratchets,pnl_usd,exit_reasons'];
 for(const [k,z] of Object.entries(results.continuous))for(const t of z.trades)trades.push(['continuous','2020-2025',k,t.entry,t.exit,t.side,t.units,t.realAdds,t.virtualRatchets,t.pnl_usd,t.reasons.join('|')].join(','));
 fs.writeFileSync('research-data/GOLD_TURTLE_2020_2025_H4_UNLIMITED_VS_TRAIL_TRADES.csv',trades.join('\n')+'\n');
 console.log('DATA_QUALITY',JSON.stringify(meta));
 console.log('CONTINUOUS_ANNUAL',JSON.stringify(Object.fromEntries(Object.entries(results.continuous).map(([k,v])=>[k,{yearly:v.yearly,final:v.finalEquity,return:v.returnPct,maxDD:v.maxDDPct,completed:v.tradeCount,adds:v.adds,maxUnits:v.maxUnitsHeld,maxLev:v.maxLeverage}]))));
 console.log('SUMMARY\n'+summary.join('\n'));
}
main().catch(e=>{console.error('FATAL',e.stack||e);process.exitCode=1});
