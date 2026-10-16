const assert=require('node:assert/strict');
const {staticGate,methods,goldPricedIn}=require('../lib/endpoints/v22-fiscal-new-methods-core');
const {buildAsOf}=require('../lib/endpoints/v22-asof-core');
const H=14400000,BASE=Date.parse('2025-06-01T00:00:00Z');
const bars=Array.from({length:160},(_,i)=>({start_ms:BASE+i*H,close_ms:BASE+(i+1)*H,
 open:200+i*.1,high:202+i*.1,low:198+i*.1,close:200+i*.1,slot:i%5,session_date:'2025-06-01'}));
const cand={confirmed_at:bars[135].close_ms,dir:'long',atr:5,entryIndex:136};
const value=(dates,values)=>buildAsOf(dates.map((date,i)=>({date,value:values[i]})),1);
const dt=['2025-05-01','2025-05-27','2025-06-10','2025-06-20'];
const sources={
 WRESBAL:value(dt,[3500000,3450000,3400000,3350000]),
 RRPONTSYD:value(dt,[100,80,65,40]),
 SOFR:value(dt,[4.3,4.3,4.31,4.31]),
 IORB:value(dt,[4.3,4.3,4.3,4.3])
};
const maxAgeDays={WRESBAL:35,RRPONTSYD:20,SOFR:20,IORB:20};
const fc=(bn,mae=35)=>[{decision_date:'2025-06-21',no_earlier_than_utc:'2025-06-21T23:59:59Z',
 forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions:bn*1000,
 rolling_prior_released_D3_forecast_MAE_usd_millions:mae*1000,
 rolling_prior_released_D3_error_samples:60,rolling_error_asof_cutoff_date:'2025-06-18',
 future_days_without_published_auction_issuance:2}];
const rev=(z)=>[{no_earlier_than_utc:'2025-06-21T23:59:59Z',fiscal_revision_z_research_proxy_fallback:z}];
const run=(method,forecast=fc(20),revision=rev(-.2),gold=bars)=>staticGate({
 method,sources,maxAgeDays,decisionForecasts:forecast,revisionRecords:revision,goldCandles:gold}).gate(cand);
assert.deepEqual(methods,['fiscal_uncertainty_band','revision_adverse_only','revision_positive_only','reserve_transmission_gap','gold_prepriced_3atr','fiscal_plus_transmission','all_four_combined']);
assert(run('fiscal_uncertainty_band').eligible,'Adverse fiscal prediction within prior as-of model uncertainty is NEUTRAL');
assert(!run('fiscal_uncertainty_band',fc(40)).eligible,'Forecast materially adverse beyond rolling MAE should reject');
assert(!run('fiscal_uncertainty_band',fc(20,0)).eligible,'Missing reliable prior-published forecast error cannot qualify');
assert(run('revision_adverse_only',fc(-45),rev(-.9)).eligible);
assert(!run('revision_adverse_only',fc(-45),rev(1.0)).eligible);
assert(run('revision_adverse_only',fc(-45),[]).eligible,'No revision shock is neutral, NOT an automatic disqualifier');
assert(!run('revision_positive_only',fc(-45),[]).eligible,'New information only must require confirmed revision');
assert(run('revision_positive_only',fc(-45),rev(-1.2)).eligible);
assert(!run('reserve_transmission_gap',fc(-60)).eligible,'Strong predicted release disagrees with observed falling reserves');
assert(run('reserve_transmission_gap',fc(-20)).eligible,'Reserve disagreement alone cannot overrule forecasts inside MAE neutral band');
assert(run('gold_prepriced_3atr').eligible);
const gold=bars.map(x=>({...x}));for(let i=121;i<160;i++){gold[i].close+=(i-120)*3;gold[i].open=gold[i].close;gold[i].high=gold[i].close+2;gold[i].low=gold[i].close-2}
assert(!run('gold_prepriced_3atr',fc(20),rev(-.2),gold).eligible,'Past 15 bars >3 ATR movement should flag likely already priced');
assert(!run('all_four_combined',fc(-60)).eligible,'Combined guard rejects previously conflicting reserve regime');
assert(run('all_four_combined',fc(10)).eligible,'Combined guard must preserve uncertain fiscal sign rather than auto-bearish');
const future=fc(20);future[0].no_earlier_than_utc=new Date(cand.confirmed_at+60000).toISOString();
assert(!run('fiscal_uncertainty_band',future).eligible,'Cannot use later forecast record');
const hindsight=fc(20);hindsight[0].rolling_error_asof_cutoff_date='2025-07-01';
assert.throws(()=>run('fiscal_uncertainty_band',hindsight),/future hindsight/);
const v=goldPricedIn(bars,cand);
assert(Date.parse(v.last_closed_utc)<=cand.confirmed_at);
assert(Date.parse(v.reference_closed_utc)<=cand.confirmed_at);
console.log('7 fiscal error-band/revision/transmission/price-preflection controls pass no-hindsight tests');
