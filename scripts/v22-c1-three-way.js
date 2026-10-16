// Research-only C1 gold strategy benchmark using all actually retrievable as-of sources.
// Reuses exact same A/B Dow 4h stop sizing, execution and costs. No claim of complete V2.2 C2.
const fs=require('node:fs');
const source=require('../lib/endpoints/v22-asof-join');
const {loadFiscalForecastFromTreasury}=require('../lib/endpoints/v22-c1-fiscal-source');
const {evaluate}=require('../lib/endpoints/v22-benchmark-core');
const {makeGate}=require('../lib/endpoints/v22-c1-gate-core');
const {makeC2,modes}=require('../lib/endpoints/v22-c2-core');
const same={startDate:'2025-06-02',initialCash:10000,costBpsRoundTrip:10,stopATR:1.5,maxBars:15,riskFraction:.005,maxLeverage:5};
async function main(){
 const report={checked_at_utc:new Date().toISOString(),source_sha:process.env.GITHUB_SHA||null,
  status:'research_C1_pending',scope:'C1 exploratory expectation-first fiscal plus macro gold flow filter above existing B actual execution',
  genuine_full_C2_V22_signals_verified:false,live_trade_signals_enabled:false,predeclared_policies:['C1_guardrail','C1_confirmed','C1_strict']};
 try{
  const loaded=await source.loadResearchInputs();
  if(loaded.gold.length<1700)throw Error('Required actual GOLD GC=F 4h OHLC unavailable '+loaded.gold.length);
  const fiscal=await loadFiscalForecastFromTreasury(loaded.sources.TGA);
  const inputs={inputCandles:loaded.gold,...same};
  const B=evaluate(inputs);
  const variants={};
  for(const policy of report.predeclared_policies){
   const {gate,counters,limits}=makeGate({sources:loaded.sources,maxAgeDays:loaded.maxAgeDays,
    decisionForecasts:fiscal.decisionForecasts,policy});
   const evaluation=evaluate({...inputs,entryGate:gate});
   // Audit B's exact original executed entry choices, NOT just potentially overlapping price patterns.
   const retrospect=makeGate({sources:loaded.sources,maxAgeDays:loaded.maxAgeDays,
    decisionForecasts:fiscal.decisionForecasts,policy});
   const comparison=B.B_dow_higher_frames_plus_4h.full_costed_trade_ledger.map(t=>{
    const decision=retrospect.gate({confirmed_at:Date.parse(t.source_dow_confirmed_at_utc),dir:t.direction});
    return {B_entry_utc:t.entry_at,B_exit_utc:t.exit_at,direction:t.direction,
     B_net_pnl_usd:t.pnl_after_costs_usd,B_won:t.pnl_after_costs_usd>0,
     C1_screen_pass:decision.eligible,filter_reason:decision.reason,
     audit_features:decision.features||null};
   });
   const caughtWin=comparison.filter(x=>x.C1_screen_pass&&x.B_won).length,
         missedWin=comparison.filter(x=>!x.C1_screen_pass&&x.B_won).length,
         avoidedLoss=comparison.filter(x=>!x.C1_screen_pass&&!x.B_won).length,
         retainedLoss=comparison.filter(x=>x.C1_screen_pass&&!x.B_won).length;
   variants[policy]={
    type:'EXPLORATORY PROXY C1, not real original V2.2 or untouched backtest',
    source_asof:counters,
    mode:'anticipation; D+3 expected TGA not same-day Z-score gate',
    filter_definition:limits,
    B_executed_trade_counterfactual:{B_trades:B.B_dow_higher_frames_plus_4h.executed_nonoverlapping_trades,
     passed_B_trades:comparison.filter(x=>x.C1_screen_pass).length,kept_B_winners:caughtWin,
     missed_B_winners:missedWin,avoided_B_losers:avoidedLoss,kept_B_losers:retainedLoss,
     original_B_entries_with_pre_entry_macro_evidence:comparison},
    C1_portfolio_recomputed_from_all_gated_candidates:{
     executed_nonoverlapping_trades:evaluation.B_dow_higher_frames_plus_4h.executed_nonoverlapping_trades,
     winning_trades:evaluation.B_dow_higher_frames_plus_4h.winning_trades,
     win_rate_pct:evaluation.B_dow_higher_frames_plus_4h.win_rate_pct,
     total_return_pct:evaluation.B_dow_higher_frames_plus_4h.total_return_pct,
     max_mark_to_market_drawdown_pct:evaluation.B_dow_higher_frames_plus_4h.max_mark_to_market_drawdown_pct,
     final_equity_usd:evaluation.B_dow_higher_frames_plus_4h.final_equity_usd,
     peak_notional_leverage:evaluation.B_dow_higher_frames_plus_4h.peak_notional_leverage,
     percent_4h_bars_in_market:evaluation.B_dow_higher_frames_plus_4h.percent_4h_bars_in_market,
     by_year:evaluation.B_dow_higher_frames_plus_4h.by_year,
     trade_ledger:evaluation.B_dow_higher_frames_plus_4h.full_costed_trade_ledger,
     excluded_macro_reasons:evaluation.blocked_macro_examples,
     pattern_filter_counts:evaluation.pattern_filter_counts}
   };
  }
  report.status='C1_proxy_Three_policy_gold_benchmark_completed_research_only';
  report.gold_source={closed_4h_bars:loaded.gold.length,quality:loaded.gold_quality,source:'GC=F Yahoo 1h grouped 4h; previous 2025-2026 research window'};
  report.sources={coverage:loaded.coverage,errors:loaded.source_errors,gld_official_holdings_verified_schema:loaded.gld_provenance,
   vintages_verified:false,source_specific_max_age_days:loaded.maxAgeDays};
  report.fiscal={coverage:fiscal.coverage,past_only_D1_D3_D5_scores:fiscal.projection_scores,
   historical_original_publication_vintage_verified:false};
  report.fixed_fair_comparison_window=B.time_window;
  report.shared_risk_and_costs=B.common_assumptions;
  report.A_buyhold=B.A_always_long;
  report.B_dow_four_hour=B.B_dow_higher_frames_plus_4h;
  report.C1_proxy_sensitivity=variants;

  // C2 empirical *proxy* research shares EXACTLY the B trades, execution risk/cost and historical window.
  // Both fiscal paths run: expected future liquidity (no mandatory same-day Z), shock revision,
  // plus transparent fiscal credit-discount exception. Never promote to live official trading.
  const c2Report={checked_at_utc:new Date().toISOString(),source_sha:process.env.GITHUB_SHA||null,
    status:'C2_proxy_research_preparing',live_trade_signals_enabled:false,
    complete_historical_publication_vintages_verified:false,
    methods:['anticipation','credit_exception','revision','combined'],
    fixed_backtest_assumptions:same,
    same_window_B_baseline:{trades:B.B_dow_higher_frames_plus_4h.executed_nonoverlapping_trades,
      return_pct:B.B_dow_higher_frames_plus_4h.total_return_pct,drawdown_pct:B.B_dow_higher_frames_plus_4h.max_mark_to_market_drawdown_pct,
      win_rate_pct:B.B_dow_higher_frames_plus_4h.win_rate_pct},
    same_window_A_baseline:{return_pct:B.A_always_long.total_return_pct,drawdown_pct:B.A_always_long.max_mark_to_market_drawdown_pct},
    fiscal_historical_revisions:{count:fiscal.revisionRecords.length,summary:fiscal.revision_diagnostics},
    all_source_coverage:loaded.coverage,
    historical_alfred_and_comex_proof_missing:true,variants:{}};
  for(const mode of modes){
    const overlay=makeC2({sources:loaded.sources,maxAgeDays:loaded.maxAgeDays,
      decisionForecasts:fiscal.decisionForecasts,revisionRecords:fiscal.revisionRecords,mode});
    const trade=evaluate({...inputs,entryGate:overlay.gate});
    const bLedger=B.B_dow_higher_frames_plus_4h.full_costed_trade_ledger;
    const replay=makeC2({sources:loaded.sources,maxAgeDays:loaded.maxAgeDays,
      decisionForecasts:fiscal.decisionForecasts,revisionRecords:fiscal.revisionRecords,mode});
    const bComparison=bLedger.map(t=>{
      const e=replay.gate({confirmed_at:Date.parse(t.source_dow_confirmed_at_utc),dir:t.direction});
      return {entry_utc:t.entry_at,direction:t.direction,b_pnl_usd:t.pnl_after_costs_usd,
        b_won:t.pnl_after_costs_usd>0,c2_proxy_eligible:e.eligible,decision:e.reason,feature_evidence:e.features||null};
    });
    const bRetained=bComparison.filter(x=>x.c2_proxy_eligible);
    const totals=trade.B_dow_higher_frames_plus_4h;
    c2Report.variants[mode]={risk:'uniform_0.5_percent_as_B',data_type:'proxy_model_not_certified_original_C2',
      source_signal_checks:overlay.counts,
      full_portfolio:{trades:totals.executed_nonoverlapping_trades,win_rate_pct:totals.win_rate_pct,
        return_pct:totals.total_return_pct,max_drawdown_pct:totals.max_mark_to_market_drawdown_pct,
        end_equity_usd:totals.final_equity_usd,active_4h_bar_pct:totals.percent_4h_bars_in_market,
        yearly:totals.by_year,trade_ledger:totals.full_costed_trade_ledger},
      b_trade_effect:{B_trades:bComparison.length,retained_b_winning:bRetained.filter(x=>x.b_won).length,
        discarded_b_winning:bComparison.filter(x=>!x.c2_proxy_eligible&&x.b_won).length,
        discarded_b_losing:bComparison.filter(x=>!x.c2_proxy_eligible&&!x.b_won).length,
        retained_b_losing:bRetained.filter(x=>!x.b_won).length,
        original_B_trade_decision_evidence:bComparison}};
  }
  // C2 risk grades are not historical official grades. Show *separate* exploratory sensitivity.
  const graded=makeC2({sources:loaded.sources,maxAgeDays:loaded.maxAgeDays,
    decisionForecasts:fiscal.decisionForecasts,revisionRecords:fiscal.revisionRecords,mode:'combined'});
  const gradedResult=evaluate({...inputs,entryGate:graded.gate,riskByGrade:true}).B_dow_higher_frames_plus_4h;
  c2Report.combined_research_grade_risk_sensitivity={A:.005,'A+':.0075,'A++':.01,
    trades:gradedResult.executed_nonoverlapping_trades,win_rate_pct:gradedResult.win_rate_pct,
    return_pct:gradedResult.total_return_pct,max_drawdown_pct:gradedResult.max_mark_to_market_drawdown_pct,
    end_equity_usd:gradedResult.final_equity_usd,trade_ledger:gradedResult.full_costed_trade_ledger,
    warning:'These A/A+/A++ are C2 PROXY research confidence grades, NOT official verified original gold V2.2 grade outcomes'};
  c2Report.status='C2_dual_mode_gold_v22_proxy_backtest_completed_research_not_official';
  c2Report.provenance_limits=['No certified ALFRED historical vintage for every macro feed','No complete TreasuryDirect all-day ex-ante Net New Cash against actual TGA',
    'GLD tonnes instead of full ETF USD net flows; weekly CFTC managed money instead of daily CME futures OI and volume',
    'Credit premium proxy rather than official ACM term premium','5-slot 4h-based synthetic Dow daily/weekly frames are not CME official daily settlement bars',
    'Short development period ~11 B trades; zero/rare revision-mode signals do NOT prove original V2.2 failed',
    'C2 research follows existing B breakout entry timings, so does not exhaust independent macro-initiated opportunities',
    'Fixed 10bp cost assumes execution conditions that are not broker-confirmed'];
  fs.writeFileSync('reports/v22-c2-proxy-latest.json',JSON.stringify(c2Report,null,2));
  console.log('C2 PROXY research',JSON.stringify(Object.fromEntries(Object.entries(c2Report.variants).map(([name,v])=>[name,{
   trades:v.full_portfolio.trades,return_pct:v.full_portfolio.return_pct,drawdown:v.full_portfolio.max_drawdown_pct,
   winners_saved:v.b_trade_effect.retained_b_winning,losses_avoided:v.b_trade_effect.discarded_b_losing}]))));

  report.C2_full_original_V22=B.C_original_V22;
  report.precision_warnings=[
   'Do not report C1 as measured complete official V2.2 C2 strategy: several factors are proxy and original announcement release vintages missing',
   'C1 policies were predeclared in code but NOT true untouched preregistration; this development window previously analyzed',
   'All alternative variants are reported even if some yield zero trades; no cherry-picked winner',
   'B and C1 use identical A/B simulator, broker proxy 10bps roundtrip, 0.5% risk, ATR stop and next-open entry',
   'C1 tests filter only B-style confirmed Dow and 4h candidates; original C2 independent macro-led entry opportunities may be missed',
   'Treasury forecast D+3 is an estimated cashflow path with historical imputed unannounced gross bill sales',
   'DXY/real yield current-vintage and GLD holdings weekly CFTC proxy lag assumptions not certified as-published',
   'Missing GLD source or CFTC/monetary source blocks C1 signals rather than treating missing observations as bullish',
   '11 B trades are a small overlapping in-sample research ledger; no reliable causal lift or next-year forecast',
   'Live signals remain disabled'];
 }catch(e){
  report.status='C1_three_way_research_blocked_by_source_or_implementation';
  report.error=String(e.stack||e);
 }
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-c1-three-way-latest.json',JSON.stringify(report,null,2));
 console.log('C1 status',report.status);
 if(report.error)console.error(report.error);
 else{
  console.log('A/B',report.A_buyhold.total_return_pct,report.B_dow_four_hour.total_return_pct,report.B_dow_four_hour.executed_nonoverlapping_trades);
  for(const [policy,x] of Object.entries(report.C1_proxy_sensitivity))
   console.log(policy,JSON.stringify({trades:x.C1_portfolio_recomputed_from_all_gated_candidates.executed_nonoverlapping_trades,
    pnl:x.C1_portfolio_recomputed_from_all_gated_candidates.total_return_pct,
    original_B_entries_kept:x.B_executed_trade_counterfactual.passed_B_trades,
    filter:x.source_asof}));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
