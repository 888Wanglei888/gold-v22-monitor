const assert=require('node:assert/strict');
const {evaluate,nextWeekday}=require('../lib/endpoints/v22-fiscal-composite-core');
const {normalizeAnnouncements}=require('../lib/endpoints/v22-auction-core');
assert.equal(nextWeekday('2025-12-26'),'2025-12-29');
const tga=[],cash=[];
let day=Date.parse('2024-01-01T12:00:00Z'),v=100000;
for(let i=0;i<600;i++){
 const dt=new Date(day).toISOString().slice(0,10),w=new Date(day).getUTCDay();
 if(w!==0&&w!==6){v+=(w===1?1000:w===5?-700:250);tga.push({date:dt,balance:v});cash.push({date:dt,nondebt_net:(w===1?1000:w===5?-700:250)})}
 day+=86400000;
}
const rows=normalizeAnnouncements([]).events;
const result=evaluate(tga,cash,rows,2025);
assert(result.scored['D+1'].overall.samples>100);
assert(result.scored['D+1'].overall.mae_auction_plus_split_cash_usd_billions<0.001);
assert(result.scored['D+3'].overall.samples>100);
console.log('Historical fiscal forecast split-cash model synthetic no-auction walk-forward tests passed');
