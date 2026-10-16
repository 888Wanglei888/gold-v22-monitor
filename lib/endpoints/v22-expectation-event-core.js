// V2.2 expectation-first event study, not trade signals.
// Event cohorts are selected ONLY by Treasury auction announcements / previous issued maturities
// known BEFORE the pre-event gold observation. Never screen by realized future TGA or gold returns.
const {buildAnnouncedFutureLedger}=require('./v22-auction-core');
const {dueEvent}=require('./v22-tax-calendar');
const DAY=86400000;
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const dateMs=s=>Date.parse(s+'T00:00:00Z');
function moveBusiness(date,n){
 let t=dateMs(date),step=n<0?-1:1,k=Math.abs(n);
 while(k>0){t+=step*DAY;if(![0,6].includes(new Date(t).getUTCDay()))k--}
 return iso(t);
}
function binaryIndex(candles,t,field,strict=false){
 let lo=0,hi=candles.length;
 while(lo<hi){const m=(lo+hi)>>1;
  if(strict?candles[m][field]<=t:candles[m][field]<t)lo=m+1;else hi=m}
 return lo;
}
function prices(bars,decision,settleDate){
 const start=dateMs(decision),eventStart=dateMs(settleDate);
 const i=binaryIndex(bars,start,'start_ms'),j=binaryIndex(bars,eventStart,'close_ms');
 // Entry AFTER knowledge checkpoint; exit is last fully CLOSED four-hour candle
 // strictly before 00:00 UTC on US calendar settlement date.
 if(i>=bars.length||j<=i||bars[i].start_ms>=eventStart)return null;
 const at=bars[i],pre=bars[j-1];
 if(at.start_ms-start>36*3600000||pre.close_ms<eventStart-36*3600000)return null;
 const firstEvent=binaryIndex(bars,eventStart,'start_ms'),postStart=bars[firstEvent];
 if(!postStart||postStart.start_ms-eventStart>36*3600000)return null;
 const next=moveBusiness(settleDate,1),third=moveBusiness(settleDate,3);
 const end1=binaryIndex(bars,dateMs(next),'close_ms'),end3=binaryIndex(bars,dateMs(third),'close_ms');
 const p1=end1>firstEvent?bars[end1-1]:null,p3=end3>firstEvent?bars[end3-1]:null;
 const ret=(from,to)=>from>0&&to>0?100*(to/from-1):null;
 return {asof_entry_utc:new Date(at.start_ms).toISOString(),last_pre_event_candle_utc:new Date(pre.close_ms).toISOString(),
  pre_event_gold_return_pct:ret(at.open,pre.close),
  event_start_observed_utc:new Date(postStart.start_ms).toISOString(),
  event_to_next_business_day_gold_return_pct:p1?ret(postStart.open,p1.close):null,
  event_to_third_business_day_gold_return_pct:p3?ret(postStart.open,p3.close):null,
  price_points_before_event:j-i};
}
const round=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
function summarize(rows){
 const usable=rows.filter(x=>Number.isFinite(x.pre_event_gold_return_pct));
 const post1=rows.filter(x=>Number.isFinite(x.event_to_next_business_day_gold_return_pct));
 const post3=rows.filter(x=>Number.isFinite(x.event_to_third_business_day_gold_return_pct));
 const goldMean=(arr,key)=>arr.length?round(arr.reduce((s,x)=>s+x[key],0)/arr.length):null;
 const signed=usable.filter(x=>x.direction!==null),postSigned=post3.filter(x=>x.direction!==null);
 const directionReturn=(arr,key)=>arr.length?round(arr.reduce((s,x)=>s+x.direction*x[key],0)/arr.length):null;
 const hit=arr=>arr.length?round(100*arr.filter(x=>x.direction*x.pre_event_gold_return_pct>0).length/arr.length,1):null;
 return {screened_known_events:rows.length,pre_event_price_coverage:usable.length,
  avg_pre_event_gold_return_pct:goldMean(usable,'pre_event_gold_return_pct'),
  avg_post_event_next_business_day_gold_return_pct:goldMean(post1,'event_to_next_business_day_gold_return_pct'),
  avg_post_event_three_business_days_gold_return_pct:goldMean(post3,'event_to_third_business_day_gold_return_pct'),
  cashflow_direction_evaluable:signed.length,pre_event_directional_gold_hit_rate_pct:hit(signed),
  avg_direction_adjusted_pre_event_gold_return_pct:directionReturn(signed,'pre_event_gold_return_pct'),
  avg_direction_adjusted_post_event_three_day_return_pct:directionReturn(postSigned,'event_to_third_business_day_gold_return_pct'),
  known_bill_offering_and_maturity_events:rows.filter(x=>x.knowledge_type==='offering_and_maturity_known').length,
  known_bill_offering_only_events:rows.filter(x=>x.knowledge_type==='offering_known_maturity_not_in_archive').length,
  known_bill_maturities_with_no_published_future_offering:rows.filter(x=>x.knowledge_type==='maturity_only_future_issuance_unknown').length,
  known_tax_calendar_without_verified_net_direction:rows.filter(x=>x.knowledge_type==='tax_date_only_no_cash_amount').length,
  gold_price_confirmation_before_event:usable.filter(x=>x.confirmed_gold_4h_pattern_in_same_cashflow_direction).length};
}
function study({auctionEvents,goldCandles,priceCandidates=[],startDate='2025-01-01',endDate='2026-10-15',thresholdUsdBillions=30}){
 if(!Number.isFinite(thresholdUsdBillions)||thresholdUsdBillions<=0)throw Error('Invalid pre-registered known bill net magnitude threshold');
 const bars=goldCandles.slice().sort((a,b)=>a.start_ms-b.start_ms);
 if(bars.some((b,i)=>!Number.isFinite(b.start_ms)||!Number.isFinite(b.close_ms)||b.close_ms<=b.start_ms||(i>0&&b.start_ms<bars[i-1].close_ms)))throw Error('Invalid or overlapping 4-hour gold candles');
 const candidates=priceCandidates.slice().sort((a,b)=>a.confirmation_closed_utc.localeCompare(b.confirmation_closed_utc));
 const rows={1:[],3:[],5:[]},filtered={asof_not_available_before_gold_market:0,event_forecast_below_threshold:0,insufficient_price_coverage:0};
 let t=dateMs(startDate),last=dateMs(endDate);
 for(;t<=last;t+=DAY){
  if([0,6].includes(new Date(t).getUTCDay()))continue;
  const target=iso(t);
  // Predetermined midmonth tax-date calendar is kept separate: a known date does
  // NOT imply a known SIGN or amount of tax-driven TGA shock.
  const tax=Boolean(dueEvent(target));
  for(const h of [1,3,5]){
   const decision=moveBusiness(target,-h),asof=dateMs(decision);
   if(asof>=dateMs(target))throw Error('Hindsight event decision date');
   const plan=buildAnnouncedFutureLedger(auctionEvents,decision,target,1,2);
   const bill=plan.by_type.Bill,net=plan.bill_offering_minus_known_maturities_usd;
   const selectedBill=Math.abs(net)>=thresholdUsdBillions*1e9 && (bill.offering_count+bill.maturing_auctions)>0;
   if(!selectedBill&&!tax){filtered.event_forecast_below_threshold++;continue}
   const px=prices(bars,decision,target);
   if(!px){filtered.insufficient_price_coverage++;continue}
   if(px.asof_entry_utc<decision+'T00:00:00.000Z'){filtered.asof_not_available_before_gold_market++;continue}
   // A known maturity without any published matching offering is NOT a credible NET release forecast:
   // Treasury frequently announces replacement bills only later. Never label these as directional gold trades.
   const maturityOnly=selectedBill&&bill.offering_count===0&&bill.maturing_auctions>0;
   const knowledgeType=selectedBill
    ?(maturityOnly?'maturity_only_future_issuance_unknown':
      bill.maturing_auctions>0?'offering_and_maturity_known':'offering_known_maturity_not_in_archive')
    :'tax_date_only_no_cash_amount';
   const direction=selectedBill&&!maturityOnly?(net>0?-1:1):null; // Noncausal proxy, NOT verified net TGA. 

   const agree=candidates.filter(x=>{
    const time=Date.parse(x.confirmation_closed_utc);
    return time>=dateMs(decision)&&time<dateMs(target)&&direction!==null&&x.direction===(direction===1?'long':'short');
   });
   rows[h].push({event_date:target,decision_date:decision,lead_business_days:h,
    kind:selectedBill?(tax?'known_bill_net_plus_tax_calendar':'known_bill_net'):'tax_calendar_only',
    knowledge_type:knowledgeType,issued_bill_offering_publicly_known_as_of_checkpoint:bill.offering_count>0,
    explicitly_unknown_future_bill_issuance:maturityOnly,
    known_bill_offering_usd_billions:round(bill.published_upcoming_offering_usd/1e9),
    known_bill_maturing_awards_usd_billions:round(bill.previously_issued_maturing_awards_usd/1e9),
    forecast_bill_net_usd_billions:round(net/1e9),
    direction,confirmation_count_before_event:agree.length,
    confirmed_gold_4h_pattern_in_same_cashflow_direction:agree.length>0,
    ...px});
  }
 }
 const byHorizon=Object.fromEntries([1,3,5].map(k=>['T-'+k,{
  overall:summarize(rows[k]),
  bill_only:summarize(rows[k].filter(x=>x.kind!=='tax_calendar_only')),
  bill_only_with_announced_future_offering:summarize(rows[k].filter(x=>x.kind!=='tax_calendar_only'&&x.issued_bill_offering_publicly_known_as_of_checkpoint)),
  maturity_only_without_announced_new_issuance:summarize(rows[k].filter(x=>x.knowledge_type==='maturity_only_future_issuance_unknown')),
  scheduled_tax_date:summarize(rows[k].filter(x=>x.kind.includes('tax'))),
  by_year:Object.fromEntries([2025,2026].map(y=>[y,summarize(rows[k].filter(x=>x.event_date.startsWith(String(y))))]))
 }]));
 const deduplicated=new Set(Object.values(rows).flat().map(x=>x.event_date));
 const example=Object.fromEntries([1,3,5].map(k=>['T-'+k,rows[k].slice(-4).map(x=>({event_date:x.event_date,decision_date:x.decision_date,kind:x.kind,
  exante_known_bill_net_usd_billions:x.forecast_bill_net_usd_billions,knowledge_type:x.knowledge_type,price_confirmation_count:x.confirmation_count_before_event,
  pre_gold_pct:round(x.pre_event_gold_return_pct),post_3business_days_pct:round(x.event_to_third_business_day_gold_return_pct)}))]));
 return {status:'exante_auction_announcement_prepricing_event_study_research_only',
  research_window:{startDate,endDate,known_bill_net_threshold_usd_billions:thresholdUsdBillions,
   leads:[5,3,1],selection:'only US Treasury Bill announced offerings and known old auction maturity amounts as of decision date, or preset calendar tax date',
   decision_time:'00:00 UTC on T-k business weekday; only information dated no later than T-k-1 calendar day',
   event_boundary:'00:00 UTC on settlement calendar date; not verified actual intraday cash-settlement time'},
  total_distinct_event_calendar_dates:deduplicated.size,
  overlapping_cohorts_not_independent:true,by_horizon:byHorizon,excluded:filtered,recent_examples:example,
  user_gold_v22_trade_signals:0,full_v22_backtest_ready:false,trade_signals_enabled:false,
  limitations:['Known gross Treasury Bill offering less auction-original maturing awarded principal is NOT actual TGA net change',
   'KNOWN MATURITIES WITHOUT A PUBLICLY ANNOUNCED REPLACEMENT BILL are source-incomplete: no signed gold-direction proxy is calculated for them','Events selected by ex-ante known announcement; never by later actual realized TGA magnitude','Midmonth tax-date calendar is approximate and carries NO implied direction or magnitude','Yahoo continuous GC=F proxy prices are NOT exchange-certified COMEX fills; returns are unlevered raw market changes with no transaction costs','Cashflow-driven directional adjusted returns represent a noncausal hypothesis, NOT tradeable alpha','Event cohorts and gold trends overlap; no independent-trade win rate can be inferred','Treasury source history current-vintage; actual historical publication timestamps and auction revisions remain unverified','The 00UTC event-time split may not coincide with intraday Treasury cash settlement','No macro dollar-real-yield-Fed COMEX CFTC full gold V2.2 A/A+/A++ confirmations or risk adjusted trade PnL have been inferred']};
}
module.exports={study,prices,moveBusiness,summarize};
