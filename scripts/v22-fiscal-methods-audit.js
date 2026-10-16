// Nonoptimized GOLD research ablation for fiscal expectations, revisions, observed transmission & price prepricing.
// All research methods are fixed before fetching outcomes. Same A/B GC futures proxy OHLC, position, fees, time stop.
const fs=require('node:fs');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const {loadFiscalForecastFromTreasury}=require('../lib/endpoints/v22-c1-fiscal-source');
const {staticGate,methods}=require('../lib/endpoints/v22-fiscal-new-methods-core');
const {makeC2}=require('../lib/endpoints/v22-c2-core');
const {evaluate}=require('../lib/endpoints/v22-benchmark-core');
const fixed={startDate:'2025-06-02',initialCash:10000,costBpsRoundTrip:10,stopATR:1.5,maxBars:15,riskFraction:.005,maxLeverage:5};
const shortResult=r=>({trades:r.executed_nonoverlapping_trades,winners:r.winning_trades,
 win_rate_pct:r.win_rate_pct,total_return_pct:r.total_return_pct,max_drawdown_pct:r.max_mark_to_market_drawdown_pct,
 final_equity_usd:r.final_equity_usd,active_4h_market_pct:r.percent_4h_bars_in_market,by_year:r.by_year,
 trade_ledger:r.full_costed_trade_ledger});
