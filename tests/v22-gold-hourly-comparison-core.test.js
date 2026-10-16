const assert=require('node:assert/strict');
const {prepareHourly,simulate,make1hRetest,signals1h,signals4h,runThreeWay,countedATR1h,locateHourly}=require('../lib/endpoints/v22-gold-hourly-comparison-core');
const T=Date.parse('2025-06-02T00:00:00Z'),H=3600000;
const bars=[];
for(let day=0;day<130;day++){
 for(let k=0;k<20;k++){
  const t=T+day*24*H+k*H,p=3000+day*.2+50*Math.sin(day/11)+2*Math.sin(k/3);
  bars.push({start_ms:t,open:p,high:p+3,low:p-3,close:p+Math.sin(k)});
 }
}
const base=prepareHourly(bars,T+131*24*H);
assert.equal(base.bars.length,bars.length);
assert.equal(base.audit.invalid,0);
assert.equal(base.audit.duplicates,0);
assert.equal(locateHourly(base.bars,base.bars[10].start_ms),10);
assert(Number.isFinite(countedATR1h(base.bars,35)));
assert.equal(countedATR1h(base.bars,20),null,'Cross-day 4-hour market session gap must invalidate 1h ATR lookback');
const malicious=prepareHourly([...bars,bars[50],{...bars[51],high:bars[51].close-100}],T+131*24*H);
assert(malicious.audit.invalid>0);assert(malicious.audit.duplicates>0);
const eIdx=90,ev={entry_index:eIdx,entry_utc:new Date(bars[eIdx].start_ms).toISOString(),known_at_ms:bars[eIdx-1].close_ms,
 dir:'long',stop_width:5,atr4:5,atr1:3,signal_type:'fixed_test',market_entry:true,limit_entry:false};
const sim=simulate(base.bars,[ev],{startMs:bars[80].start_ms,initialCash:10000,costBps:10,maxLeverage:5,riskFraction:.005,stopDurationHours:60});
assert.equal(sim.trades,1);assert(sim.trade_ledger[0].entry_utc===ev.entry_utc);
assert(sim.trade_ledger[0].why_closed!=='');
assert(sim.max_mark_to_market_drawdown_pct>=0);
const biggerFees=simulate(base.bars,[ev],{startMs:bars[80].start_ms,initialCash:10000,costBps:30,maxLeverage:5,riskFraction:.005,stopDurationHours:60});
assert(biggerFees.final_usd<=sim.final_usd+1);
assert.throws(()=>simulate(base.bars,[{...ev,known_at_ms:bars[eIdx+1].close_ms}],{startMs:bars[80].start_ms}),/authorization/);
const retest=make1hRetest({b1Events:[ev],hourly:base.bars,waitHours:4,limitFracATR1:.35});
assert.equal(retest.candidates.length,1);
assert(retest.candidates[0].limit_px<bars[eIdx].open);
const pendingNoFill=simulate(base.bars,[{...ev,market_entry:false,limit_entry:true,limit_px:100,wait_bars:4}],{startMs:bars[80].start_ms});
assert.equal(pendingNoFill.trades,0);assert.equal(pendingNoFill.counts.unfilled_limit_expirations,1);
const pendingYes=simulate(base.bars,[{...ev,market_entry:false,limit_entry:true,limit_px:bars[eIdx].open-.2,wait_bars:4}],{startMs:bars[80].start_ms});
assert.equal(pendingYes.trades,1);assert.equal(pendingYes.counts.limit_filled,1);
const four=[];
for(let day=0;day<130;day++)for(let j=0;j<5;j++){
 const slice=bars.slice(day*20+j*4,day*20+j*4+4),first=slice[0],last=slice.at(-1);
 four.push({session_date:new Date(T+day*24*H).toISOString().slice(0,10),slot:j,start_ms:first.start_ms,close_ms:last.start_ms+H,open:first.open,high:Math.max(...slice.map(x=>x.high)),low:Math.min(...slice.map(x=>x.low)),close:last.close});
}
const result=runThreeWay({hourly:base.bars,four,startDate:'2025-08-01'});
assert.equal(result.status,'1h_three_way_common_hourly_fill_research');
for(const out of Object.values(result.result))assert(Number.isFinite(out.return_pct)&&out.trades>=0&&out.max_mark_to_market_drawdown_pct>=0);
assert(result.candidates.B1.raw_patterns>=0);
assert(result.candidates.B2.confirmed_1h>=0);
assert(result.candidates.B3.b1_qualified_events===result.candidates.B1.accepted);
console.log('1h B1/B2/B3 causal signals, next hourly open, prior ATR4 equal stop, 4h anchor retest fills/expiries and fees tested');
