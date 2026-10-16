// Unoptimized in-sample fiscal research ablations: same B Dow/4h entry and risk/cost engine.
// Every field is sampled at the already-CLOSED 4h confirmation. No future TGA, prices or revisions.
const {snap,delta}=require('./v22-cross-market-core');
const {makeFiscalLookup}=require('./v22-c1-gate-core');
const {revisionLookup}=require('./v22-c2-core');
const DAY=86400000;
const methods=[
 'fiscal_uncertainty_band',
 'revision_adverse_only',
 'revision_positive_only',
 'reserve_transmission_gap',
 'gold_prepriced_3atr',
 'fiscal_plus_transmission',
 'all_four_combined'
];
function goldPricedIn(bars,candidate,historyBars=15){
 const t=candidate.confirmed_at,atr=candidate.atr,side=candidate.dir==='long'?1:-1;
 let lo=0,hi=bars.length;while(lo<hi){const m=(lo+hi)>>1;if(bars[m].close_ms<=t)lo=m+1;else hi=m}
 const last=lo-1;
 if(last<historyBars||!Number.isFinite(atr)||atr<=0)return null;
 if(bars[last].close_ms>t||bars[last-historyBars].close_ms>t)throw Error('Prepricing future closed-bar access');
 return {directional_move_atr:side*(bars[last].close-bars[last-historyBars].close)/atr,
  last_closed_utc:new Date(bars[last].close_ms).toISOString(),
  reference_closed_utc:new Date(bars[last-historyBars].close_ms).toISOString(),
  prior_full_4h_bars:historyBars};
}
function staticGate({method,sources,maxAgeDays,decisionForecasts,revisionRecords,goldCandles}){
 if(!methods.includes(method))throw Error('Unrecognized frozen fiscal-ablation method');
 const rows=goldCandles.slice().sort((a,b)=>a.start_ms-b.start_ms);
 const fiscalLookup=makeFiscalLookup(decisionForecasts),revLookup=revisionLookup(revisionRecords);
 const tally={signals_evaluated:0,forecasts_known:0,rolling_errors_ready:0,revision_data_available:0,
  positive_revision_events:0,adverse_revision_events:0,pricing_samples:0,gold_prepriced:0,
  favorable_fiscal_but_reserve_against:0,allowed:0,blocked:0,failed_missing_data:0,
  blocked_reasons:{}};
 const reject=(reason,features)=>{tally.blocked++;tally.blocked_reasons[reason]=(tally.blocked_reasons[reason]||0)+1;return {eligible:false,reason,features}};
 function gate(candidate){
  tally.signals_evaluated++;
  const t=candidate.confirmed_at,side=candidate.dir==='long'?1:-1;
  if(!Number.isFinite(t)||!['long','short'].includes(candidate.dir))throw Error('Bad signal time or direction');
  const f=fiscalLookup(t),rev=revLookup(t);
  const z=rev?.fiscal_revision_z_research_proxy_fallback;
  const fMAE=f?.rolling_prior_released_D3_forecast_MAE_usd_millions;
  const forecast=f?.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions;
  const mGold=goldPricedIn(rows,candidate);
  const info={confirmation_utc:new Date(t).toISOString(),side,
   source_fiscal_decision_date:f?.decision_date||null,
   historical_error_sample_count:f?.rolling_prior_released_D3_error_samples||0,
   forecast_D3_tga_usd_bn:Number.isFinite(forecast)?+(forecast/1000).toFixed(3):null,
   rolling_prior_D3_MAE_usd_bn:Number.isFinite(fMAE)?+(fMAE/1000).toFixed(3):null,
   fiscal_signed_tga_usd_bn:Number.isFinite(forecast)?+(side*forecast/1000).toFixed(3):null,
   revision_z_past_only:Number.isFinite(z)?+z.toFixed(3):null,
   revision_last_published_assumed_at_utc:rev?.no_earlier_than_utc||null,
   gold_last_15bars_directional_advance_atr:mGold?+mGold.directional_move_atr.toFixed(3):null,
   gold_last_confirmed_bar_utc:mGold?.last_closed_utc||null,
   forecast_future_bill_issuance_imputed:f?.future_days_without_published_auction_issuance>0,
   realized_future_fiscal_not_used:true,point_in_time_vintages_not_proven:true};
  const wantsFiscal=method!=='gold_prepriced_3atr';
  if(wantsFiscal){
   if(!f||!Number.isFinite(fMAE)||fMAE<=0||!Number.isFinite(forecast)){tally.failed_missing_data++;return reject('no_asof_forecast_or_released_prior_error_band',info)}
   if(!/^20\d\d-\d\d-\d\d$/.test(f.rolling_error_asof_cutoff_date||'')||Date.parse(f.rolling_error_asof_cutoff_date+'T00:00:00Z')>=Date.parse(f.decision_date+'T00:00:00Z'))throw Error('Rolling forecast error has future hindsight');
   tally.forecasts_known++;tally.rolling_errors_ready++;
  }
  const adverse=Number.isFinite(forecast)&&Number.isFinite(fMAE)&&side*forecast>fMAE,
        favorable=Number.isFinite(forecast)&&Number.isFinite(fMAE)&&side*forecast< -fMAE;
  const adverseZ=Number.isFinite(z)&&side*z>=.75;
  const positiveZ=Number.isFinite(z)&&side*z<=-.75;
  if(Number.isFinite(z))tally.revision_data_available++;
  if(adverseZ)tally.adverse_revision_events++;if(positiveZ)tally.positive_revision_events++;
  if(mGold)tally.pricing_samples++;
  const priced=mGold!==null&&mGold.directional_move_atr>=3;
  if(priced)tally.gold_prepriced++;
  const needsFlow=['reserve_transmission_gap','fiscal_plus_transmission','all_four_combined'].includes(method);
  let againstReserves=false,rrp14=null,rrpLevel=null,reserves28bn=null,spread=null;
  if(needsFlow){
   const reserves=delta(sources,'WRESBAL',t,28,maxAgeDays),rrp=delta(sources,'RRPONTSYD',t,14,maxAgeDays),
    rrpNow=snap(sources,'RRPONTSYD',t,maxAgeDays),sofr=snap(sources,'SOFR',t,maxAgeDays),iorb=snap(sources,'IORB',t,maxAgeDays);
   if(![reserves,rrp,rrpNow?.value,sofr?.value,iorb?.value].every(Number.isFinite)){
    tally.failed_missing_data++;return reject('no_asof_reserves_rrp_or_sofr_iorb',info);
   }
   reserves28bn=reserves/1000;rrp14=rrp;rrpLevel=rrpNow.value;spread=sofr.value-iorb.value;
   // Observed 28-day reserve trend is evidence of REGIME, NOT forecast of next 3-day reserves.
   againstReserves=side*reserves28bn<0;
   if(favorable&&againstReserves)tally.favorable_fiscal_but_reserve_against++;
  }
  Object.assign(info,{fiscal_adverse_beyond_prior_mae:adverse,fiscal_favorable_beyond_prior_mae:favorable,
   adverse_fiscal_revision_z:adverseZ,favorable_revision_z:positiveZ,
   gold_price_prepriced_3atr:priced,
   reserve_28_calendar_day_change_usd_bn:reserves28bn===null?null:+reserves28bn.toFixed(3),
   rrp_14_calendar_day_change_usd_bn:rrp14===null?null:+rrp14.toFixed(3),
   available_rrp_stock_usd_bn:rrpLevel===null?null:+rrpLevel.toFixed(3),
   sofr_minus_iorb_percentage_points:spread===null?null:+spread.toFixed(4),
   past_reserve_trend_against_gold_side:needsFlow?againstReserves:null,
   fiscal_expected_easing_not_validated_by_prior_reserves:needsFlow&&favorable&&againstReserves});
  if(['gold_prepriced_3atr','all_four_combined'].includes(method)&&mGold===null){tally.failed_missing_data++;return reject('missing_closed_gold_15bar_repricing_measure',info)}
  const rejects={
   fiscal_uncertainty_band:adverse,
   revision_adverse_only:adverseZ,
   revision_positive_only:!positiveZ,
   reserve_transmission_gap:favorable&&againstReserves,
   gold_prepriced_3atr:priced,
   fiscal_plus_transmission:adverse||(favorable&&againstReserves),
   all_four_combined:adverse||adverseZ||(favorable&&againstReserves)||priced
  };
  if(rejects[method])return reject('rule_'+method,info);
  tally.allowed++;return {eligible:true,reason:'method_'+method+'_pass',features:info};
 }
 return {gate,tally,method,method_definition:{
  fiscal_uncertainty_band:'Reject only materially adverse D+3 TGA forecast exceeding rolling 120 previously settled and released D+3 absolute-error mean (>=30 samples). Neutral inside band.',
  revision_adverse_only:'Reject ONLY if previous published MODEL D+3 same-target revision Z >= +0.75 adverse to gold side; missing significant Z is neutral, but prior uncertainty estimate required.',
  revision_positive_only:'Positive-control select-only: trade if revised D+3 forecast Z <= -0.75 favorable for gold direction. Missing revision means NO trade, never assume favorable.',
  reserve_transmission_gap:'Reject if predicted favorable D+3 TGA change exceeds prior model error AND 28-calendar-day bank reserve trend runs against intended gold direction. Historical regime diagnostic not a 3-day reserve forecast.',
  gold_prepriced_3atr:'Reject entries after gold has already moved >=3 completed 4h ATRs in same direction over previous 15 completed 4h bars. Price-based prepricing EXHAUSTION proxy, not proven priced-in fraction.',
  fiscal_plus_transmission:'Reject materially adverse fiscal projection OR expected materially favorable fiscal projection contradicted by past reserves trend.',
  all_four_combined:'All above vetoes, except positive-revision-only requirement; shortage of strong favorable Z does not block a trend trade. All safeguards fixed before study.'
 }[method]};
}
module.exports={staticGate,methods,goldPricedIn};
