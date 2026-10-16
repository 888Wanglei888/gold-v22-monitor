const assert=require('node:assert/strict');
const {study}=require('../lib/endpoints/v22-fiscal-expectation-core');
const {moveBusiness}=require('../lib/endpoints/v22-expectation-event-core');
const H=4*3600000,base=Date.parse('2025-04-01T00:00:00Z'),bars=[];
for(let i=0;i<280;i++){const start=base+i*H,px=100+i*.02;bars.push({start_ms:start,close_ms:start+H,open:px,close:px+.01,high:px+.2,low:px-.2})}
const decision='2025-04-07',observation=moveBusiness(decision,1);
const rows=[];for(let k=1,target=decision;k<=6;k++){target=moveBusiness(target,1);rows.push({horizon_business_days:k,target_date:target,forecast_day_change_issuance_fallback_tax_usd_millions:-45000})}
const path={decision_date:decision,no_earlier_than_utc:decision+'T23:59:59.000Z',cashflow_target_predictions:rows};
const r=study({fiscalPaths:[path],goldCandles:bars,thresholdUsdBillions:30});
assert.equal(r.by_horizon['T-1'].overall.exante_selected_event_days,1);
assert.equal(r.by_horizon['T-3'].overall.exante_selected_event_days,1);
assert.equal(r.by_horizon['T-5'].overall.exante_selected_event_days,1);
assert.equal(r.original_v22_trades,0);
const poisoned=structuredClone(path);poisoned.no_earlier_than_utc='2025-04-08T00:00:01.000Z';
assert.equal(study({fiscalPaths:[poisoned],goldCandles:bars}).coverage_diagnostics.missing_prior_publish_timestamp,1);
assert.equal(study({fiscalPaths:[{...path,cashflow_target_predictions:rows.map(x=>({...x,forecast_day_change_issuance_fallback_tax_usd_millions:0}))}],goldCandles:bars}).by_horizon['T-3'].overall.exante_selected_event_days,0);
const alters=bars.map(x=>({...x}));alters.at(-1).close+=100;
assert.equal(study({fiscalPaths:[path],goldCandles:alters}).by_horizon['T-3'].overall.exante_selected_event_days,1);
console.log('T-5 T-3 T-1 prior-day frozen fiscal event ex-ante gold research tests passed');
