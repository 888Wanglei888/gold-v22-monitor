const assert=require('node:assert/strict'),{revision}=require('../lib/endpoints/v22-fiscal-revision-core');
const DAY=86400000,iso=x=>new Date(x).toISOString().slice(0,10),next=x=>{let n=Date.parse(x+'T12:00:00Z');do{n+=DAY}while([0,6].includes(new Date(n).getUTCDay()));return iso(n)};
const paths=[];let now='2024-07-01';
for(let i=0;i<420;i++){
 let target=now,rows=[];
 for(let j=1;j<=5;j++){target=next(target);const x=Date.parse(target+'T00:00:00Z')/DAY;
  rows.push({target_date:target,horizon_business_days:j,forecast_day_change_auction_tax_usd_millions:500+10*j+30*Math.sin(i/7+x/13),
   forecast_day_change_issuance_fallback_tax_usd_millions:400+10*j+20*Math.sin(i/7+x/13)})}
 paths.push({decision_date:now,no_earlier_than_utc:now+'T23:59:59.000Z',cashflow_target_predictions:rows});
 now=next(now);
}
const r=revision(paths,{return_records:true});
assert(r.rolling_z_valid_days>100);
assert(r.revision_days>200);
assert.equal(r.official_v22_A_Aplus_Aplusplus_signals,0);
const old=r.records.find(x=>x.decision_date==='2025-05-01');
if(old){
 const future=structuredClone(paths);
 future.at(-1).cashflow_target_predictions[0].forecast_day_change_auction_tax_usd_millions+=1000000;
 const after=revision(future,{return_records:true});
 assert.equal(after.records.find(x=>x.decision_date===old.decision_date)?.fiscal_revision_z_research_proxy_known_auction,old.fiscal_revision_z_research_proxy_known_auction);
}
assert.equal(revision(paths.slice(0,20)).rolling_z_valid_days,0);
console.log('Strict previous decision same-remaining-target fiscal revision rolling-Z and future independence tests passed');
