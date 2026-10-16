// Gold V2.2 research -- freeze THREE strategies and compare on IDENTICAL 1h CLOSED candles.
// B1 = original 4h + Dow trend, B2 = same Dow trend plus 1h breakout,
// B3 = 4h confirmed then within four 1h bars 0.35x past 1h ATR limit retest.
// No new V2.2 macro PnL is claimed. Financial risk/cost/exit controls identical.
const fs=require('node:fs'),crypto=require('node:crypto');
const {build4h}=require('../lib/endpoints/v22-asof-core');
const {evaluate:oldB1}=require('../lib/endpoints/v22-benchmark-core');
const {prepareHourly,runThreeWay}=require('../lib/endpoints/v22-gold-hourly-comparison-core');
const now=Date.now(),fromDate='2024-12-01T00:00:00Z',cutoffDate='2026-10-16T00:00:00Z';
const cutoff=Date.parse(cutoffDate),begin=Date.parse(fromDate),forecastStart='2025-06-02';
async function yahoo(){
 const u=new URL('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF');
 u.searchParams.set('period1',String(Math.floor(begin/1000)));
 u.searchParams.set('period2',String(Math.floor(now/1000)));
 u.searchParams.set('interval','1h');
 const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'},signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Yahoo gold 1h API HTTP '+r.status);
 const payload=(await r.json()).chart;
 if(payload.error)throw Error('Yahoo refused: '+JSON.stringify(payload.error));
 const d=payload.result?.[0];
 if(!d?.timestamp?.length)throw Error('No original Yahoo 1h gold OHLC');
 const q=d.indicators?.quote?.[0]||{};
 return {source:{symbol:d.meta?.symbol,full_exchange_name:d.meta?.fullExchangeName,
  currency:d.meta?.currency,interval:d.meta?.dataGranularity,
  timezone:d.meta?.exchangeTimezoneName},
  raw:d.timestamp.map((t,i)=>({start_ms:t*1000,open:q.open?.[i],high:q.high?.[i],
   low:q.low?.[i],close:q.close?.[i]}))};
}
function abbreviated(z){return {trades:z.trades,winners:z.winners,win_rate_pct:z.win_rate_pct,
 return_pct:z.return_pct,max_hourly_equity_drawdown_pct:z.max_mark_to_market_drawdown_pct,
 final_account_usd:z.final_usd,exposure_hour_pct:z.exposure_hour_pct,
 average_trade_pnl_usd:z.average_trade_pnl_usd,cost_bps_roundtrip:z.cost_bps_roundtrip,
 execution_audit:z.counts,by_entry_year:z.by_entry_year,trade_ledger:z.trade_ledger}}
