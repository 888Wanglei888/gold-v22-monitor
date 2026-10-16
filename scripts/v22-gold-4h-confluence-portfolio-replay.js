// Frozen research-only apples-to-apples 4H execution with independent macro-flow filters.
// All results are recomputed trade-by-trade, same 4H breakout confirmations/stopATR/fees/equity sizing.
const fs=require('node:fs');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const {evaluate}=require('../lib/endpoints/v22-benchmark-core');
const {snap,delta,sumWindow}=require('../lib/endpoints/v22-cross-market-core');
const {DAY}=require('../lib/endpoints/v22-asof-core');
const FIXED={startDate:'2025-06-02',initialCash:10000,costBpsRoundTrip:10,stopATR:1.5,maxBars:15,riskFraction:.005,maxLeverage:5};
const modes={
 no_filter:null,
 macro_one:(v)=>v.macroVotes>=1,
 macro_both:(v)=>v.macroVotes===2,
 price_TGA:(v)=>v.T===1,
 price_COT:(v)=>v.C===1,
 price_GLD:(v)=>v.E===1,
 price_TGA_COT:(v)=>v.T===1&&v.C===1,
 price_DXY_TGA:(v)=>v.D===1&&v.T===1,
 price_REAL_TGA:(v)=>v.R===1&&v.T===1,
 price_macro1_TGA:(v)=>v.macroVotes>=1&&v.T===1,
 price_macro1_COT:(v)=>v.macroVotes>=1&&v.C===1,
 price_macro1_ETF:(v)=>v.macroVotes>=1&&v.E===1,
 price_macro1_flow1:(v)=>v.macroVotes>=1&&v.flowVotes>=1,
 price_macro1_flow2:(v)=>v.macroVotes>=1&&v.flowVotes>=2,
 price_macro_both_flow1:(v)=>v.macroVotes===2&&v.flowVotes>=1,
 price_macro_both_TGA_COT:(v)=>v.macroVotes===2&&v.T===1&&v.C===1,
 price_TGA_or_COT:(v)=>v.T===1||v.C===1,
 price_two_flows_any:(v)=>v.flowVotes>=2,
 price_macro1_no_double_flow_against:(v)=>v.macroVotes>=1&&v.flowAgainst<=1,
 price_no_both_macro_against_flow1:(v)=>v.macroAgainst<=1&&v.flowVotes>=1,
 price_TGA_COT_no_macro_double_against:(v)=>v.T===1&&v.C===1&&v.macroAgainst<=1,
 price_macro2_and_flow2:(v)=>v.macroVotes===2&&v.flowVotes>=2,
};
function tally(x){return x===true?1:x===false?-1:0}
function lookupFeatures(loaded,confirmed,dir,strictMissing){
 const side=dir==='long'?1:-1,src=loaded.sources,max=loaded.maxAgeDays;
 const vals={
  DX:delta(src,'DXY',confirmed,7,max),REAL:delta(src,'DFII10',confirmed,7,max),
  TGA:delta(src,'TGA',confirmed,7,max),COT:delta(src,'COT_NET',confirmed,28,max),
  GLD:sumWindow(src,'GLD_TONNES_DELTA',confirmed,7)
 };
 const seen={D:Number.isFinite(vals.DX),R:Number.isFinite(vals.REAL),T:Number.isFinite(vals.TGA),C:Number.isFinite(vals.COT),E:Number.isFinite(vals.GLD)};
 // Missing sources neutral when compare permissive vs strict policies; never count missing as confirmations.
 const V={D:seen.D?tally(side*vals.DX<0):0,R:seen.R?tally(side*vals.REAL<0):0,T:seen.T?tally(side*vals.TGA<0):0,
  C:seen.C?tally(side*vals.COT>0):0,E:seen.E?tally(side*vals.GLD>0):0};
 V.macroVotes=[V.D,V.R].filter(x=>x===1).length;
 V.macroAgainst=[V.D,V.R].filter(x=>x===-1).length;
 V.flowVotes=[V.T,V.C,V.E].filter(x=>x===1).length;
 V.flowAgainst=[V.T,V.C,V.E].filter(x=>x===-1).length;
 return {values:vals,votes:V,seen,complete:Object.values(seen).every(Boolean)};
}
function partial(r,reg,mode){
 const x=r.B_dow_higher_frames_plus_4h;
 return {policy:mode,start:r.time_window.first_4h_start_utc,end:r.time_window.last_4h_close_utc,
  cash_final:x.final_equity_usd,return_pct:x.total_return_pct,drawdown_pct:x.max_mark_to_market_drawdown_pct,
  trades:x.executed_nonoverlapping_trades,wins:x.winning_trades,win_rate_pct:x.win_rate_pct,
  avg_notional_exposure:x.average_4h_bar_notional_exposure_including_cash,peak_leverage:x.peak_notional_leverage,
  time_in_market_pct:x.percent_4h_bars_in_market,by_year:x.by_year,ledger:x.full_costed_trade_ledger,
  gate_counts:reg?.counts||null,pattern_filter_counts:r.pattern_filter_counts};
}
async function main(){
 const loaded=await loadResearchInputs();
 if(loaded.gold.length<1500)throw Error('Missing continuous 4h gold source');
 const inp={inputCandles:loaded.gold,...FIXED},base=evaluate(inp),memo=new Map();
 const makeGate=(mode,strictMissing=false)=>{
  const reg={counts:{evaluated:0,pass:0,incomplete:0,blocked:0,reason:{},seen:{D:0,R:0,T:0,C:0,E:0}},distinctConfirmations:[]};
  return {reg,gate(candidate){
   reg.counts.evaluated++;
   const key=candidate.confirmed_at+'#'+candidate.dir;
   let f=memo.get(key);
   if(!f){f=lookupFeatures(loaded,candidate.confirmed_at,candidate.dir);memo.set(key,f)}
   const {values,votes,seen,complete}=f;
   for(const k of Object.keys(seen))if(seen[k])reg.counts.seen[k]++;
   if(!complete)reg.counts.incomplete++;
   const eligible=(!strictMissing||complete)&&modes[mode](votes);
   if(eligible)reg.counts.pass++;else reg.counts.blocked++;
   if(reg.distinctConfirmations.length<22)reg.distinctConfirmations.push({confirmed:new Date(candidate.confirmed_at).toISOString(),direction:candidate.dir,eligible,votes,raw:values});
   return {eligible,reason:eligible?'research_asof_multifactor_pass':!complete&&strictMissing?'missing_macro_source':'not_enough_frozen_votes',
    features:{signal_confirmed_at_utc:new Date(candidate.confirmed_at).toISOString(),regime_votes:votes,raw_asof:values,all_five_available:complete,original_v22_certified:false}};
  }};
 };
 const outputs={},sensitive={};outputs.no_filter=partial(base,null,'no_filter');
 for(const mode of Object.keys(modes)){
  if(mode==='no_filter')continue;
  const x=makeGate(mode);
  const ev=evaluate({...inp,entryGate:x.gate});
  outputs[mode]=partial(ev,x.reg,mode);
 }
 // Missing data vs selection discretion: mandatory 5-source gate.
 for(const mode of ['price_TGA_COT','price_macro1_flow1','price_TGA_or_COT','price_no_both_macro_against_flow1']){
  const x=makeGate(mode,true),ev=evaluate({...inp,entryGate:x.gate});
  sensitive[mode+'_COMPLETE5']=partial(ev,x.reg,mode+'_COMPLETE5');
 }
 // Cost stress test: same signals, 0, 10 and 20 bps round-trip, full recalc.
 const costs={};
 for(const mode of ['no_filter','price_GLD','price_two_flows_any','price_TGA_COT','price_macro1_flow1','price_TGA_or_COT']){
  costs[mode]={};
  for(const c of [0,10,20,35]){
   const x=mode==='no_filter'?null:makeGate(mode);
   const ev=evaluate({...inp,costBpsRoundTrip:c,entryGate:x?.gate||null});
   costs[mode][c]={total_return_pct:ev.B_dow_higher_frames_plus_4h.total_return_pct,max_mark_to_market_drawdown_pct:ev.B_dow_higher_frames_plus_4h.max_mark_to_market_drawdown_pct,trade_count:ev.B_dow_higher_frames_plus_4h.executed_nonoverlapping_trades,win_rate_pct:ev.B_dow_higher_frames_plus_4h.win_rate_pct};
  }
 }
 const expectedLedger=base.B_dow_higher_frames_plus_4h.full_costed_trade_ledger;
 const previous=require('../reports/v22-c1-three-way-latest.json').B_dow_four_hour;
 const originalMatch=previous.executed_nonoverlapping_trades===expectedLedger.length&&
  Math.abs(previous.final_equity_usd-base.B_dow_higher_frames_plus_4h.final_equity_usd)<=0.02;
 const srcCoverage={gold_4h:loaded.gold.length,...loaded.coverage};
 const result={created_utc:new Date().toISOString(),status:'research_full_4h_recomputed_macro_flow_confluence_research_proxy',
  original_baseline_exactly_reproduced:originalMatch,
  benchmark_frozen:FIXED,coverage:srcCoverage,data_source_errors:loaded.source_errors,
  methodology:{same_price_patterns_as_baseline:true,always_next_available_4h_open:true,stopATR:1.5,maxBars:15,
   stop_assumes_worse_gap:true,independent_recomputed_portfolio:true,all_results_exploratory:true,
   year_2025_and_2026_compared:true,macro_window_calendar_days:7,futures_lookback_calendar_days:28,
   shared_asof_lags:loaded.maxAgeDays,macros:'DXY down and real yield down for long, vice versa short',
   flows:'TGA down, managed money net longs up, official GLD vault tonnes up for long, vice versa short',
   missing_default:'unknown is not a vote; policies may trade if enough observed votes',extra_sensitivity:'all five feature availability required',
   gates_evaluated_at:'prior 4h price confirmation close, before next available entry candle',
   cash_return_compared_to_same_date_price_only_and_strict_4h_baseline:true,
   restrictions:['Using revised historical FRED and TGA daily data, not archived official announcement vintages','CFTC weekly publication lag approximated and shutdown exceptions not fully certified','GLD tonnes stock is not primary market investor creation dollars','Yahoo GC=F continuous future is a proxy with roll effects','Prior 2025-2026 observed when formulating these conditions, not untouched OOS','Some proposals among tested filters are post-hoc exploratory and cannot be selected as winner without new sample']},
  original_base_compare:{previous_B_trades:previous.executed_nonoverlapping_trades,previous_B_final_equity_usd:previous.final_equity_usd},
  variants:outputs,strict_data_availability_variants:sensitive,cost_sensitivity:costs};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_V22_4H_MULTIFACTOR_REPLAY.json',JSON.stringify(result,null,2));
 const cols=['policy','trades','wins','win_rate_pct','cash_final','return_pct','drawdown_pct','time_in_market_pct','avg_notional_exposure','peak_leverage','year_2025_return_pct','year_2026_return_pct','gate_candidates_evaluated','gate_pass'];
 const rows=Object.values(outputs).map(x=>{const year=y=>x.by_year.find(z=>z.year===y)?.return_pct??null;
 return [x.policy,x.trades,x.wins,x.win_rate_pct,x.cash_final,x.return_pct,x.drawdown_pct,x.time_in_market_pct,x.avg_notional_exposure,x.peak_leverage,year(2025),year(2026),x.gate_counts?.evaluated??'',x.gate_counts?.pass??'']});
 fs.writeFileSync('research-data/GOLD_V22_4H_MULTIFACTOR_REPLAY_SUMMARY.csv',[cols.join(','),...rows.map(x=>x.map(y=>y??'').join(','))].join('\n')+'\n');
 console.log('BASELINE',originalMatch,JSON.stringify(outputs.no_filter));
 console.log('RESULTS',JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([id,v])=>[id,Object.fromEntries(Object.entries(v).filter(([k])=>!['ledger','by_year','gate_counts','pattern_filter_counts'].includes(k)))]))));
 console.log('YEAR',JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([id,v])=>[id,v.by_year]))));
 console.log('COST',JSON.stringify(costs));
}
main().catch(e=>{console.error('BACKTEST_FATAL',e);process.exitCode=1});
