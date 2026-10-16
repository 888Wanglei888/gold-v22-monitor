// V2.2 4h gold candidate anchored 5-minute refinements, NOT invented old 5m candles.
// All refined entries occur AFTER the already closed 4h price confirmation AND at/after its authorized next 4h opening.
// SAME 4h ATR stop, time-exit 15 genuine 4h candles, fees; pending 5m retests require observed touch.
// This event-level counterfactual does not aggregate overlapping trades into a real portfolio.
const {scan}=require('./v22-price-pattern-core');
const {closedHigherFrames,classify}=require('./v22-dow-proxy-core');
const {features,etParts}=require('./v22-gold-5m-intraday-core');
const TF=300000,round=(v,n=4)=>Number.isFinite(v)?+v.toFixed(n):null;
function firstAtOrAfter(bars,ms){
 let a=0,b=bars.length;while(a<b){const m=(a+b)>>1;if(bars[m].start_ms<ms)a=m+1;else b=m}return a;
}
function evaluateOne(bars,entryIdx,direction,stopDistance,expiry,feeBps=10){
 const sign=direction==='long'?1:-1,entry=bars[entryIdx]?.open;
 if(!(entry>stopDistance)||!Number.isFinite(stopDistance)||stopDistance<=0)return null;
 const stop=entry-sign*stopDistance;
 const qty=Math.min(10000*.005/stopDistance,10000*5/entry),feeRate=feeBps/20000;
 let exitIdx=null,exitPx=null,exitWhy='';
 for(let j=entryIdx;j<bars.length;j++){
  const b=bars[j];if(b.start_ms>=expiry)break;
  const stopped=sign===1?b.low<=stop:b.high>=stop;
  if(stopped){exitPx=sign===1?Math.min(stop,b.open):Math.max(stop,b.open);exitIdx=j;exitWhy='stop_or_gap';break}
  exitIdx=j;exitPx=b.close;exitWhy='time_limit_4h_15bars';
  if(b.close_ms>=expiry)break;
 }
 if(exitIdx===null||bars[exitIdx].close_ms+12*3600000<expiry&&exitWhy!=='stop_or_gap')return null;
 const entryFee=qty*entry*feeRate,exitFee=qty*exitPx*feeRate,net=sign*qty*(exitPx-entry)-entryFee-exitFee;
 return {fill_utc:new Date(bars[entryIdx].start_ms).toISOString(),
  exit_utc:new Date(bars[exitIdx].close_ms).toISOString(),fill_px:round(entry),exit_px:round(exitPx),
  exit_reason:exitWhy,net_usd_per_independent_10000_account:round(net,2),
  max_entry_leverage:round(qty*entry/10000,2),paid_fees_usd:round(entryFee+exitFee,2),
  fractional_oz:round(qty,3)};
}
function isWithin(next,now,limit){return next>=now&&next<=now+limit}
function studyRefinement({bars5m,bars4h,feeBps=10,pullbackATR=.35,waitBars=12,maxExtraLateMinutes=10}){
 const five=bars5m.slice().sort((a,b)=>a.start_ms-b.start_ms);
 const four=bars4h.slice().sort((a,b)=>a.start_ms-b.start_ms);
 if(!five.length||!four.length)return {status:'missing_source'};
 const events=scan(four,{lookback:20,atr_period:14,breakout_atr:.25,include_all_candidates:true}).confirmed_candidates;
 const higher=closedHigherFrames(four),by4=new Map(four.map((x,i)=>[x.start_ms,i])),signals={strict_dow_and_4h:[],price_only_confirmed_4h:[]};
 const f=features(five,five.map((b,i)=>i>0&&b.start_ms-five[i-1].start_ms===300000?1:0));
 let skipped={outside_actual_5m_history:0,minute_data_missing_at_4h_entry:0,incomplete_15x4h_forward_window:0,
   no_prior_5m_ATR:0,strict_dow_structure_unconfirmed:0};
 // Fix higher-timeframe swing eligibility BEFORE looking at any future 5m entry or PnL.
 for(const p of events){
  const future4=Date.parse(p.earliest_hypothetical_entry_open_utc),pos4=by4.get(future4);
  if(pos4===undefined||!four[pos4+14]){skipped.incomplete_15x4h_forward_window++;continue}
  if(future4<five[0].start_ms||future4>five.at(-1).start_ms){skipped.outside_actual_5m_history++;continue}
  const i=firstAtOrAfter(five,future4);
  if(i>=five.length||!isWithin(five[i].start_ms,future4,maxExtraLateMinutes*60000)||i<24){
   skipped.minute_data_missing_at_4h_entry++;continue;
  }
  const expiry=four[pos4+14].close_ms;
  if(expiry>five.at(-1).close_ms){skipped.incomplete_15x4h_forward_window++;continue}
  // Need pre-entry ATR from *completed* five-minute bar only. Never use trade opening bar high/low.
  const prev=i-1,prior=f.atr14[prev];
  if(!Number.isFinite(prior)||prior<=0||five[i].start_ms-five[prev].close_ms>10*60000){
   skipped.no_prior_5m_ATR++;continue;
  }
  const decided=classify(higher,Date.parse(p.confirmation_closed_utc));
  const strict=decided.agreed_direction===p.direction;
  if(!strict)skipped.strict_dow_structure_unconfirmed++;
  const last=firstAtOrAfter(five,future4+waitBars*TF);
  if(last-i<1)continue;
  const sign=p.direction==='long'?1:-1;
  const atr4=p.atr_14_4h;
  const stopWidth=1.5*atr4;
  // Research immediate 5m market after authorized 4h entry: independent 5m fill at observed opening.
  const immediate=evaluateOne(five,i,p.direction,stopWidth,expiry,feeBps);
  if(!immediate)continue;
  // Place a 0.35-ATR5m LIMIT order anchored to next-open price, expiry after 60m.
  const limit=five[i].open-sign*pullbackATR*prior;
  let touchAt=null;
  for(let j=i;j<Math.min(i+waitBars,five.length);j++){
   if(five[j].start_ms>=expiry||five[j].start_ms-five[j-1].start_ms>15*60000)break;
   if(five[j].low<=limit&&five[j].high>=limit){touchAt=j;break}
  }
  // A limit can fill intrabar; use PRE-FIXED limit as entry price, not candle opening.
  // Compute counterfactual by overwriting local opening ONLY for entry bar; for stop touching same bar,
  // stop first is conservatively allowed. Does not touch real source data.
  let pullback=null;
  if(touchAt!==null){
   const simulatedFive=five.slice();
   simulatedFive[touchAt]={...five[touchAt],open:limit};
   pullback=evaluateOne(simulatedFive,touchAt,p.direction,stopWidth,expiry,feeBps);
  }
  // Wait up to 60 minutes for a CLOSED micro-breakout; enter only at next 5m open.
  let confirmAt=null;
  for(let j=i+6;j<Math.min(i+waitBars-1,five.length-1);j++){
   if(five[j].start_ms>=expiry||five[j+1].start_ms!==five[j].close_ms)break;
   const previous=five.slice(j-6,j);
   if(previous.some((x,k)=>k>0&&x.start_ms-previous[k-1].start_ms!==TF))continue;
   const boundary=p.direction==='long'?Math.max(...previous.map(x=>x.high)):Math.min(...previous.map(x=>x.low));
   if(p.direction==='long'?five[j].close>boundary+.1*prior:five[j].close<boundary-.1*prior){
    confirmAt=j+1;break
   }
  }
  const confirmed=confirmAt!==null?evaluateOne(five,confirmAt,p.direction,stopWidth,expiry,feeBps):null;
  const record={direction:p.direction,confirmation_4h_utc:p.confirmation_closed_utc,
   authorized_4h_next_open_utc:p.earliest_hypothetical_entry_open_utc,
   4h_ATR_before_trade:round(atr4),preentry_5m_ATR:round(prior),
   entry_window_length_min:waitBars*5,strict_prior_dow_weekly_daily_same_direction:strict,
   immediate_5m_market:immediate,pullback_limit_5m:pullback,micro_breakout_5m:confirmed,
   limit_reference_px:round(limit),limit_filled:pullback!==null};
  signals.price_only_confirmed_4h.push(record);
  if(strict)signals.strict_dow_and_4h.push(record);
 }
 function compare(rows){
  const baseline=rows.filter(x=>x.immediate_5m_market);
  const mean=(arr,method)=>arr.length?round(arr.reduce((s,x)=>s+x[method].net_usd_per_independent_10000_account,0)/arr.length,2):null;
  const stats={four_hour_anchor_events_with_actual_5m_cover:rows.length,
   immediate_5m_market_fill_count:baseline.length,
   immediate_5m_net_per_independent_event_mean_usd:mean(baseline,'immediate_5m_market'),
   refines:{}};
  for(const [key,label] of [['pullback_limit_5m','wait_5m_limit_retest'],['micro_breakout_5m','wait_5m_closed_micro_confirmation']]){
   const match=rows.filter(x=>x[key]);
   const both=match.filter(x=>x.immediate_5m_market);
   stats.refines[label]={5m_fill_count:match.length,fill_rate_pct:rows.length?round(100*match.length/rows.length,1):null,
    mean_filled_event_net_usd:mean(match,key),mean_same_filled_subset_immediate_net_usd:mean(both,'immediate_5m_market'),
    mean_net_difference_usd_on_matched_filled_event_subset:both.length?
      round(both.reduce((s,x)=>s+x[key].net_usd_per_independent_10000_account-x.immediate_5m_market.net_usd_per_independent_10000_account,0)/both.length,2):null,
    missed_4h_anchors_no_5m_fill:rows.length-match.length};
  }
  return stats;
 }
 return {status:'gold_4h_breakout_with_actual_5m_counterfactual_research',
  source_overlap:{actual_5m_start:new Date(five[0].start_ms).toISOString(),actual_5m_end:new Date(five.at(-1).close_ms).toISOString(),
    available_4h_price_confirmations_total:events.length,skipped,
    original_4h_Dow_confirmed_trades_present:signals.strict_dow_and_4h.length>0},
  entry_rules:{strict_must_already_match_confirmed_weekly_daily_Dow:true,
   exploratory_price_only_4h_confirmations_are_not_V22_signals:true,
   earliest_entry_after_existing_confirmed_4h_next_open:true,
   same_4h_stop_ATR_multiplier:1.5,same_4h_hold_bars:15,pullback_entry_5m_ATR_fraction:pullbackATR,
   wait_max_five_minute_bars:waitBars,fee_bps_roundtrip:feeBps,
   never_pick_event_by_future_return:true},
  strict_B_entry_refinement:compare(signals.strict_dow_and_4h),
  exploratory_price_confirmation_only_refinement:compare(signals.price_only_confirmed_4h),
  last_strict_events:signals.strict_dow_and_4h.slice(-7),
  last_price_only_events:signals.price_only_confirmed_4h.slice(-8),
  limitations:['If STRICT weekly+daily Dow-confirmed 4h signals are absent from short Yahoo 5m source window, NO legitimate 4h V2.2 improvement is measured',
   'Original full 4h macro grades not applied; this tests quote-level price execution only, not complete C2',
   'Price-only 4h signals are an exploratory separate cohort and MUST NOT be called original B or V2.2 trades',
   'No broker fills/iceberg liquidity, exchange-by-exchange contract roll verification or lot constraints',
   'Each event independently hypothetically risks 0.5% of 10000 USD; overlapping event returns are NOT a traded portfolio',
   'Limit orders get fills if quote candle range touches; queue priority/liquidity unverified',
   '5m high/low inside fill/stop bar order unknown; stop-first conservative, but limit within-bar touch/stop order cannot be proved',
   '5m quote OHLC plus 4h hourly Yahoo continuous GC=F do not verify actual execution and spread',
   'Comparisons of filled-only 5m subsets have selection bias and are not unconditional trading alpha']};
}
module.exports={studyRefinement,firstAtOrAfter,evaluateOne};
