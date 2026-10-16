const assert=require('node:assert/strict');
const {studyRefinement,firstAtOrAfter}=require('../lib/endpoints/v22-gold-5m-refine-core');
const start=Date.parse('2026-09-01T00:00:00Z'),bars4=[],bars5=[];
for(let i=0;i<100;i++){
 const t=start+i*14400000,price=i===40?4100:i===41?4110:4000+i*.15+2*Math.sin(i/4);
 bars4.push({start_ms:t,close_ms:t+14400000,open:price,close:price,high:price+6,low:price-6,session_date:new Date(t).toISOString().slice(0,10),slot:i%5});
}
for(let i=0;i<4800;i++){
 const t=start+i*300000,p=4000+i*.015+2*Math.sin(i/7);
 bars5.push({start_ms:t,close_ms:t+300000,open:p,close:p+.1,high:p+1.5,low:p-1.5});
}
assert.equal(firstAtOrAfter(bars5,start+1200000),4);
const d=studyRefinement({bars5m:bars5,bars4h:bars4});
assert.equal(d.status,'gold_4h_breakout_with_actual_5m_counterfactual_research');
assert(d.exploratory_price_confirmation_only_refinement.four_hour_anchor_events_with_actual_5m_cover>=1);
for(const x of d.last_price_only_events){
 const earliest=Date.parse(x.authorized_4h_next_open_utc);
 assert(Date.parse(x.immediate_5m_market.fill_utc)>=earliest);
 for(const key of ['pullback_limit_5m','micro_breakout_5m'])if(x[key])assert(Date.parse(x[key].fill_utc)>=earliest);
}
const empty=studyRefinement({bars5m:bars5.slice(0,100),bars4h:bars4});
assert.equal(empty.strict_B_entry_refinement.four_hour_anchor_events_with_actual_5m_cover,0);
console.log('4h signal anchors preceding all five-minute entries and unobserved 5m history excluded');
