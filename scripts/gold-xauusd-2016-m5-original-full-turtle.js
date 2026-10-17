// Single-gold-market 2016 Turtle full mechanics based on Curtis Faith's original rules.
// 2015 warmup, 2016 actual M5 bid/ask quote execution; original GC futures fills unavailable.
// System1 previous-breakout phantom score, 55-day fail-safe, System2 unfiltered,
// +0.5N pyramids up to 4, 2N unit stops ratcheted +0.5N with adds,
// 10/20-day channel exits, 1N =1% notional sizing, 10%-loss->20%-notional reduction.
// 1M integer 100oz GC unit is an implementation size-sensitivity, NOT actual CME tape.
const fs=require('node:fs');
const {getYear,quality,dailyBars,getDailyLevels}=require('./gold-xauusd-2016-m5-turtle-audit');
const rd=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
const DAY=86400000;
function qtime(s){return new Date(s*1000).toISOString()}
const floorTo=(x,precision=1e10)=>Math.floor(x*precision+1e-8)/precision;
function prepShadow(bars,levels){
 let lastWinner=false,shadow=null,won=0,lost=0,signals=0,skipped=0,shadowsFinished=[],allow=new Int8Array(bars.length),breakoutSide=new Int8Array(bars.length),shadowState=new Int8Array(bars.length);
 for(let i=0;i<bars.length;i++){
  const bar=bars[i],lvl=levels.get(bar.session);
  if(!lvl){shadowState[i]=lastWinner?1:0;continue}
  if(shadow){
   const stop=shadow.side===1?bar.l<=shadow.stop:bar.h>=shadow.stop;
   const exitLevel=shadow.side===1?lvl.exitLong[10]:lvl.exitShort[10];
   const chan=shadow.side===1?bar.l<=exitLevel:bar.h>=exitLevel;
   if(stop||chan){
    const exit=stop?shadow.stop:exitLevel;
    const profit=shadow.side*(exit-shadow.entry)>0;
    if(profit)won++;else lost++;
    lastWinner=profit;
    shadowsFinished.push({entry:shadow.date,exit:bar.session,won:profit,reason:stop?'2N_stop':'10d_exit'});
    shadow=null;
   }
  }
  shadowState[i]=lastWinner?1:0;
  // Never open and close phantom twice in one 5minute bar.
  const high=lvl.up[20]+.1,low=lvl.down[20]-.1;
  const buy=bar.h>=high,sell=bar.l<=low;
  if(!shadow&&buy!==sell&&(buy||sell)){
   const side=buy?1:-1,entry=side===1?Math.max(bar.o,high):Math.min(bar.o,low);
   // Signals always tracked, even when S1 would have skipped.
   allow[i]=lastWinner?0:1;breakoutSide[i]=side;signals++;
   if(lastWinner)skipped++;
   shadow={side,entry,stop:entry-side*2*lvl.atr20,date:bar.session};
   // Do not use same-bar unknown sequence to resolve phantom by seeing adverse stop.
  }
 }
 return {allow,breakoutSide,shadowState,meta:{phantom_count:signals,winners:won,losers:lost,skipped_prev_win:skipped,unfinished:!!shadow,examples:shadowsFinished.slice(-12)}};
}
function backtest(bars,dayLevels,shadow,config){
 const begin=bars.findIndex(b=>b.date>='2016-01-01'),end=bars.findLastIndex(b=>b.date<='2016-12-31');
 const initial=config.initial,integer=config.integer,system=config.strategy,fee=config.slip??.05,limitUnit=4;
 const units=[],campaigns=[],activities=[];
 let cash=initial,cycle=0,tradeId=0,adds=0,exits=0,skips=0,rejections=0,unfilled=0;
 let notional=initial,reductionSteps=0,thresholdDrop=initial*.1,peak=initial,maxDd=0,marginPeak=0,leverPeak=0,markEqs=[],lastCloseIndex=-Infinity;
 const availFunds=()=>notional;
 const priceBid=b=>b.o,priceAsk=b=>b.ao;
 const askOpen=b=>b.ao,askHigh=b=>b.ah;
 function active(sys){return units.filter(u=>u.sys===sys)}
 function campaign(sys){return campaigns.findLast(x=>x.sys===sys&&!x.closed)}
 function totalRiskUnreal(b){
  const mid=b.c,spread=b.ac-b.c;
  return cash+units.reduce((s,u)=>s+(u.side===1?b.c-u.entry:u.entry-(b.c+Math.max(0,spread)))*u.qty,0);
 }
 function checkDrawdown(b){
  const equity=totalRiskUnreal(b);
  while(reductionSteps<9&&equity<=initial-thresholdDrop){
   reductionSteps++;
   notional=initial*Math.pow(.8,reductionSteps);
   thresholdDrop+=.1*notional;
  }
  if(equity>=initial&&reductionSteps){reductionSteps=0;notional=initial;thresholdDrop=initial*.1;}
  peak=Math.max(peak,equity);maxDd=Math.max(maxDd,100*(1-equity/peak));
  marginPeak=Math.max(marginPeak,units.reduce((s,u)=>s+u.qty*(b.c||b.o),0));
  leverPeak=Math.max(leverPeak,units.reduce((s,u)=>s+u.qty*b.c,0)/Math.max(equity,1));
  markEqs.push({ts:b.ts,equity});
 }
 function unitQuantity(n,frac){
  const oz=frac*availFunds()*.01/n;
  if(integer)return Math.floor(oz/100)*100;
  return oz;
 }
 const fillEntry=(bar,level,side)=>{
  if(side===1){const spread=bar.ao-bar.o;return Math.max(bar.ao,level+Math.max(spread,0))+fee}
  return Math.min(bar.o,level)-fee;
 };
 const fillExit=(bar,level,side)=>{
  if(side===1)return Math.min(bar.o,level)-fee;
  return Math.max(bar.ao,level)+fee;
 };
 function addUnit(i,sys,side,level,n,frac,reason){
  const bar=bars[i],qty=unitQuantity(n,frac),existing=active(sys),campaignRun=campaign(sys);
  if(units.length>=limitUnit){rejections++;return false}
  if(!(n>0&&qty>0&&Number.isFinite(qty))){unfilled++;return false}
  const entry=fillEntry(bar,level,side);
  // Tighten every previous stop by precisely +0.5N per added unit; never loosen.
  for(const u of existing)u.stop=side===1?Math.max(u.stop,u.stop+.5*n):Math.min(u.stop,u.stop-.5*n);
  const stop=entry-side*2*n;
  const unit={id:++tradeId,sys,side,qty,entry,stop,n,entryIndex:i,time:qtime(bar.ts),closed:false};
  units.push(unit);
  if(!campaignRun){
   campaigns.push({sys,side,entry:qtime(bar.ts),entryDate:bar.session,number:0,initialUnitN:n,
    gross_pnl:0,closed:false,entryCount:0,addCount:0,maximumUnits:0,exitReasons:[],unitLedger:[],total_oz:0,firstEntryPx:entry});
  }
  const c=campaign(sys);c.entryCount++;c.number++;c.addCount+=reason==='add'?1:0;c.maximumUnits=Math.max(c.maximumUnits,active(sys).length);
  c.total_oz+=qty;
  c.lastFillPx=entry;c.lastFillN=n;c.nextAdd=entry+side*.5*n;
  if(reason==='add')adds++;
  activities.push({kind:reason,sys,ts:qtime(bar.ts),entry:rd(entry),stop:rd(stop),unit_oz:rd(qty),n:rd(n),units_total:units.length,equity_before:rd(totalRiskUnreal(bar),2)});
  return true;
 }
 function closeUnit(i,u,price,why){
  const bar=bars[i],c=campaign(u.sys);
  const pnl=u.side*u.qty*(price-u.entry);
  cash+=pnl;
  c.gross_pnl+=pnl;
  c.unitLedger.push({side:u.side,qty:rd(u.qty),entry:u.time,entryPx:rd(u.entry),exit:qtime(bar.ts),exitPx:rd(price),pnl:rd(pnl,2),reason:why});
  c.exitReasons.push(why);
  const idx=units.indexOf(u);if(idx<0)throw Error('Unit missing');units.splice(idx,1);
  activities.push({kind:'exit',sys:u.sys,ts:qtime(bar.ts),reason:why,price:rd(price),unit_oz:rd(u.qty),pnl_usd:rd(pnl,2)});
  exits++;
  if(active(u.sys).length===0){
   c.closed=true;c.exit=qtime(bar.ts);c.exitDate=bar.session;c.pnl_usd=rd(c.gross_pnl,2);c.winner=c.gross_pnl>0;
   c.final_equity=rd(cash,2);lastCloseIndex=i;
  }
 }
 function exitAll(i,sys,at,why){
  const selected=active(sys);
  for(const u of selected)closeUnit(i,u,fillExit(bars[i],at,u.side),why);
 }
 function existingExits(i,lvl){
  const b=bars[i],systems=[...new Set(units.map(x=>x.sys))];
  for(const sys of systems){
   const group=active(sys);if(!group.length)continue;
   const side=group[0].side,exitN=sys==='S2'?20:10;
   const ch=side===1?lvl.exitLong[exitN]:lvl.exitShort[exitN];
   const priceTouch=u=>u.side===1?b.l<=u.stop:b.ah>=u.stop;
   const hitStop=group.filter(priceTouch);
   if(hitStop.length){
    for(const u of hitStop){
     const lev=side===1?Math.min(b.o,u.stop):Math.max(b.ao,u.stop);
     closeUnit(i,u,fillExit(b,lev,side),'2N_unit_stop');
    }
   }
   if(!active(sys).length)continue;
   if(Number.isFinite(ch)&&(side===1?b.l<=ch:b.ah>=ch)){
    const lev=side===1?Math.min(b.o,ch):Math.max(b.ao,ch);
    exitAll(i,sys,lev,'opposite_'+exitN+'d_channel');
   }
  }
 }
 function eligiblePlans(i,lvl){
  const b=bars[i],plans=[];
  const breakDirection=(n)=>{const buy=b.h>=lvl.up[n]+.1,short=b.l<=lvl.down[n]-.1;return buy===short?0:buy?1:-1};
  if(config.strategy==='S1'||config.strategy==='MIX'){
   if(!active('S1').length){
    // Source of truth: shadow breakout event, including those not executed.
    if(shadow.breakoutSide[i]&&shadow.allow[i]){
     const side=shadow.breakoutSide[i],lvlEntry=side===1?lvl.up[20]+.1:lvl.down[20]-.1;
     plans.push({sys:'S1',side,price:lvlEntry,label:'20d_filtered_entry'});
    }
    // S1 55-day fail-safe only when previous S1 breakout is a winner;
    // for mixed S1+S2 standalone S2 always takes a 55-day breakout.
    if(config.strategy==='S1'&&shadow.shadowState[i]===1){
     let side=breakDirection(55);if(side)plans.push({sys:'S1',side,price:side===1?lvl.up[55]+.1:lvl.down[55]-.1,label:'55d_failsafe'});
    }
   }
  }
  if(config.strategy==='S2'||config.strategy==='MIX'){
   if(!active('S2').length){
    let side=breakDirection(55);
    if(side)plans.push({sys:'S2',side,price:side===1?lvl.up[55]+.1:lvl.down[55]-.1,label:'55d_unfiltered'});
   }
  }
  return plans;
 }
 const fullDayMap=new Map(dayLevels);
 for(let i=begin;i<=end;i++){
  const b=bars[i],lvl=fullDayMap.get(b.session);
  if(!lvl){checkDrawdown(b);continue}
  // Fixed precedence: stops, opposite 10/20-day exits, then pyramid adds,
  // then new entries. No re-entry on a stop/exit candle.
  const stoppedSystems=new Set();
  for(const u of [...units]){
   const hit=u.side===1?b.l<=u.stop:b.ah>=u.stop;
   if(hit)stoppedSystems.add(u.sys);
  }
  for(const sys of new Set(units.map(x=>x.sys))){
   const ex=active(sys)[0],n=sys==='S2'?20:10,level=ex.side===1?lvl.exitLong[n]:lvl.exitShort[n];
   if(Number.isFinite(level)&&(ex.side===1?b.l<=level:b.ah>=level))stoppedSystems.add(sys);
  }
  existingExits(i,lvl);
  const closedOnThisBar=new Set(campaigns.filter(c=>c.closed&&c.exit===qtime(b.ts)).map(c=>c.sys));
  for(const sys of ['S1','S2']){
   if(closedOnThisBar.has(sys)||stoppedSystems.has(sys))continue;
   let campaignRun=campaign(sys),u=active(sys),count=0;
   while(campaignRun&&u.length&&units.length<limitUnit&&count<3){
    const n=lvl.atr20,side=campaignRun.side,price=campaignRun.nextAdd;
    const hit=side===1?b.ah>=price:b.l<=price;
    if(!hit)break;
    if(addUnit(i,sys,side,price,n,sys==='S2'?(config.strategy==='MIX'?.5:1):(config.strategy==='MIX'?.5:1),'add')){
     count++;u=active(sys);campaignRun=campaign(sys);
     // Conservative when stop is inside same 5m bar: assume adverse reversal can stop us.
     const hitAny=u.some(x=>x.side===1?b.l<=x.stop:b.ah>=x.stop);
     if(hitAny){
      for(const x of [...active(sys)]){
       if(x.side===1?b.l<=x.stop:b.ah>=x.stop)closeUnit(i,x,fillExit(b,x.stop,x.side),'same_5m_add_then_stop');
      }
      closedOnThisBar.add(sys);break;
     }
    }else break;
   }
  }
  const plans=eligiblePlans(i,lvl);
  for(const plan of plans){
   if(closedOnThisBar.has(plan.sys)||stoppedSystems.has(plan.sys)||active(plan.sys).length)continue;
   const count=units.length;if(count>=limitUnit){rejections++;continue}
   const sz=config.strategy==='MIX'?.5:1;
   if(addUnit(i,plan.sys,plan.side,plan.price,lvl.atr20,sz,'entry')){
    const activeUnits=active(plan.sys);
    for(const x of [...activeUnits]){
     if(x.side===1?b.l<=x.stop:b.ah>=x.stop){
      closeUnit(i,x,fillExit(b,x.stop,x.side),'same_5m_entry_then_stop');
      closedOnThisBar.add(plan.sys);
     }
    }
    // Original rules allow multiple additional units in one session or even in one
    // sufficiently wide 5m bar. If first entry survived its own bar, allow adds
    // against only contemporaneous OHLC; pessimistically stop after a same-bar add.
    let count=0;
    while(!closedOnThisBar.has(plan.sys)&&active(plan.sys).length&&units.length<limitUnit&&count<3){
     const live=campaign(plan.sys),level=live.nextAdd,side=plan.side;
     if(!(side===1?b.ah>=level:b.l<=level))break;
     if(!addUnit(i,plan.sys,side,level,lvl.atr20,sz,'add'))break;
     count++;
     const hit=active(plan.sys).filter(u=>u.side===1?b.l<=u.stop:b.ah>=u.stop);
     for(const u of hit)closeUnit(i,u,fillExit(b,u.stop,u.side),'same_5m_entry_add_stop');
     if(hit.length)closedOnThisBar.add(plan.sys);
    }
   }
  }
  checkDrawdown(b);
 }
 // mark out open positions at final available quote -- this is evaluation-period liquidation
 const endBar=bars[end];
 for(const u of [...units])closeUnit(end,u,fillExit(endBar,u.side===1?endBar.c:endBar.ac,u.side),'forced_2016_end');
 markEqs[markEqs.length-1]={ts:endBar.ts,equity:cash};
 const finished=campaigns.filter(x=>x.closed),wins=finished.filter(x=>x.pnl_usd>0),losses=finished.filter(x=>x.pnl_usd<0),
 sum=a=>a.reduce((s,x)=>s+x.pnl_usd,0),profit=sum(wins),loss=-sum(losses);
 const output={strategy:system,capital_initial:initial,contract_size_oz:integer?100:null,notional_risk_per_1N:'.01 x starting notional adjusted after >10% equity falls', 
  trades:finished.length,unit_entries:finished.reduce((s,x)=>s+x.entryCount,0),added_units:adds,
  win_trades:wins.length,hit_pct:finished.length?rd(100*wins.length/finished.length,1):null,
  ending_balance:rd(cash,2),net_return_pct:rd(100*(cash/initial-1),2),max_drawdown_pct:rd(maxDd,2),profit_factor:loss>0?rd(profit/loss):null,
  max_gross_notional_usd:rd(marginPeak),max_notional_leverage:rd(leverPeak),rejected_due_to_4unit_cap:rejections,unfilled_due_to_contract_size:unfilled,
  downsize_steps:reductionSteps,units_remaining:units.length,closed_campaigns:finished.map(x=>({system:x.sys,side:x.side,entry:x.entry,exit:x.exit,adds:x.addCount,units:x.entryCount,maxUnits:x.maximumUnits,
   pnl_usd:rd(x.pnl_usd,2),start_px:rd(x.firstEntryPx),end_equity:rd(x.final_equity,2),reason:x.exitReasons.at(-1)})),
  events:activities};
 return output;
}
async function main(){
 const [warm,year]=await Promise.all([getYear(2015),getYear(2016)]);
 const bars=[...warm.rows,...year.rows],days=dailyBars(bars),levels=getDailyLevels(days),shadow=prepShadow(bars,levels);
 const configs=[
  {name:'S1_20day_filter_failsafe_4units_10k_fractional',initial:10000,strategy:'S1',integer:false},
  {name:'S2_55day_4units_10k_fractional',initial:10000,strategy:'S2',integer:false},
  {name:'MIX_50_50_market_cap4_10k_fractional',initial:10000,strategy:'MIX',integer:false},
  {name:'S1_20day_filter_failsafe_4units_1m_standard_GC',initial:1000000,strategy:'S1',integer:true},
  {name:'S2_55day_4units_1m_standard_GC',initial:1000000,strategy:'S2',integer:true},
  {name:'MIX_50_50_market_cap4_1m_standard_GC',initial:1000000,strategy:'MIX',integer:true}
 ];
 const all={};
 for(const c of configs){const o=backtest(bars,levels,shadow,c);all[c.name]=o;console.log('RESULT',c.name,'campaigns',o.trades,'unit entries',o.unit_entries,'adds',o.added_units,
  'wins',o.hit_pct,'net',o.net_return_pct,'maxDD',o.max_drawdown_pct,'balance',o.ending_balance,'maxlev',o.max_notional_leverage,
  'rejections',o.rejected_due_to_4unit_cap,'unfilled',o.unfilled_due_to_contract_size)}
 const source={year2015_count:warm.rows.length,year2016_count:year.rows.length,year2016_quality:quality(year.rows),
  trading_sessions_2016:days.filter(x=>x.date>='2016-01-01'&&x.date<='2016-12-31').length,
  source_2016:'https://evtradelabs.com/api/simulator/data/XAUUSD/M5/2016.json.gz',
  source_2015:'https://evtradelabs.com/api/simulator/data/XAUUSD/M5/2015.json.gz'};
 const trimmed=Object.fromEntries(Object.entries(all).map(([name,val])=>[name,{...val,events:undefined}]));
 const summary={created_utc:new Date().toISOString(),status:'turtle_original_market_mechanics_2016_gold_spot_proxy_not_actual_futures_fills',
  audited_source:'Curtis Faith Way of the Turtle bonus chapter Original Turtle Trading Rules pp 255-269',
  original_full_rule_limitations:['The actual original systems are diversified across approximately 20 markets; gold-only cannot reproduce portfolio diversification',
   'Original traders had discretion to allocate 100% S1 or S2 or 50/50, so all three were modeled',
   'One US$1m simulation uses hypothetical standard 100oz gold futures lot on spot historical bid/ask quotes, not COMEX executable tape',
   '10k nominal original risk is NOT executable as standard 100oz gold contracts; shown as fractional ounce exposure proxy only',
   'CME GC tick 0.1 used for the break levels but Dukascopy spot quotes have 0.01 pricing; contract-matching and spot/futures basis not accounted for',
   '5m bars are not ticks; same-bar ordering may produce pessimistic fills, futures slippage on liquidation may exceed modeled $0.05/oz',
   'Notional drawdown reduction 10%-20% included by modeled exposure adjustment, not the historical subjective annual reassessment of account size',
   'S1 breakout win/loss shadow follows prior 20d event until its stop/10d exit; some same-bar phantom ambiguity remains',
   'No the optional Whipsaw 0.5N stop alternative, because it was a separately selectable original variant, not the base rule',
   'No historical trading commissions, exchange margin rules or daily financing; bid-ask spread and 0.05 USD/oz per-side slippage modeled'],
  modeling:{breakout_tick:0.1,source_spread:'historical bid/ask OHLC',slippage_per_side_oz:0.05,unit_1N_fraction_of_account:0.01,max_units_per_gold:4,
    add_on_every_0_5N:true,initial_and_add_on_stops_2N:true,prior_stops_tighten_0_5N_with_add:true,shadow_prior_breakout_winner_filter:true,
    S1_system:'20d filtered when prior breakout won, 55d fail safe, 10d exit',
    S2_system:'unfiltered 55d entry, 20d exit',
    MIX:'50/50 notional allocation S1 and S2 with shared four-unit cap gold',
    account_size_reduction:'notional unit size down 20% each 10% equity loss threshold',
    warmup_shadow_full2015:true,entry_exit_5minute_bars:true,holidays_NY17_session:true},
  source,shadow:shadow.meta,variants:trimmed};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_M5_TURTLE_ORIGINAL_FULL_RESULTS.json',JSON.stringify(summary,null,2));
 const header=['variant','starting_usd','units_start','trades','unit_entries','added_units','wins','hit_pct','ending_usd','return_pct','maxdd_pct','profit_factor','max_leverage','unit_cap_reject','minimum_lot_unfilled'];
 const rows=[header.join(',')];
 for(const [name,x] of Object.entries(all))rows.push([name,x.capital_initial,x.contract_size_oz||'fractional',x.trades,x.unit_entries,x.added_units,x.win_trades,x.hit_pct,x.ending_balance,x.net_return_pct,x.max_drawdown_pct,x.profit_factor,x.max_notional_leverage,x.rejected_due_to_4unit_cap,x.unfilled_due_to_contract_size].join(','));
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_M5_TURTLE_ORIGINAL_FULL_SUMMARY.csv',rows.join('\n')+'\n');
 const led=['variant,system,entry,exit,side,initial_entry,unit_count,added_units,pnl_usd,balance_usd,exit_reason'];
 for(const [name,x] of Object.entries(all))for(const t of x.closed_campaigns)led.push([name,t.system,t.entry,t.exit,t.side,t.start_px,t.units,t.adds,t.pnl_usd,t.end_equity,t.reason].join(','));
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_M5_TURTLE_ORIGINAL_FULL_TRADELEDGER.csv',led.join('\n')+'\n');
 for(const [name,x] of Object.entries(all)){if(name.includes('10k_fractional'))console.log('CAMPAIGNS',name,JSON.stringify(x.closed_campaigns))}
 console.log('SHADOW',JSON.stringify(shadow.meta));
 console.log('SOURCE',JSON.stringify({bar2015:source.year2015_count,bar2016:source.year2016_count,sessions:source.trading_sessions_2016}));
}
main().catch(e=>{console.error('FATAL',e.stack||e);process.exitCode=1});
