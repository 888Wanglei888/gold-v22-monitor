// Frozen expectation-first C1 gold RESEARCH macro overlay for preexisting Dow+4h B entries.
// No original V2.2 grade A/A+/A++ or institutional-grade historical release vintages claimed.
const {snap,delta,sumWindow}=require('./v22-cross-market-core');
const needed=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL','DXY','COT_NET','COT_OI','TGA','GLD_TONNES_DELTA'];
const round=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
function makeFiscalLookup(fiscal){
 const rows=(fiscal||[]).filter(x=>Number.isFinite(x.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions)&&Number.isFinite(Date.parse(x.no_earlier_than_utc))).slice().sort((a,b)=>a.no_earlier_than_utc.localeCompare(b.no_earlier_than_utc));
 return at=>{
  let lo=0,hi=rows.length;
  while(lo<hi){const m=(lo+hi)>>1;if(Date.parse(rows[m].no_earlier_than_utc)<=at)lo=m+1;else hi=m}
  const row=lo?rows[lo-1]:null;
  if(!row||at-Date.parse(row.no_earlier_than_utc)>5*86400000)return null;
  return row;
 };
}
function policyCheck(features,policy){
 const macros=[features.dxy_support,features.real_yield_support].filter(Boolean).length,
       flows=[features.gld_holdings_support,features.cftc_position_support].filter(Boolean).length,
       confirmed=macros+flows;
 const notAgainstFiscal=features.signed_fiscal_forecast_usd_billions<=30;
 const materiallyInFavor=features.signed_fiscal_forecast_usd_billions<=-30;
 if(policy==='C1_guardrail'){
  return {eligible:notAgainstFiscal&&confirmed>=1&&features.no_short_term_money_market_stress,reason:'requires_fiscal_not_adverse_and_one_crossasset_confirmation'};
 }
 if(policy==='C1_confirmed'){
  return {eligible:notAgainstFiscal&&macros>=1&&flows>=1&&features.no_short_term_money_market_stress,reason:'requires_fiscal_not_adverse_plus_macro_and_gold_flow_confirmation'};
 }
 if(policy==='C1_strict'){
  return {eligible:materiallyInFavor&&macros===2&&flows>=1&&features.no_short_term_money_market_stress,reason:'requires_strong_pre_event_fiscal_direction_both_macro_and_gold_flow_confirmation'};
 }
 throw Error('Undefined C1 pre-registered research policy '+policy);
}
function makeGate({sources,maxAgeDays,decisionForecasts,policy}){
 if(!['C1_guardrail','C1_confirmed','C1_strict'].includes(policy))throw Error('Invalid frozen C1 policy');
 const latestFiscal=makeFiscalLookup(decisionForecasts);
 const counters={evaluated_dow_4h_signals:0,all_12_lagged_features_current:0,fiscal_expected_cash_available:0,
  macro_and_gold_flow_confirmed:0,allowed:0,missing_source:0,missing_fiscal:0,missing_feature_change:0,
  failed_fiscal_or_cross_asset_gate:0};
 function gate(candidate){
  counters.evaluated_dow_4h_signals++;
  const time=candidate.confirmed_at,side=candidate.dir==='long'?1:-1;
  const missing=needed.filter(id=>!snap(sources,id,time,maxAgeDays));
  if(missing.length){counters.missing_source++;return {eligible:false,reason:'prior_time_feature_missing_or_stale:'+missing.join(',')}}
  counters.all_12_lagged_features_current++;
  const fiscal=latestFiscal(time);
  if(!fiscal){counters.missing_fiscal++;return {eligible:false,reason:'prior_fiscal_D3_auction_plus_missing_issuance_baseline_tax_not_available'}}
  counters.fiscal_expected_cash_available++;
  const dx=delta(sources,'DXY',time,7,maxAgeDays),real=delta(sources,'DFII10',time,7,maxAgeDays),
       gld=sumWindow(sources,'GLD_TONNES_DELTA',time,7),cot=delta(sources,'COT_NET',time,28,maxAgeDays);
  const sofr=snap(sources,'SOFR',time,maxAgeDays),iorb=snap(sources,'IORB',time,maxAgeDays);
  const forecast=fiscal.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions/1000;
  if(![dx,real,gld,cot,forecast,sofr.value,iorb.value].every(Number.isFinite)){
   counters.missing_feature_change++;return {eligible:false,reason:'unavailable_macroeconomic_change_or_spread'};
  }
  const spread=sofr.value-iorb.value;
  // Relative prices in original source units: DXY points, TIPS yield %points, GLD tonnes, CFTC contracts.
  // Fiscal sign: a TGA rise tends to drain dollar liquidity, though ON RRP and credit risk can modify impact.
  const features={
   observed_utc:new Date(time).toISOString(),price_direction:candidate.dir,
   fiscal_decision_no_earlier_than_utc:fiscal.no_earlier_than_utc,
   fiscal_model_expected_D3_change_usd_billions:round(forecast,2),
   signed_fiscal_forecast_usd_billions:round(side*forecast,2),
   next_D3_fiscal_forecast_target_date:fiscal.forecast_target_date,
   fiscal_includes_unknown_issuance_fallback:fiscal.future_days_without_published_auction_issuance>0,
   dxy_week_delta_points:round(dx,3),tips_real_yield_week_delta_percentage_points:round(real,3),
   gld_last7days_inventory_delta_tonnes:round(gld,3),managed_money_4week_delta_contracts:round(cot,0),
   dxy_support:side*dx<0,real_yield_support:side*real<0,
   gld_holdings_support:side*gld>0,cftc_position_support:side*cot>0,
   sofr_minus_iorb_percentage_points:round(spread,3),
   no_short_term_money_market_stress:spread<=0.20,
   original_source_publication_vintage_verified:false};
  if((features.dxy_support||features.real_yield_support)&&(features.gld_holdings_support||features.cftc_position_support))counters.macro_and_gold_flow_confirmed++;
  const chosen=policyCheck(features,policy);
  if(chosen.eligible)counters.allowed++;else counters.failed_fiscal_or_cross_asset_gate++;
  return {eligible:chosen.eligible,reason:chosen.eligible?'fixed_asof_macro_overlay_pass':chosen.reason,features};
 }
 return {gate,counters,policy,limits:[
  'Fiscal D+3 is Treasury auction known components + historical imputed unannounced Bill gross issue + public cashflow residual; C1 research proxy',
  'Fiscal observable at previous decision calendar date 23:59:59Z; entry at gold 4h later, never use future DTS cash outcome',
  'All 12 FRED/DXY/GLD/CFTC/TGA sources use lagged observation timestamps, NOT certified revision/as-published data vintages',
  '7-day DXY real yield and GLD changes and 28-day CFTC changes chosen as simple transparent pre-set rules, NOT optimized',
  'SOFR-IORB spread <=0.20 pp adopted as a coarse research stress guardrail, NOT Fed/NYFed stress certification',
  'CFTC managed money weekly and GLD physical inventory are NOT COMEX daily contract OI or global ETF dollar flows',
  'Fiscal adverse threshold +30bn USD and supportive -30bn USD are unvalidated fixed sensitivity choices',
  'Macro signs/flow signs and portfolio results studied on same 2025-2026 development sample; no untouched testing',
  'Completeness of ON RRP reserve and TGA SOURCE data does not establish source is economically directionally supportive',
  'C1 filters are not original gold V2.2 A/A+/A++ validated trading criteria; LIVE trade disabled']};
}
module.exports={makeGate,policyCheck,makeFiscalLookup};
