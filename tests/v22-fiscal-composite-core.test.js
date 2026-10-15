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
const baseline=evaluate(tga,cash,rows,2025,[],{include_decision_forecasts:true});
const first=baseline.research_only_decision_forecasts.find(x=>x.decision_date==='2025-04-15');
assert(first,'Expected April synthetic decision record');
const finalDay=tga.at(-1).date;
const mostRecent=baseline.research_only_decision_forecasts.find(x=>x.decision_date===finalDay);
assert(mostRecent,'Latest decision must be forecastable even though future target TGA has not occurred yet');
assert(mostRecent.forecast_target_date>finalDay);
assert(!baseline.scored['D+3'].overall.samples || !('actual' in mostRecent),'Ex-ante predictions must never contain outcomes');

const perturb=tga.map(x=>x.date==='2025-04-15'?{...x,balance:x.balance+1000000}:x);
const revised=evaluate(perturb,cash,rows,2025,[],{include_decision_forecasts:true});
const same=revised.research_only_decision_forecasts.find(x=>x.decision_date===first.decision_date);
assert.equal(same.forecast_D3_auction_plus_tax_usd_millions,first.forecast_D3_auction_plus_tax_usd_millions,'Future as-of-date TGA balance must not change preceding public-knowledge forecast');
assert(!Object.hasOwn(first,'actual'));
assert(!Object.hasOwn(first,'actual_tga_change'));
assert(first.no_earlier_than_utc.endsWith('23:59:59.000Z'));
console.log('Historical fiscal forecast and current-day unknown TGA balance non-leakage tests passed');
