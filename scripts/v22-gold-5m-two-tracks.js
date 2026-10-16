// Historical gold GC=F intraday research, 5-minute DIRECT QUOTES not synthesized from 1h.
// Track I: five-minute fills after true completed 4-hour signals.
// Track II: independent five-minute NY morning strategies, long and short, no overnight.
// Same 10000USD, risk, 10bp fees; 30bp fee stress, and fixed chronological 70/30 validation.
const fs=require('node:fs'),crypto=require('node:crypto');
const {clean5m,evaluateIntraday}=require('../lib/endpoints/v22-gold-5m-intraday-core');
const {studyRefinement}=require('../lib/endpoints/v22-gold-5m-refine-core');
const {build4h}=require('../lib/endpoints/v22-asof-core');
const DAY=86400000,now=Date.now(),start5m=now-58*DAY;
const methods=['NY_opening_range_30m_breakout','EMA20_EMA60_5m_pullback','prior_12bar_channel_breakout','Bollinger24_2sigma_mean_revert'];
const round=v=>Number.isFinite(v)?+v.toFixed(2):null;
async function yahoo(interval,start){
 const base=new URL('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF');
 base.searchParams.set('period1',String(Math.floor(start/1000)));
 base.searchParams.set('period2',String(Math.floor(now/1000)));
 base.searchParams.set('interval',interval);
 const response=await fetch(base,{signal:AbortSignal.timeout(50000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!response.ok)throw Error('Yahoo gold '+interval+' HTTP '+response.status);
 const chart=(await response.json()).chart;
 if(chart?.error)throw Error('Yahoo gold '+interval+' '+JSON.stringify(chart.error));
 const x=chart?.result?.[0];
 if(!x?.timestamp?.length)throw Error('No real '+interval+' gold price timestamps');
 const q=x.indicators?.quote?.[0]||{};
 return {bars:x.timestamp.map((t,i)=>({t:t*1000,open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]})),
  source:{instrument:x.meta?.symbol,exchange:x.meta?.fullExchangeName,currency:x.meta?.currency,
   exchange_timezone:x.meta?.exchangeTimezoneName,data_granularity:x.meta?.dataGranularity}};
}
function brief(s){
 return {trades:s.executed_trades,winners:s.winning_trades,losers:s.losing_trades,win_rate_pct:s.win_rate_pct,
  return_pct:s.return_pct,max_drawdown_pct:s.max_drawdown_pct,final_equity_usd:s.end_equity_usd,
  average_trade_net_usd:s.average_pnl_usd,paid_fees_usd:s.paid_estimated_roundtrip_fees_usd,
  market_exposure_5m_bar_pct:s.market_exposure_bar_pct,estimated_average_leverage:s.mean_entry_notional_leverage,
  engine_counts:s.engine_counters,trade_ledger:s.trade_ledger};
}
function mapResults(x){return Object.fromEntries(Object.entries(x.strategies).map(([key,v])=>[key,brief(v)]))}
function buyhold1x(data,costBps){
 const prices=data.bars;if(prices.length<2)return null;
 const entry=prices[0].open,exit=prices.at(-1).close,qty=10000/entry,fees=qty*(entry+exit)*costBps/20000;
 const curve=prices.map(v=>qty*v.close-qty*entry*costBps/20000-qty*v.close*costBps/20000);
 let peak=10000,dd=0;for(const p of curve){peak=Math.max(peak,p);dd=Math.max(dd,1-p/peak)}
 return {return_pct:round(100*(qty*(exit-entry)-fees)/10000),
  max_drawdown_pct:round(100*dd),end_equity_usd:round(10000+qty*(exit-entry)-fees),
  caveat:'1x long held THROUGH ALL 5m source dates, not exposure-matched to intraday risk-managed methods'};
}
async function main(){
 const report={created_utc:new Date(now).toISOString(),github_sha:process.env.GITHUB_SHA||null,
  status:'gold_5m_dual_track_research_preparing',trade_signals_enabled:false,
  genuine_all_years_5m_history_available:false,
  original_full_v22_trade_results_claimed:false};
 try{
  const [q5,q1]=await Promise.all([yahoo('5m',start5m),yahoo('1h',Date.UTC(2024,11,1))]);
  // Keep the OBSERVATION WINDOW FIXED across repeated CI runs, so a few minutes of shifting
  // Yahoo retention cannot change sample boundaries or be confused with strategy alpha.
  const fixedStart='2026-08-20T00:00:00.000Z',fixedEndExclusive='2026-10-16T00:00:00.000Z';
  const sourceHistory=q5.bars.map(x=>({start_ms:x.t,...x}));
  const fixedHistory=sourceHistory.filter(x=>x.start_ms>=Date.parse(fixedStart)&&x.start_ms<Date.parse(fixedEndExclusive));
  const data=clean5m(fixedHistory,now);
  const fixedDataFingerprint=crypto.createHash('sha256').update(data.bars.map(x=>[
   x.start_ms,x.open.toFixed(4),x.high.toFixed(4),x.low.toFixed(4),x.close.toFixed(4)
  ].join(',')).join(';')).digest('hex');
  const stableStart=Date.parse('2026-09-01T00:00:00.000Z'),stableEnd=Date.parse('2026-10-15T00:00:00.000Z');
  const stableRange=data.bars.filter(x=>x.start_ms>=stableStart&&x.start_ms<stableEnd);
  const stableFingerprint=crypto.createHash('sha256').update(stableRange.map(x=>[
   x.start_ms,x.open.toFixed(4),x.high.toFixed(4),x.low.toFixed(4),x.close.toFixed(4)
  ].join(',')).join(';')).digest('hex');
  if(data.bars.length<3500||data.quality.excluded.duplicate>0)throw Error('Too little valid genuine 5m data or duplicates');
  const four=build4h(q1.bars.map(x=>({t:x.t,o:x.open,h:x.high,l:x.low,c:x.close})),now);
  if(four.candles.length<1600)throw Error('Not enough 4-hour as-of higher frame history for original Dow trend');
  const days=[...new Set(data.et.filter(x=>x.minute>=480&&x.minute<780).map(x=>x.date))].sort();
  if(days.length<20)throw Error('Not enough different US trading days for 5-minute strategy study');
  // Fixed 70% historical development observations, last 30% = chronological diagnostic validation.
  // This is not an independent new regime or fully held-out original model.
  const split=days[Math.floor(days.length*.70)],train=data.bars.filter((x,i)=>data.et[i].date<split),valid=data.bars.filter((x,i)=>data.et[i].date>=split);
  const trainData=clean5m(train,now),validData=clean5m(valid,now);
  report.status='gold_5m_two_tracks_tested_research_only';
  report.data_source={five_minute:q5.source,one_hour:q1.source,
   five_minute_history:{...data.quality,raw_source_timestamp_count:q5.bars.length,
    fixed_observation_window_start_utc:fixedStart,fixed_observation_window_end_exclusive_utc:fixedEndExclusive,
    fingerprint_closed_five_minute_fixed_window_sha256:fixedDataFingerprint,
    fixed_stable_subrange_start_utc:'2026-09-01T00:00:00Z',
    fixed_stable_subrange_end_exclusive_utc:'2026-10-15T00:00:00Z',
    fingerprint_closed_five_minute_stable_subrange_sha256:stableFingerprint,
    stable_subrange_5m_candle_count:stableRange.length,
    first_request_utc:new Date(start5m).toISOString(),
    distinct_eligible_US_NY_morning_dates:days.length,train_dates:days.filter(x=>x<split).length,
    validation_dates:days.filter(x=>x>=split).length,split_at_NY_local_date:split},
   four_hour_history:{actual_1h_rows:q1.bars.length,complete_session_four_hour_bars:four.candles.length,quality:four.quality}};
  const common={initialCash:10000,costBpsRoundTrip:10,riskFraction:.005,maxLeverage:5,
   maxHoldBars:36,maxTradesPerNYDate:3,cooldownBars:6,stopSlippageATR:.1,forcedExitEtMinute:780};
  const base=evaluateIntraday(data,common),trainResult=evaluateIntraday(trainData,common),validResult=evaluateIntraday(validData,common);
  const highCost=evaluateIntraday(data,{...common,costBpsRoundTrip:30});
  const feeSweep=Object.fromEntries([0,1,3,5].map(bps=>[bps+'bps_roundtrip',mapResults(evaluateIntraday(data,{...common,costBpsRoundTrip:bps}))]));
  const validation1bp=mapResults(evaluateIntraday(validData,{...common,costBpsRoundTrip:1}));
  report.track_2_independent_gold_five_minute_trading={
   rules:'US 08:00-13:00 NY time, prior-closed 5-minute EMA/channel/Bollinger/opening-range decisions, NEXT 5-minute open, no overnight holds',
   model_lot_size:'fractional synthetic ounces for comparability, NOT actual COMEX GC/MGC integer contract fills',
   cost_bps_roundtrip:10,
   conservative_stop_additional_slippage_ATR5m:.1,
   max_three_entries_NY_day:true,mean_reversion_take_profit_1_25_R:true,
   momentum_take_profit_2_R:true,
   max_hold_5m_bars:36,initial_equity_usd:10000,max_nominal_leverage:5,
   results_full_observed_window:mapResults(base),
   results_training_earlier_70pct_days:mapResults(trainResult),
   results_later_30pct_days:mapResults(validResult),
   cost_stress_30basis_points_roundtrip:mapResults(highCost),
   predeclared_fee_sensitivity_0_1_3_5bps_roundtrip:feeSweep,
   lower_fee_1bps_later_30pct_held_dates:validation1bp,
   benchmark_1x_buyhold_same_window:buyhold1x(data,10),
   generated_5m_closed_signal_counts:base.generated_signal_counts,
   eligible_5m_NY_session_bars:base.eligible_5m_entry_bars,
   verified_valid_30m_opening_range_dates:base.valid_NY_opening_ranges};
  report.track_1_existing_V22_four_hour_to_five_minute_execution={
   samples_10bp:studyRefinement({bars5m:data.bars,bars4h:four.candles,feeBps:10}),
   stress_30bp:studyRefinement({bars5m:data.bars,bars4h:four.candles,feeBps:30}),
   statement:'Original B or full V2.2 can be compared ONLY if qualified 4h signals actually occur within the short 5m quote history'};
  report.study_limitations=[
   'Yahoo 5m GC=F continuous futures is NOT authenticated CME per-contract historical execution or COMEX tick data, nor gold spot XAUUSD',
   'Short Yahoo retained 5m history cannot replicate 2019-2025 5m entries, no fictional synthetic 5m candles',
   'Source omits null/partial 5m OHLC records; impossible to claim zero price gaps and direct tradable liquidity',
   'Yahoo 5-minute data can revise after repeated pulls; report records SHA256 fingerprint of CLEAN quoted OHLC in fixed UTC date window for reproducibility',
   '5m simulation uses next observed 5m open, OHLC stop-first ambiguity, 10bp assumed roundtrip fees and additional stop slippage',
   '0bp is a nontradable mathematical reference. 1bp/3bp/5bp/10bp and 30bp are HYPOTHETICAL fee scenarios, not broker-specific live spreads',
   '30bp stress is hypothetical; not an observed retail broker spread, commission or actual gold futures market impact',
   'Fractional futures ounces for risk sizing, no MGC/GC integer 10/100 oz lot, brokerage margin, overnight funding, expiry or contract roll',
   'Dow strict 4h comparison only applies when such a signal occurs during actual 5m data; otherwise no historical evidence of improvement',
   'Price-only 4h control is explicitly NOT actual Dow-and-macro-qualified V2.2 trading setup',
   '60m after 4h breakout limit and 5m confirmation tests select on fill, selection bias; not aggregate strategy portfolio',
   'Training/validation split on latest 58 days is a short contemporary regime, not an untouched long historical out-of-sample',
   'Low fee sweep added after inspecting 10bp results, hence NOT blind preregistered; compare all costs as sensitivity, not a new out-of-sample win',
   'Signals predeclared in code before this data run, but research design is exploratory and no future profit guarantee',
   'Results must never be silently joined to earlier C2 2025-2026 pnl because the time windows differ'];
 }catch(e){report.status='gold_5m_dual_track_research_blocked';report.error=String(e.stack||e)}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-gold-5m-two-tracks-latest.json',JSON.stringify(report,null,2));
 console.log('Status:',report.status,report.error||'');
 if(report.status==='gold_5m_two_tracks_tested_research_only'){
  console.log('5m source:',report.data_source.five_minute_history.clean,'bars',report.data_source.five_minute_history.distinct_eligible_US_NY_morning_dates,'NY morning dates');
  for(const [name,x] of Object.entries(report.track_2_independent_gold_five_minute_trading.results_full_observed_window))console.log('intraday',name,JSON.stringify({trades:x.trades,win:x.win_rate_pct,pct:x.return_pct,dd:x.max_drawdown_pct}));
  console.log('4h B qualified anchors:',JSON.stringify(report.track_1_existing_V22_four_hour_to_five_minute_execution.samples_10bp.strict_B_entry_refinement));
  console.log('4h price-only anchors:',JSON.stringify(report.track_1_existing_V22_four_hour_to_five_minute_execution.samples_10bp.exploratory_price_confirmation_only_refinement));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
