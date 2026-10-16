// Auditable gold research benchmarks, using the SAME closed 4-hour gold bars and fixed test window.
// A: 1x buy-and-hold gold; B: Dow-inspired CONFIRMED daily+weekly swing trend plus 4h breakout;
// C: full V2.2 is an explicit fail-closed gate, not a fabricated backtest.
// No SMA substitution is silently labeled canonical Dow theory.
const {closedHigherFrames,classify}=require('./v22-dow-proxy-core');
const {scan}=require('./v22-price-pattern-core');
const {auditCandles}=require('./v22-execution-core');
const round=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
const side=d=>d==='long'?1:-1;
function ddFromPath(curve){
 let peak=-Infinity,worst=0;
 for(const row of curve){peak=Math.max(peak,row.equity);if(peak>0)worst=Math.max(worst,1-row.equity/peak)}
 return round(100*worst,2);
}
function yearReturns(curve){
 const grouping=new Map(),values=[];
 for(const p of curve){
  const y=new Date(p.time).getUTCFullYear();
  if(!grouping.has(y))grouping.set(y,[]);
  grouping.get(y).push(p);
 }
 let previous=null;
 for(const [year,vals] of [...grouping]){
  const start=previous??vals[0].start_equity??vals[0].equity;
  const end=vals.at(-1).equity;
  values.push({year,begin_equity_usd:round(start,2),end_equity_usd:round(end,2),return_pct:round(100*(end/start-1),2)});
  previous=end;
 }
 return values;
}
function evaluate({inputCandles,startDate='2025-06-02',initialCash=10000,costBpsRoundTrip=10,stopATR=1.5,maxBars=15,riskFraction=.005,maxLeverage=5}){
 if(!/20\d\d-\d\d-\d\d/.test(startDate)||!(initialCash>0&&costBpsRoundTrip>=0&&stopATR>0&&Number.isInteger(maxBars)&&maxBars>1&&maxBars<=100&&riskFraction>0&&riskFraction<=.02&&maxLeverage>0&&maxLeverage<=5))throw Error('Invalid frozen benchmark design');
 const raw=inputCandles.slice().sort((a,b)=>a.start_ms-b.start_ms),audited=auditCandles(raw);
 if(Object.values(audited.errors).some(x=>x))throw Error('Gold 4h OHLC dataset contains invalid/duplicate/unclosed interval: '+JSON.stringify(audited.errors));
 const bars=raw;
 const startIndex=bars.findIndex(b=>b.start_ms>=Date.parse(startDate+'T00:00:00Z'));
 if(startIndex<0||startIndex>=bars.length-50)throw Error('Insufficient common benchmark window');
 const dow=closedHigherFrames(bars),price=scan(bars,{lookback:20,atr_period:14,breakout_atr:.25,include_all_candidates:true});
 const map=new Map(bars.map((b,i)=>[b.start_ms,i]));
 const candidates=[],excluded={price_candidates:0,confirmation_missing_entry_bar:0,weekly_or_daily_structure_unconfirmed:0,trend_opposite_to_4h:0,trend_confirmed_same_direction:0};
 for(const p of price.confirmed_candidates||[]){
  const entryIndex=map.get(Date.parse(p.earliest_hypothetical_entry_open_utc));
  if(entryIndex===undefined||entryIndex<startIndex||entryIndex>=bars.length){excluded.confirmation_missing_entry_bar++;continue}
  excluded.price_candidates++;
  const at=Date.parse(p.confirmation_closed_utc);
  if(!Number.isFinite(at)||at>bars[entryIndex].start_ms)throw Error('Future trade timing');
  const check=classify(dow,at);
  if(!check.daily.direction||!check.weekly.direction){excluded.weekly_or_daily_structure_unconfirmed++;continue}
  if(check.agreed_direction!==p.direction){excluded.trend_opposite_to_4h++;continue}
  excluded.trend_confirmed_same_direction++;
  candidates.push({entryIndex,confirmed_at:at,dir:p.direction,atr:p.atr_14_4h,weekly:check.weekly,daily:check.daily});
 }
 candidates.sort((a,b)=>a.entryIndex-b.entryIndex||a.confirmed_at-b.confirmed_at);
 const schedule=new Map();
 for(const p of candidates){if(!schedule.has(p.entryIndex))schedule.set(p.entryIndex,p)}
 const commission=costBpsRoundTrip/20000;
 const first=bars[startIndex],last=bars.at(-1),qtyA=initialCash/first.open;
 const aFeeEntry=qtyA*first.open*commission;
 const aCurve=[],bCurve=[],trades=[],matchedLongReturns=[];
 let bCash=initialCash,bPosition=null,bTradesTaken=0,peakExposure=0,bBarsExposed=0,leverageBarSum=0;
 for(let i=startIndex;i<bars.length;i++){
  const bar=bars[i];
  if(!bPosition&&schedule.has(i)&&bCash>0){
   const signal=schedule.get(i),distance=stopATR*signal.atr,entry=bar.open;
   if(Number.isFinite(distance)&&distance>0&&Number.isFinite(entry)&&entry>distance){
    const qty=Math.min(bCash*riskFraction/distance,bCash*maxLeverage/entry);
    if(qty>0){
     const fee=qty*entry*commission;
     bCash-=fee;
     bPosition={signal,entry,qty,direction:side(signal.dir),stop:entry-side(signal.dir)*distance,
      feeEntry:fee,firstIndex:i,opened_at:bar.start_ms,capitalBefore:bCash+fee};
     peakExposure=Math.max(peakExposure,qty*entry/bPosition.capitalBefore);
     bTradesTaken++;
    }
   }
  }
  if(bPosition){
   bBarsExposed++;leverageBarSum+=bPosition.qty*bar.open/Math.max(0.01,bPosition.capitalBefore);
   const p=bPosition,stopped=p.direction===1?bar.low<=p.stop:bar.high>=p.stop;
   const reachedTime=i-p.firstIndex+1>=maxBars,forcedEnd=i===bars.length-1;
   if(stopped||reachedTime||forcedEnd){
    const exit=stopped?(p.direction===1?Math.min(p.stop,bar.open):Math.max(p.stop,bar.open)):bar.close;
    const feeExit=p.qty*exit*commission;
    const gross=p.direction*p.qty*(exit-p.entry);
    bCash+=gross-feeExit;
    trades.push({direction:p.direction===1?'long':'short',entry_at:new Date(p.opened_at).toISOString(),
     exit_at:new Date(bar.close_ms).toISOString(),entry_price:round(p.entry),exit_price:round(exit),
     equity_before_usd:round(p.capitalBefore,2),equity_after_usd:round(bCash,2),
     pnl_after_costs_usd:round(gross-p.feeEntry-feeExit,2),risk_fraction:.005,
     raw_direction_gold_change_pct:round(100*p.direction*(exit/p.entry-1)),
     same_trade_window_always_long_gold_pct:round(100*(exit/p.entry-1)),
     source_dow_confirmed_at_utc:new Date(p.signal.confirmed_at).toISOString(),
     reason:stopped?'stop_fill_at_stop_or_worse_gap':forcedEnd?'forced_end_of_sample':'time_exit'});
    matchedLongReturns.push(100*(exit/p.entry-1));
    bPosition=null;
   }
  }
  const exitFeeB=bPosition?bPosition.qty*bar.close*commission:0;
  const markB=bCash+(bPosition?bPosition.direction*bPosition.qty*(bar.close-bPosition.entry)-exitFeeB:0);
  const isLast=i===bars.length-1;
  const aExitFee=qtyA*bar.close*commission;
  const markA=qtyA*bar.close-aFeeEntry-aExitFee;
  aCurve.push({time:bar.close_ms,equity:markA,start_equity:initialCash});
  bCurve.push({time:bar.close_ms,equity:markB,start_equity:initialCash});
 }
 const wins=trades.filter(x=>x.pnl_after_costs_usd>0).length,closed=trades.length;
 const ends={A:aCurve.at(-1).equity,B:bCurve.at(-1).equity};
 const result={
  status:'gold_A_buyhold_vs_B_dow_four_hour_proxy_comparison_research_only',
  measured_genuine_V22_multi_factor_trades:false,
  time_window:{first_4h_start_utc:new Date(first.start_ms).toISOString(),last_4h_close_utc:new Date(last.close_ms).toISOString(),
   startDate_predeclared:startDate,shared_bars:bars.length-startIndex,initial_usd:initialCash},
  common_assumptions:{gold:'Yahoo continuous GC=F hourly to five-slot 4h New York evening sessions',cost_bps_roundtrip:costBpsRoundTrip,
   stop_atr:stopATR,maximum_4h_bars_held_B:maxBars,unit_risk_fraction_B:riskFraction,max_leverage_B:maxLeverage,
   A_exposure:'1x gold long fully invested from start to end (no leverage/rebalancing)',
   B_exposure:'Cash unless strict confirmed Dow daily AND weekly swing trend equals 4h breakout; 0.5pct risk / trade, 5x cap'},
  dow_higher_timeframe_proxy:{complete_daily_sessions:dow.daily.length,completed_weekly_proxies:dow.weekly.length,
   excluded_daily_due_missing_4h_slots:dow.quality.excluded_missing_four_hour_slots,
   excluded_incomplete_weeks:dow.quality.excluded_incomplete_week,
   caveat:'Daily uses full five available proxy slots until about NY 14:00, not official COMEX 17:00/settlement; weekly trend uses only prior confirmed pivots'},
  pattern_filter_counts:excluded,
  A_always_long:{trade_count:1,win_rate_pct:last.close>first.open?100:0,entry_open_gold:first.open,last_close_gold:last.close,
   total_return_pct:round(100*(ends.A/initialCash-1),2),max_mark_to_market_drawdown_pct:ddFromPath([{time:first.start_ms,equity:initialCash},...aCurve]),
   final_equity_usd:round(ends.A,2),by_year:yearReturns(aCurve)},
  B_dow_higher_frames_plus_4h:{total_patterns_screened:excluded.price_candidates,valid_trend_price_signals:candidates.length,
   executed_nonoverlapping_trades:closed,winning_trades:wins,long_trades:trades.filter(x=>x.direction==='long').length,short_trades:trades.filter(x=>x.direction==='short').length,
   percent_4h_bars_in_market:round(100*bBarsExposed/(bars.length-startIndex),2),average_4h_bar_notional_exposure_including_cash:round(leverageBarSum/(bars.length-startIndex),3),win_rate_pct:closed?round(100*wins/closed,1):null,
   total_return_pct:round(100*(ends.B/initialCash-1),2),max_mark_to_market_drawdown_pct:ddFromPath([{time:first.start_ms,equity:initialCash},...bCurve]),
   final_equity_usd:round(ends.B,2),peak_notional_leverage:round(peakExposure,2),
   same_exact_B_trade_intervals_always_long_raw_win_rate_pct:closed?round(100*matchedLongReturns.filter(x=>x>0).length/closed,1):null,
   same_exact_B_trade_intervals_always_long_average_raw_return_pct:closed?round(matchedLongReturns.reduce((s,x)=>s+x,0)/closed):null,
   by_year:yearReturns(bCurve),recent_costed_trade_ledger:trades.slice(-8)},
  C_original_V22:{status:'blocked_missing_original_full_point_in_time_signal_evidence',win_rate_pct:null,total_return_pct:null,
   max_drawdown_pct:null,trade_count:null,not_zero_trades_but_NOT_EVALUABLE:true,
   requirements_not_proven:['Historical as-published Fiscal D+1/3/5 expectation path and surprise/revision vintage','DTS announcement tax-spending forecast and TreasuryDirect publicly-held net new cash identity','Actual available TGA buffers, Fed/SOMA, ON RRP, SRF, reserve and SOFR-IORB regime at every candidate','Policy vs fiscal-credit reprice split for real rates and DXY','GLD actual cash creations/redemptions rather than proxy tonnes and COMEX trade-day contract OI volume','Certified official daily and weekly Dow settles versus partial 4h constructed proxies','Specific GC futures roll, OHLC intrabar slippage and broker costs','Untouched holdout including other regimes']},
  live_trade_signals_enabled:false,
  limitations:['A and B have DIFFERENT leverage/exposure: return and win rate are not risk-matched causal alpha tests',
   'Gold Yahoo GC=F continuous proxy may have roll jumps and cannot guarantee true traded fills',
   '4h OHLC conservative stop assumes stop or worse open if market gaps; intrabar order unknown',
   'Future weekly/daily bar revisions are not archived, prior confirmed pivot timing is enforced',
   'Sample was already examined in prior V2.2 development, so no true untouched 2025-26 out-of-sample evidence',
   'B is a fixed Dow-inspired pivot proxy and has NOT been established as the exact original agreed Dow rules',
   'C is never represented as zero returns or zero trades; genuine V2.2 remains scientifically unmeasured']};
 return result;
}
module.exports={evaluate,ddFromPath,yearReturns};
