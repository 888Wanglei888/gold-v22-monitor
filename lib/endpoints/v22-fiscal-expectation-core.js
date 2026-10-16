// Gold V2.2 expectation-first fiscal event research using as-of frozen forecast targets.
// Fix forecast one BUSINESS DAY before market observation: T-6 snapshot -> price from T-5,
// T-4 snapshot -> price from T-3, T-2 snapshot -> price from T-1.
// This protects against today's unpublished TGA and same-day auction results.
// D+6 is an EXPLORATORY extension of original D+1/3/5, not a validated TGA model.
const {prices,moveBusiness}=require('./v22-expectation-event-core');
const DAY=86400000,utc=d=>Date.parse(d+'T00:00:00Z');
const round=x=>Number.isFinite(x)?+x.toFixed(3):null;
function summary(items){
 const gold=items.filter(x=>Number.isFinite(x.pre_event_gold_return_pct)),direction=gold.filter(x=>Number.isFinite(x.fiscal_model_predicted_change_usd_billions)&&x.fiscal_model_predicted_change_usd_billions!==0);
 const post=items.filter(x=>Number.isFinite(x.event_to_third_business_day_gold_return_pct));
 const n=items.length,avg=(a,fn)=>a.length?round(a.reduce((s,v)=>s+fn(v),0)/a.length):null;
 const pHit=direction.length?round(100*direction.filter(x=>x.hypothesized_gold_direction*x.pre_event_gold_return_pct>0).length/direction.length):null;
 return {exante_selected_event_days:n,pre_event_price_coverage:gold.length,
  avg_raw_gold_pre_event_return_pct:avg(gold,x=>x.pre_event_gold_return_pct),
  hypothetical_liquidity_direction_pre_event_hit_pct:pHit,
  avg_hypothesis_direction_adjusted_pre_event_return_pct:avg(direction,x=>x.hypothesized_gold_direction*x.pre_event_gold_return_pct),
  avg_raw_gold_after_event_3_business_days_pct:avg(post,x=>x.event_to_third_business_day_gold_return_pct),
  avg_hypothesis_direction_adjusted_after_event_3_business_days_pct:avg(post.filter(x=>x.hypothesized_gold_direction),x=>x.hypothesized_gold_direction*x.event_to_third_business_day_gold_return_pct),
  gold_4h_price_confirmation_before_event:gold.filter(x=>x.has_4h_directional_price_confirmation_before_event).length,
  predicted_tga_rise_events:items.filter(x=>x.fiscal_model_predicted_change_usd_billions>0).length,
  predicted_tga_decline_events:items.filter(x=>x.fiscal_model_predicted_change_usd_billions<0).length};
}
function study({fiscalPaths,goldCandles,priceCandidates=[],thresholdUsdBillions=30}){
 const bars=goldCandles.slice().sort((a,b)=>a.start_ms-b.start_ms);
 if(bars.some((b,i)=>b.start_ms>=b.close_ms||(i>0&&b.start_ms<bars[i-1].close_ms)))throw Error('Gold 4h candle overlap or invalid close');
 const rows={1:[],3:[],5:[]},stats={forecast_observations_seen:0,missing_prior_publish_timestamp:0,forecast_daily_value_unavailable:0,
  model_forecast_below_fixed_threshold:0,insufficient_4h_price_coverage:0,horizon_or_calendar_inconsistent:0};
 for(const path of fiscalPaths||[]){
  const decision=path.decision_date,available=Date.parse(path.no_earlier_than_utc);
  if(!/^20\d\d-\d\d-\d\d$/.test(decision)||!Number.isFinite(available))continue;
  // Only consider records issued at/after their stated conservative prior-day 23:59:59Z checkpoint.
  const observationStart=moveBusiness(decision,1);
  if(available>=utc(observationStart)){stats.missing_prior_publish_timestamp++;continue}
  for(const ahead of [1,3,5]){
   stats.forecast_observations_seen++;
   const target=moveBusiness(observationStart,ahead);
   const originalHorizon=ahead+1;
   const row=path.cashflow_target_predictions.find(x=>x.horizon_business_days===originalHorizon);
   if(!row||row.target_date!==target){stats.horizon_or_calendar_inconsistent++;continue}
   const val=row.forecast_day_change_issuance_fallback_tax_usd_millions;
   if(!Number.isFinite(val)){stats.forecast_daily_value_unavailable++;continue}
   if(Math.abs(val)<thresholdUsdBillions*1000){stats.model_forecast_below_fixed_threshold++;continue}
   const gold=prices(bars,observationStart,target);
   if(!gold){stats.insufficient_4h_price_coverage++;continue}
   const direction=val<0?1:-1;
   const nConfirm=priceCandidates.filter(x=>{
    const t=Date.parse(x.confirmation_closed_utc);
    return t>=utc(observationStart)&&t<utc(target)&&x.direction===(direction>0?'long':'short');
   }).length;
   rows[ahead].push({market_observation_starts:observationStart,fiscal_model_decision_date:decision,
    decision_frozen_no_earlier_than_utc:path.no_earlier_than_utc,
    original_future_forecast_horizon_business_days:originalHorizon,
    expected_cashflow_target_date:target,
    fiscal_model_predicted_change_usd_billions:round(val/1000),
    hypothesized_gold_direction:direction,
    has_4h_directional_price_confirmation_before_event:nConfirm>0,
    gold_4h_confirmations_before_event:nConfirm,...gold});
  }
 }
 const by_horizon=Object.fromEntries([1,3,5].map(k=>['T-'+k,{
  overall:summary(rows[k]),
  by_year:Object.fromEntries([2025,2026].map(y=>[y,summary(rows[k].filter(x=>x.expected_cashflow_target_date.startsWith(String(y))))])),
  recent_observations:rows[k].slice(-5).map(x=>({date:x.expected_cashflow_target_date,known_fiscal_decision:x.fiscal_model_decision_date,
   forecasted_daily_tga_change_usd_billions:x.fiscal_model_predicted_change_usd_billions,
   pre_event_gold_pct:round(x.pre_event_gold_return_pct),
   post_event_3_business_days_gold_pct:round(x.event_to_third_business_day_gold_return_pct),
   prior_confirmed_gold_4h_pattern:x.has_4h_directional_price_confirmation_before_event}))
 }]));
 return {status:'fiscal_predicted_event_prepricing_walk_forward_research_only',
  forecast_source:'As-of Treasury Bills announcement gross awards, historical missing-issue seasonal estimate, known maturity, lagged nondebt residual, prior-year tax window; not full V2.2 cash forecast',
  model_selection_fixed_magnitude_threshold_usd_billions:thresholdUsdBillions,
  observation_rule:'Forecast fixed at PREVIOUS weekday 23:59:59Z; gold price observation starts next weekday 00:00Z; target T after 1/3/5 additional weekdays',
  original_daily_forecast_horizons_used:{'T-1':'D+2','T-3':'D+4','T-5':'D+6 exploratory extension'},
  by_horizon,coverage_diagnostics:stats,unique_target_event_dates:new Set(Object.values(rows).flat().map(x=>x.expected_cashflow_target_date)).size,
  strict_event_selection_uses_future_realized_tga:false,trade_signals_enabled:false,original_v22_trades:0,
  limitations:[
   'Each T-k observation freezes its MODEL ESTIMATE from T-(k+1); no future gold/realized TGA values select event',
   'T-5 requires a D+6 projection, an exploratory extension not previously validated for fiscal MAE',
   'A model forecast is NOT independently measured market expectations or consensus; actual Treasury publication vintage unverified',
   '2025 and 2026 were used to develop calendar model and are not untouched out-of-sample years',
   'Dollar macro credit, Fed, gold ETF/CFTC, full Dow higher timeframe trend and four-hour execution are NOT jointly validated',
   'Hypothesized gold direction assumes drain bad for gold, but RRP buffers and fiscal credit risk can reverse the sign',
   'Event windows overlap, results are price moves NOT independent risk-managed trade PnL',
   'Yahoo GC=F continuous hourly proxy and midnight UTC event boundary do not verify actual COMEX settlements']};
}
module.exports={study,summary};
