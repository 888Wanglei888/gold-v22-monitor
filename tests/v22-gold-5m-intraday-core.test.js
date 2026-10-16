const assert=require('node:assert/strict');
const {clean5m,features,signals,simulator,evaluateIntraday,etParts}=require('../lib/endpoints/v22-gold-5m-intraday-core');
const TF=300000,start=Date.parse('2026-09-14T00:00:00Z');
const raw=[];
for(let i=0;i<1450;i++){
 const t=start+i*TF,base=4100+.035*i+9*Math.sin(i/17)+3*Math.sin(i/3);
 raw.push({start_ms:t,open:base,close:base+Math.sin(i/4),high:base+4,low:base-4,volume:100+i%21});
}
raw.push({...raw[20]});raw.push({...raw[31],close:99999});raw.push({start_ms:start+1450*TF,open:1,close:1,high:1,low:1});
const normalized=clean5m(raw,start+1449*TF+TF);
assert(normalized.bars.length>=1449);
assert.equal(normalized.quality.excluded.duplicate>=2,true);
assert.equal(normalized.quality.excluded.unclosed,1);
assert.equal(etParts(Date.parse('2026-09-14T12:00:00Z')).minute,480);
const f=features(normalized.bars,normalized.contiguous);
assert(Number.isFinite(f.atr14[100]));
const s=signals(normalized);
assert.deepEqual(Object.keys(s.all),[
 'NY_opening_range_30m_breakout','EMA20_EMA60_5m_pullback','prior_12bar_channel_breakout','Bollinger24_2sigma_mean_revert'
]);
for(const arr of Object.values(s.all))for(const x of arr){
 assert(x.signal_closed_at_ms<=x.entry_at_ms);
 assert.equal(x.entry_index,x.signal_index+1);
 assert.equal(normalized.bars[x.signal_index].close_ms,x.entry_at_ms);
 const ny=normalized.et[x.entry_index];assert(ny.minute>=510&&ny.minute<780);
}
const candidateIndex=normalized.et.findIndex((x,i)=>x.minute===600&&i>100&&i<normalized.bars.length-50);
assert(candidateIndex>=0);
const event={signal_index:candidateIndex-1,entry_index:candidateIndex,dir:'long',
 signal_closed_at_ms:normalized.bars[candidateIndex-1].close_ms,
 entry_at_ms:normalized.bars[candidateIndex].start_ms,atr5m:3,stop_width:5,target_R:1.5,
 entry_session_date:normalized.et[candidateIndex].date,source:'synthetic_test'};
const one=simulator(normalized,[event],{costBpsRoundTrip:10});
assert.equal(one.executed_trades,1);
assert(one.trade_ledger[0].entry_utc===new Date(event.entry_at_ms).toISOString());
assert(one.trade_ledger[0].exit_utc>one.trade_ledger[0].entry_utc);
const higherFee=simulator(normalized,[event],{costBpsRoundTrip:35});
assert(higherFee.end_equity_usd<=one.end_equity_usd+1);
assert.throws(()=>simulator(normalized,[{...event,entry_index:event.signal_index}]),/Future-knowledge/);
const x=evaluateIntraday(normalized);
assert(x.valid_NY_opening_ranges>=1);
for(const z of Object.values(x.strategies)){
 assert(Number.isFinite(z.end_equity_usd)&&Number.isFinite(z.return_pct));
 assert(z.executed_trades<=z.engine_counters.attempted_signal_entries);
}
console.log('5m real closed-bar signals, timezone session, following-open entry, stop-first fees and one-trade tests passed');