async function main(){
 const result={created_utc:new Date().toISOString(),source_sha:process.env.GITHUB_SHA||null,
  status:'pending_no_hindsight_fiscal_method_study',study_type:'fixed_in_sample_fiscal_methods_comparison',
  live_trade_signals_enabled:false,full_official_v22_approved:false,
  preregistration_nature:'fixed code parameters before this CI run, BUT hypotheses motivated by previously observed B and C2 losses; NOT an independent preregistered untouched sample',
  fixed_method_names:methods,strategies:{}};
 try{
  const available=await loadResearchInputs();
  if(available.gold.length<1600)throw Error('Incomplete closed 4h source');
  const fiscal=await loadFiscalForecastFromTreasury(available.sources.TGA);
  if(!fiscal.decisionForecasts.some(r=>Number.isFinite(r.rolling_prior_released_D3_forecast_MAE_usd_millions)&&r.rolling_prior_released_D3_error_samples>=30))throw Error('No rolling prior-settled D3 MAE; do not use full-window forecast error');
  const args={inputCandles:available.gold,...fixed},B=evaluate(args),baseLedger=B.B_dow_higher_frames_plus_4h.full_costed_trade_ledger;
  const shared={sources:available.sources,maxAgeDays:available.maxAgeDays,
   decisionForecasts:fiscal.decisionForecasts,revisionRecords:fiscal.revisionRecords,goldCandles:available.gold};
  result.common_sample=B.time_window;
  result.market_data_coverage={gold_bars:available.gold.length,gold_quality:available.gold_quality,
    source_status:Object.fromEntries(Object.entries(available.coverage).map(([id,x])=>[id,{observations:x.observations,lag_calendar_days:x.lag_calendar_days,max_age_days:x.max_age_days}])),
    errors:available.source_errors,uncertified_historical_revision_vintage:true,
    CFTC_2025_shut_down_delayed_releases_accounted:available.cftc_2025_shutdown_release_delay_enforced};
  result.fiscal_prediction={
    asof_decisions:fiscal.decisionForecasts.length,
    with_past_only_rolling_error:fiscal.decisionForecasts.filter(x=>Number.isFinite(x.rolling_prior_released_D3_forecast_MAE_usd_millions)).length,
    forecast_errors_asof_settled_and_lagged:true,
    full_window_D3_error_metrics_for_context_only:fiscal.projection_scores['D+3'],
    forecasts_have_missing_future_announcements:true,
    revision_diagnostics:fiscal.revision_diagnostics};
  result.common_risk_costs=B.common_assumptions;
  result.benchmark={A_buyhold:{returns_pct:B.A_always_long.total_return_pct,drawdown_pct:B.A_always_long.max_mark_to_market_drawdown_pct},
    B_dow_four_hour:shortResult(B.B_dow_higher_frames_plus_4h)};
  // Previous C2 proxy on EXACT same data snapshot for reproducible comparison.
  const oldGate=makeC2({...shared,mode:'combined'});
  const oldRun=evaluate({...args,entryGate:oldGate.gate}).B_dow_higher_frames_plus_4h;
  result.existing_C2_proxy_combined_recomputed={...shortResult(oldRun),gate_diagnostics:oldGate.counts};
  for(const method of methods){
   const overlay=staticGate({...shared,method});
   const evaluated=evaluate({...args,entryGate:overlay.gate}).B_dow_higher_frames_plus_4h;
   const replay=staticGate({...shared,method});
   const bTradeDecisions=baseLedger.map(t=>{
    if(!Number.isFinite(t.atr_14_at_signal))throw Error('Past ATR unavailable for pure B trade forensic comparison');
    const judgement=replay.gate({confirmed_at:Date.parse(t.source_dow_confirmed_at_utc),dir:t.direction,atr:t.atr_14_at_signal});
    return {B_entry_utc:t.entry_at,B_direction:t.direction,B_trade_net_pnl_usd:t.pnl_after_costs_usd,
      B_winning:t.pnl_after_costs_usd>0,kept_by_method:judgement.eligible,
      decided_before_B_entry:t.source_dow_confirmed_at_utc,
      method_decision_reason:judgement.reason,exante_features:judgement.features||null};
   });
   const kept=bTradeDecisions.filter(x=>x.kept_by_method);
   result.strategies[method]={definition:overlay.method_definition,
    filter_count_report:overlay.tally,
    common_start_and_stop_and_costs_unchanged:true,
    replay_portfolio_result:shortResult(evaluated),
    independent_B_executed_trade_attribution:{
     B_trade_count:bTradeDecisions.length,method_kept_B_trades:kept.length,
     kept_B_winners:kept.filter(x=>x.B_winning).length,
     missed_B_winners:bTradeDecisions.filter(x=>!x.kept_by_method&&x.B_winning).length,
     avoided_B_losers:bTradeDecisions.filter(x=>!x.kept_by_method&&!x.B_winning).length,
     kept_B_losers:kept.filter(x=>!x.B_winning).length,
     all_original_B_trade_asof_decisions:bTradeDecisions}};
  }
  result.status='fixed_fiscal_methods_A_B_C2_ablation_research_completed';
  result.completeness_limitations=[
   'SAME pre-examined 2025-2026 sample: all 7 methods exploratory; no out-of-sample proof or validated profits',
   'Rolling uncertainty bandwidth uses PREVIOUS settled TGA and conservative historical lag, but fiscal source as-published vintages are unverified',
   'Prior 120 D+3 model absolute errors averaged only when at least 30 settled; MAE neutral band NOT a confidence interval',
   'Predicted TGA is not market consensus and includes gross-bill issuance imputation, TreasuryDirect Net New Cash and coupon redemption gaps',
   'Past 28-day bank reserves and past ON RRP changes are regime context only, NOT estimated next 3-day balance sheet changes',
   'Gold >3 ATR already advanced over 15 fully closed prior 4h bars is only a price-exhaustion proxy, not actual measured market absorption',
   'Event selection after earlier B and C2 research means method comparison is hypothesis generation, no selection-adjusted p-value',
   'Trade entry/exit simulated using Yahoo GC=F continuous future 4h bars (not independently reconciled COMEX contract rolls or real execution)',
   'As-of lagged current-vintage macro source levels are not certified real-time vintage; CFTC shutdown deferred releases were accounted for',
   'All model methods filter B price candidates and do NOT exhaust alternative macro-led entry timing or pure fiscal shock trades',
   'Use all methods including those returning zero trades; do not cherry pick strongest in-sample method'];
 }catch(e){result.status='fixed_fiscal_methods_ablation_blocked';result.error=String(e.stack||e);}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-fiscal-methods-latest.json',JSON.stringify(result,null,2));
 console.log('Study:',result.status,result.error||'');
 if(result.status!=='fixed_fiscal_methods_A_B_C2_ablation_research_completed')process.exitCode=1;
 else{
  console.log('Original B:',result.benchmark.B_dow_four_hour.trades,result.benchmark.B_dow_four_hour.total_return_pct);
  console.log('Original C2 proxy:',result.existing_C2_proxy_combined_recomputed.trades,result.existing_C2_proxy_combined_recomputed.total_return_pct);
  for(const [key,value] of Object.entries(result.strategies))console.log(key,JSON.stringify({trades:value.replay_portfolio_result.trades,win:value.replay_portfolio_result.win_rate_pct,
   ret:value.replay_portfolio_result.total_return_pct,dd:value.replay_portfolio_result.max_drawdown_pct,
   missed_wins:value.independent_B_executed_trade_attribution.missed_B_winners,
   avoided_losses:value.independent_B_executed_trade_attribution.avoided_B_losers}));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
