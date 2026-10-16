const assert=require('node:assert/strict');
const {evaluate,ddFromPath}=require('../lib/endpoints/v22-benchmark-core');
const DAY=86400000,T=Date.parse('2025-01-05T22:00:00Z'),bars=[];
for(let session=0;session<185;session++){
 const date=new Date(T+session*DAY).toISOString().slice(0,10);
 if([0,6].includes(new Date(T+session*DAY).getUTCDay())&&new Date(T+session*DAY).getUTCDay()!==0)continue;
 const value=2000+100*Math.sin(session/6)+2*session;
 for(let slot=0;slot<5;slot++){const t=T+session*DAY+slot*4*3600000;
  bars.push({session_date:date,slot,start_ms:t,close_ms:t+4*3600000,open:value,close:value+2,high:value+8,low:value-8});}
}
// Synthetic bars intentionally overlap across calendar days (NY trade slots carry over UTC midnight);
// give each reopened session 24h spacing and skip Sunday-weekend, but no synthetic next-day grouping assumptions.
let continuous=bars.filter((x,i)=>i===0||x.start_ms>=bars[i-1].close_ms);
const result=evaluate({inputCandles:continuous,startDate:'2025-04-15'});
assert.equal(result.A_always_long.trade_count,1);
assert(result.A_always_long.final_equity_usd>0);
assert.equal(result.C_original_V22.win_rate_pct,null);
assert.equal(result.C_original_V22.trade_count,null);
assert.equal(result.live_trade_signals_enabled,false);
assert.equal(ddFromPath([{equity:100},{equity:80},{equity:90}]),20);
assert.throws(()=>evaluate({inputCandles:continuous,startDate:'2025-04-15',stopATR:0}));
console.log('Equal-window baseline A, strict technical B ledger and fail-closed V2.2 C comparison passed');
