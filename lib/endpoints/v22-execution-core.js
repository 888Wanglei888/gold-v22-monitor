// V2.2 deterministic 4-hour execution and position-risk engine.
// External multi-factor signal decisions MUST already be independently time-stamped and verified.
// This module never creates/approves A/A+/A++ macro signals.
const levels={A:.005,'A+':.0075,'A++':.01};
const valid=x=>Number.isFinite(x)&&x>0;
function auditCandles(input){
 const out=[],errors={invalid_ohlc:0,duplicate_or_out_of_order:0,unclosed:0,overlapping_bars:0};
 let priorEnd=-Infinity;
 for(const raw of input){
  const x={start_ms:Number(raw.start_ms),close_ms:Number(raw.close_ms),open:Number(raw.open),high:Number(raw.high),low:Number(raw.low),close:Number(raw.close)};
  if(!Number.isFinite(x.start_ms)||!Number.isFinite(x.close_ms)||x.close_ms<=x.start_ms||!['open','high','low','close'].every(k=>valid(x[k]))||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)){errors.invalid_ohlc++;continue}
  if(x.start_ms<priorEnd){errors.overlapping_bars++;continue}
  if(x.close_ms> Date.now()){errors.unclosed++;continue}
  if(out.length&&x.start_ms<=out[out.length-1].start_ms){errors.duplicate_or_out_of_order++;continue}
  out.push(x);priorEnd=x.close_ms;
 }
 return {candles:out,errors};
}
function atr(candles,end,n=14){
 if(end<n-1||!Number.isInteger(end))return null;
 let sum=0;
 for(let i=end-n+1;i<=end;i++){
  const x=candles[i],prev=i>0?candles[i-1]:null;
  if(!x)return null;
  const trueRange=Math.max(x.high-x.low,prev?Math.abs(x.high-prev.close):0,prev?Math.abs(x.low-prev.close):0);
  sum+=trueRange;
 }
 return sum/n;
}
function permittedSignal(s,at){
 const mandatory=['fiscal_forecast_asof_verified','treasury_components_reconciled','dollar_liquidity_confirmed','real_yield_and_dxy_regime_confirmed','gold_positioning_confirmed','dow_weekly_daily_trend_confirmed'];
 if(!s||!['long','short'].includes(s.direction)||!Object.hasOwn(levels,s.grade)||!Number.isFinite(s.known_at_ms)||s.known_at_ms>at||s.known_at_ms<0)return {ok:false,missing:['valid_signal_and_prior_timestamp']};
 const missing=mandatory.filter(k=>s.evidence?.[k]!==true);
 // Two modes agreed for V2.2: anticipation can trade already known future fiscal path
 // BEFORE settlement even without a daily Z spike; revision mode must validate abnormal forecast change.
 if(s.mode==='anticipation'){
  if(s.evidence?.future_fiscal_cashflow_path_asof_verified!==true)missing.push('future_fiscal_cashflow_path_asof_verified');
  if(s.evidence?.pre_event_pricing_confirmation_verified!==true)missing.push('pre_event_pricing_confirmation_verified');
 }else if(s.mode===undefined||s.mode==='revision'){
  if(!Number.isFinite(s.forecast_z)||Math.abs(s.forecast_z)<({A:.75,'A+':1,'A++':1.5}[s.grade]))missing.push('forecast_revision_z_threshold');
 }else missing.push('valid_trade_opportunity_mode');

 if(s.factor_status!=='asof_verified')missing.push('asof_data_status');
 return {ok:missing.length===0,missing};
}
function backtest(candles,candidates,opts={}){
 const params={initial_cash_usd:opts.initial_cash_usd??10000,stop_atr:opts.stop_atr,max_bars:opts.max_bars,breakout_atr:opts.breakout_atr??.25,lookback:opts.lookback??20,atr_period:opts.atr_period??14,roundtrip_cost_bps:opts.roundtrip_cost_bps??10,max_leverage:opts.max_leverage??5};
 if(!valid(params.initial_cash_usd)||!valid(params.stop_atr)||!Number.isInteger(params.max_bars)||params.max_bars<1||params.max_bars>200||!valid(params.breakout_atr)||params.lookback<5||!Number.isInteger(params.lookback)||params.atr_period<5||params.max_leverage>5||params.max_leverage<=0)throw Error('Explicit stop ATR, max holding bars and bounded leverage required');
 const inspect=auditCandles(candles);
 if(Object.values(inspect.errors).some(n=>n>0))return {status:'OHLC_FAILED_CLOSED',errors:inspect.errors,trades:0,signals_enabled:false};
 const bars=inspect.candles,signals=(candidates||[]).slice().sort((a,b)=>a.known_at_ms-b.known_at_ms);
 const rejected={missing_macro_evidence:0,technical_breakout_unconfirmed:0,insufficient_candles:0,stale_signal:0,overlap:0},trades=[];
 let balance=params.initial_cash_usd,occupiedThrough=-1,peak=balance,maxDD=0;
 for(const s of signals){
  const signalIndex=bars.findIndex(b=>b.close_ms>=s.known_at_ms);
  if(signalIndex<Math.max(params.lookback,params.atr_period)||signalIndex+2>=bars.length){rejected.insufficient_candles++;continue}
  if(signalIndex<=occupiedThrough){rejected.overlap++;continue}
  const bar=bars[signalIndex],auth=permittedSignal(s,bar.close_ms);
  if(!auth.ok){rejected.missing_macro_evidence++;continue}
  if(bar.close_ms-s.known_at_ms>86400000){rejected.stale_signal++;continue}
  const past=bars.slice(signalIndex-params.lookback,signalIndex);
  const xatr=atr(bars,signalIndex-1,params.atr_period),upper=Math.max(...past.map(x=>x.high)),lower=Math.min(...past.map(x=>x.low));
  const breakout=s.direction==='long'?bar.close>upper+params.breakout_atr*xatr:bar.close<lower-params.breakout_atr*xatr;
  const confirm=bars[signalIndex+1],entry=bars[signalIndex+2];
  const confirmOk=s.direction==='long'?confirm.close>upper:confirm.close<lower;
  if(!breakout||!confirmOk||confirm.close_ms>bar.close_ms+30*3600000||entry.start_ms<confirm.close_ms||entry.start_ms>confirm.close_ms+30*3600000){rejected.technical_breakout_unconfirmed++;continue}
  const stopDistance=params.stop_atr*xatr,open=entry.open;
  if(!valid(stopDistance)||!valid(open)){rejected.technical_breakout_unconfirmed++;continue}
  const direction=s.direction==='long'?1:-1,stop=open-direction*stopDistance;
  if(stop<=0){rejected.technical_breakout_unconfirmed++;continue}
  const preBalance=balance,quantity=Math.min((balance*levels[s.grade])/stopDistance,(balance*params.max_leverage)/open);
  if(!valid(quantity)){rejected.technical_breakout_unconfirmed++;continue}
  const maxIndex=Math.min(bars.length-1,signalIndex+1+params.max_bars);
  let exitPrice=null,exitIndex=signalIndex+2,why='time_exit';
  for(let i=signalIndex+2;i<=maxIndex;i++){
   const b=bars[i],stopHit=s.direction==='long'?b.low<=stop:b.high>=stop;
   if(stopHit){exitPrice=s.direction==='long'?Math.min(stop,b.open):Math.max(stop,b.open);exitIndex=i;why='stop_gap_or_touch';break}
   exitPrice=b.close;exitIndex=i;
  }
  if(exitPrice===null)continue;
  // Charge costs on entry + exit notional; gross risk budget only applies to stop distance.
  const pnl=direction*quantity*(exitPrice-open)-quantity*(open+exitPrice)*params.roundtrip_cost_bps/20000;
  balance+=pnl;
  occupiedThrough=exitIndex;
  peak=Math.max(peak,balance);maxDD=Math.max(maxDD,peak>0?(peak-balance)/peak:1);
  trades.push({grade:s.grade,direction:s.direction,signal_closed_utc:new Date(bar.close_ms).toISOString(),confirmed_utc:new Date(confirm.close_ms).toISOString(),
   entry_utc:new Date(entry.start_ms).toISOString(),exit_utc:new Date(bars[exitIndex].close_ms).toISOString(),entry_price:open,exit_price:exitPrice,exit_reason:why,
   risk_budget_pct:levels[s.grade]*100,position_notional_to_equity:quantity*open/preBalance,pnl_usd:+pnl.toFixed(2),post_trade_equity_usd:+balance.toFixed(2)});
 }
 return {status:'research_execution_ledger_only_not_verified_v22_signals',signals_evaluated:signals.length,trades:trades.length,win_rate_pct:trades.length?+(100*trades.filter(x=>x.pnl_usd>0).length/trades.length).toFixed(1):null,
  final_equity_usd:+balance.toFixed(2),total_return_pct:+(100*(balance/params.initial_cash_usd-1)).toFixed(2),
  max_closed_trade_equity_drawdown_pct:+(100*maxDD).toFixed(2),parameters:params,rejected,recent_trades:trades.slice(-8),
  no_real_signal_proof:true,signals_enabled:false,limitations:['Requires audited external V2.2 as-of macro and fiscal confirmations, never fills missing signals','Gold continuous contract roll/specific executable futures, broker spreads and fill assumptions unverified','OHLC-only stop fill assumes stop or worse opening gap, does not know intrabar path','Equity drawdown computed on CLOSED trades only; intratrade mark-to-market drawdown absent','Exit risk parameters must be user-approved or frozen before claiming original V2.2 performance']};
}
module.exports={auditCandles,atr,permittedSignal,backtest};