async function main(){
 const d={checked_at_utc:new Date(now).toISOString(),github_sha:process.env.GITHUB_SHA||null,
  status:'hourly_B1_B2_B3_pending',live_signals_enabled:false,full_V22_gold_macro_study_verified:false,
  source:'Direct Yahoo GC=F hourly historical futures quote proxy, NOT official per-contract CME settlement or executable lots'};
 try{
  const src=await yahoo();
  if(src.source.symbol!=='GC=F'||src.source.interval!=='1h')throw Error('Historical 1h gold symbol/granularity mismatch');
  const base=prepareHourly(src.raw.filter(x=>x.start_ms>=begin&&x.start_ms+3600000<=cutoff),cutoff);
  if(base.audit.duplicates||base.bars.length<5000)throw Error('Hour data missing or duplicate: '+JSON.stringify(base.audit));
  const four=build4h(base.bars.map(b=>({t:b.start_ms,o:b.open,h:b.high,l:b.low,c:b.close})),cutoff);
  if(four.candles.length<1500)throw Error('Incomplete 4h build '+four.candles.length);
  // Gold 4h GROUPS cover only complete set of four contiguous 1h candles,
  // thus strip the extra out-of-session 1h candles to impose identical time coverage.
  const membership=new Set();
  for(const c of four.candles)for(let i=0;i<4;i++)membership.add(c.start_ms+i*3600000);
  const hourly=base.bars.filter(b=>membership.has(b.start_ms));
  if(hourly.length!==four.candles.length*4)throw Error('1h to 4h fill window mismatched');
  const fingerprint=crypto.createHash('sha256').update(hourly.map(b=>[
    b.start_ms,b.open.toFixed(4),b.high.toFixed(4),b.low.toFixed(4),b.close.toFixed(4)
  ].join(',')).join(';')).digest('hex');
  const stable=hourly.filter(b=>b.start_ms>=Date.parse('2026-01-01T00:00:00Z')&&b.start_ms<Date.parse('2026-09-30T00:00:00Z'));
  const stableHash=crypto.createHash('sha256').update(stable.map(b=>[
   b.start_ms,b.open.toFixed(4),b.high.toFixed(4),b.low.toFixed(4),b.close.toFixed(4)
  ].join(',')).join(';')).digest('hex');
  const fixed={initialCash:10000,riskFraction:.005,maxLeverage:5,stopDurationHours:60};
  const run=runThreeWay({hourly,four:four.candles,startDate:forecastStart,costBps:10,lookbackHours:12});
  const original=oldB1({inputCandles:four.candles,startDate:forecastStart,
   initialCash:10000,costBpsRoundTrip:10,stopATR:1.5,maxBars:15,riskFraction:.005,maxLeverage:5});
  const recordedB1=original.B_dow_higher_frames_plus_4h;
  const b1=run.result.B1_4h_rules_1h_execution;
  if(recordedB1.executed_nonoverlapping_trades!==b1.trades)throw Error('Original 4h B1 trade count not reproduced on same 1h bars: '+recordedB1.executed_nonoverlapping_trades+' vs '+b1.trades);
  if(run.result.B2_dow_plus_1h_breakout.trades<1){
   d.hourly_no_entry_data_diagnostic=run.candidates.B2;
   console.warn('No strictly eligible B2 1h signals; report 0 rather than fabricating trades',JSON.stringify(run.candidates.B2));
  }
  if(run.candidates.B3.valid_preentry_1h_ATR<1)console.warn('No B3 pre-entry contiguous 14h ATR available in strict original B1 opportunities; report zero retests');
  const cases={B1_4h_Dow_hourly_stop_simulation:abbreviated(b1),
    B2_Dow_plus_1h_confirmed_breakout:abbreviated(run.result.B2_dow_plus_1h_breakout),
    B3_B1_signal_wait_1h_ATR_limit_retest:abbreviated(run.result.B3_confirmed_4h_plus_1h_limit_retest)};
  d.status='gold_three_way_B1_4h_B2_1h_B3_1h_tested_source_research_only';
  d.window={requested_history_start_utc:fromDate,cutoff_exclusive_utc:cutoffDate,
   test_start:forecastStart,first_used_hour_utc:new Date(hourly[0].start_ms).toISOString(),
   last_used_hour_closed_utc:new Date(hourly.at(-1).close_ms).toISOString(),
   raw_yahoo_hour_bars:src.raw.length,clean_raw_1h_bars:base.bars.length,
   completely_accounted_1h_candles:hourly.length,complete_4h_candles:four.candles.length,
   market_hours_without_complete_4h_excluded:base.bars.length-hourly.length,
   hourly_source_sha256:fingerprint,stability_2026_Jan_to_Sep_fingerprint_sha256:stableHash,
   source:{...src.source,raw_quality:base.audit,four_hour_quality:four.quality}};
  d.rules=run.fixed_rules;
  d.base_B1_original_four_hour_simulation={
   trades:recordedB1.executed_nonoverlapping_trades,win_rate_pct:recordedB1.win_rate_pct,
   return_pct:recordedB1.total_return_pct,drawdown_pct:recordedB1.max_mark_to_market_drawdown_pct,
   caution:'Original code uses 4h OHLC intrabar stop and max15 4h bars; B1 hourly counterpart uses true hourly OHLC, more precise stop path, same nominal stop width and holding 60 observed hours'};
  d.measured_technicals=run.candidates;
  d.fixed_10bps_three_way=cases;
  d.cost_sensitivity_1_3_5_30bps={};
  for(const bps of [1,3,5,30]){
   const sensitivity=runThreeWay({hourly,four:four.candles,startDate:forecastStart,costBps:bps,lookbackHours:12});
   d.cost_sensitivity_1_3_5_30bps[bps+'bps_roundtrip']=Object.fromEntries(Object.entries(sensitivity.result).map(([key,x])=>
    [key,{trades:x.trades,win_rate_pct:x.win_rate_pct,return_pct:x.return_pct,
      max_hourly_equity_drawdown_pct:x.max_mark_to_market_drawdown_pct,final_account_usd:x.final_usd}]));
  }
  const lookback16=runThreeWay({hourly,four:four.candles,startDate:forecastStart,costBps:10,lookbackHours:16});
  d.B2_exploratory_16hour_breakout_sensitivity={
   result:abbreviated(lookback16.result.B2_dow_plus_1h_breakout),
   note:'16h lookback is explicit secondary sensitivity. Initial 20h lookback cannot fit 20 hourly session slots plus signal confirmation and next-open. Primary 12h was frozen BEFORE run after spotting incompatible market-clock requirements.'};
  d.original_A_benchmark_1x_buyhold={return_pct:original.A_always_long.total_return_pct,
   final_usd:original.A_always_long.final_equity_usd,drawdown_pct:original.A_always_long.max_mark_to_market_drawdown_pct};
  d.cautions=[
   '2025-2026 period was previously studied; these are IN-SAMPLE exploratory tests, not fully forward certified or independently profitable',
   'B1 original 4h and replay in 1h may differ due intrabar stop/bar rounding; compare same 1h engine to B2/B3 for fair execution',
   'B2 scans each fully closed prior20 continuous 1h bars, confirms following 1h close, then ENTERS NEXT 1h OPEN, with no future bar',
   'All B2 signals use last COMPLETED 4h ATR for same nominal stop as B1/B3, NOT 1h smaller ATR stop',
   'B3 fills only if pre-authorized limit touched within four hours; waiting/unfilled signals incur opportunity cost, not counted as winners',
   'B3 favorable limit touched and stop in same 1h candle is conservatively stopped first; actual minute sequencing and queue position unknown',
   'Stop gap-through executed at worse of original stop and next observed hour OPEN; absolute slippage beyond this not measured',
   'Risk per trade 0.5% before fees, portfolio maximum simulated notional leverage 5x and one position at a time',
   '10bps is hypothetical roundtrip fees and spread; 1/3/5/30bps are hypothetical comparison, not your broker quoted fees',
   'Yahoo GC=F is continuous futures quote proxy, not actual tradable COMEX GC/MGC integer contracts or contract expiration cash settlements',
   'Dow weekly/daily are conservative CLOSED 4h-derived proxies rather than official COMEX daily/weekly settlement bars',
   'Original C2 V2.2 fiscal and gold flow conditions are NOT applied to B2 or B3, they are independent technical B-style comparisons',
   'No live signals, brokerage positions, margin, fund capital management or future guaranteed win rate'];
 }catch(e){d.status='gold_B1_B2_B3_hourly_research_blocked';d.error=String(e.stack||e)}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-gold-hourly-b1-b2-b3-latest.json',JSON.stringify(d,null,2));
 console.log('One-hour report status',d.status,d.error||'');
 if(d.status==='gold_three_way_B1_4h_B2_1h_B3_1h_tested_source_research_only'){
  console.log('Original B1',JSON.stringify(d.base_B1_original_four_hour_simulation));
  for(const [name,x] of Object.entries(d.fixed_10bps_three_way))console.log(name,JSON.stringify({n:x.trades,win:x.win_rate_pct,ret:x.return_pct,dd:x.max_hourly_equity_drawdown_pct,counter:x.execution_audit}));
  console.log('B2 16-hour sensitivity',d.B2_exploratory_16hour_breakout_sensitivity.result.return_pct);
 }else process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
