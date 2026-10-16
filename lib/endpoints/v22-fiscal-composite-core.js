// Frozen 2024+ walk-forward experiment: announced Treasury Bills + seasonal cashflow residual.
// It is a nontradable partial TGA prediction test, never a full V2.2 gold trading signal.
const {buildAnnouncedFutureLedger}=require('./v22-auction-core');
const {taxAdjustment}=require('./v22-tax-calendar');
const DAY=86400000,dateMs=s=>Date.parse(s+'T12:00:00Z'),iso=n=>new Date(n).toISOString().slice(0,10);
const nextWeekday=s=>{let n=dateMs(s);do{n+=DAY}while([0,6].includes(new Date(n).getUTCDay()));return iso(n)};
const wd=s=>new Date(dateMs(s)).getUTCDay();
const med=arr=>{if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
const meanAbs=(r,key)=>r.length?+(r.reduce((s,x)=>s+Math.abs(x.actual-x[key]),0)/r.length/1000).toFixed(3):null;
const score=a=>{
 const mae=(key)=>meanAbs(a,key);
 const error=a.map(x=>Math.abs(x.actual-x.auction_residual)/1000).sort((x,y)=>x-y);
 const pct=p=>error.length?+(error[Math.min(error.length-1,Math.floor((error.length-1)*p))]).toFixed(3):null;
 return {samples:a.length,mae_zero_usd_billions:mae('zero'),mae_total_weekday_usd_billions:mae('weekday'),
  mae_auction_plus_residual_usd_billions:mae('auction_residual'),mae_auction_plus_split_cash_usd_billions:mae('auction_split_cash'),mae_auction_plus_tax_calendar_usd_billions:mae('tax_calendar'),
  bills_issue_fallback_samples:a.filter(x=>Number.isFinite(x.issuance_baseline)).length,
  mae_known_maturities_plus_bills_issuance_baseline_usd_billions:meanAbs(a.filter(x=>Number.isFinite(x.issuance_baseline)),'issuance_baseline'),
  mae_known_maturities_plus_bills_issuance_baseline_tax_usd_billions:meanAbs(a.filter(x=>Number.isFinite(x.issuance_baseline_tax)),'issuance_baseline_tax'),
  signals_with_unannounced_future_bills_days:a.filter(x=>x.unannounced_issue_days>0).length,
  mae_without_known_maturity_usd_billions:mae('without_maturity'),mae_without_known_issue_usd_billions:mae('without_issue'),
  median_absolute_actual_change_usd_billions:a.length?+(med(a.map(x=>Math.abs(x.actual)))/1000).toFixed(3):null,
  tax_event_affected_samples:a.filter(x=>x.cumulative_tax_correction!==0).length,prior_year_tax_event_history_included:a.filter(x=>x.tax_event_prior_years>=2).length,
  predicted_auction_absolute_issue_total_usd_billions:+(a.reduce((s,x)=>s+Math.abs(x.cumulative_known_issue),0)/1000).toFixed(1),
  predicted_auction_absolute_maturity_total_usd_billions:+(a.reduce((s,x)=>s+Math.abs(x.cumulative_known_maturity),0)/1000).toFixed(1),
  auction_plus_residual_error_p50_usd_billions:pct(.5),auction_plus_residual_error_p90_usd_billions:pct(.9),
  auction_plus_residual_error_p99_usd_billions:pct(.99),
  samples_with_error_over_100_billion_usd:error.filter(x=>x>100).length};
};
function evaluate(tgaDays,cashDays,auctionEvents,fromYear=2025,marketableDebtDays=[],options={}){
 const balance=new Map(tgaDays.map(x=>[x.date,x.balance])),cash=new Map(cashDays.map(x=>[x.date,x])),debt=new Map(marketableDebtDays.map(x=>[x.date,x]));
 const actualHistory=[];
 for(let i=1;i<tgaDays.length;i++){
  const prev=tgaDays[i-1],curr=tgaDays[i];
  if(nextWeekday(prev.date)!==curr.date)continue;
  const cashData=cash.get(curr.date);if(!cashData)continue;
  const known=buildAnnouncedFutureLedger(auctionEvents,prev.date,curr.date,1,2).bill_offering_minus_known_maturities_usd/1e6;
  const actual=curr.balance-prev.balance,nondebt=cashData.nondebt_net,realized=debt.get(curr.date);
  const realizedBillNet=Number.isFinite(realized?.bills_net)?realized.bills_net:null;
  const realizedBillIssue=Number.isFinite(realized?.bills_issue)?realized.bills_issue:null;
  actualHistory.push({target:curr.date,prev_date:prev.date,actual,known_bill:known,nondebt,
   realized_bill_net:realizedBillNet,realized_bill_gross_issue:realizedBillIssue,
   rest_without_realized_bill_net:realizedBillNet===null?null:actual-realizedBillNet,
   other_finance_residual:actual-known-nondebt,total_residual:actual-known,tax_net_proxy:cashData.tax_net_proxy,wd:wd(curr.date)});
 }
 const scored={1:[],3:[],5:[]},exAnteDecisions=[],dailyExAnteForecastPaths=[];
 for(const asofData of tgaDays){
  const asof=asofData.date;
  if(Number(asof.slice(0,4))<fromYear)continue;
  const cutoff=iso(dateMs(asof)-3*DAY);
  const past=actualHistory.filter(x=>x.target<=cutoff).slice(-500);
  if(past.length<120)continue;
  let target=asof,dailyProjection=[],cumulative={actual:0,weekday:0,auction_residual:0,auction_split_cash:0,tax_calendar:0,without_maturity:0,without_issue:0,known_issue:0,known_maturity:0,tax_correction:0,tax_event_prior_years:0,zero:0,
   gross_issuance_fallback:0,gross_issuance_fallback_tax:0,has_complete_finance_inputs:true,unannounced_issue_days:0,announced_issue_days:0},canEvaluate=true;
  for(let h=1;h<=6;h++){
   target=nextWeekday(target);
   const before=h===1?asof:nextWeekdayBack(target);
   // Actual future closing balances are used ONLY to decide retrospective scoring, NEVER whether to produce a forecast.
   if(!balance.has(target)||!balance.has(before))canEvaluate=false;
   const w=wd(target);
   const same=past.filter(x=>x.wd===w),training=same.length>=12?same:past;
   const totalMid=med(training.map(x=>x.actual)),residualMid=med(training.map(x=>x.total_residual));
   const nondebtMid=med(training.map(x=>x.nondebt)),otherFinMid=med(training.map(x=>x.other_finance_residual));
   if(![totalMid,residualMid,nondebtMid,otherFinMid].every(Number.isFinite))break;
   const funding=buildAnnouncedFutureLedger(auctionEvents,asof,target,1,2),known=funding.bill_offering_minus_known_maturities_usd/1e6;
   const issuance=funding.by_type.Bill.published_upcoming_offering_usd/1e6,maturity=funding.by_type.Bill.previously_issued_maturing_awards_usd/1e6;
   cumulative.known_issue+=issuance;cumulative.known_maturity+=maturity;
   cumulative.weekday+=totalMid;cumulative.auction_residual+=known+residualMid;
   cumulative.without_maturity+=issuance+residualMid;
   cumulative.without_issue+=-maturity+residualMid;
   cumulative.auction_split_cash+=known+nondebtMid+otherFinMid;
   const scheduledTax=taxAdjustment(target,past,1);cumulative.tax_correction+=scheduledTax.calendar_tax_adjustment;cumulative.tax_event_prior_years+=scheduledTax.history_years;
   cumulative.tax_calendar+=known+residualMid+scheduledTax.calendar_tax_adjustment;
   // Disjoint accounting train target: historical actual TGA change MINUS realized net BILL transactions.
   // Thus a missing future bill announcement can be replaced by a past-known, same-weekday
   // GROSS bill issuance baseline WITHOUT counting bill proceeds a second time in the residual.
   const billTraining=training.filter(x=>Number.isFinite(x.rest_without_realized_bill_net)&&Number.isFinite(x.realized_bill_gross_issue));
   let dailyForecastIssueFallbackTax=null;
   if(billTraining.length>=12){
    const historicalIssue=med(billTraining.map(x=>x.realized_bill_gross_issue));
    const withoutBills=med(billTraining.map(x=>x.rest_without_realized_bill_net));
    const hasPublishedIssue=funding.by_type.Bill.offering_count>0;
    const forecastIssue=hasPublishedIssue?issuance:historicalIssue;
    if(hasPublishedIssue)cumulative.announced_issue_days++;else cumulative.unannounced_issue_days++;
    dailyForecastIssueFallbackTax=forecastIssue-maturity+withoutBills+scheduledTax.calendar_tax_adjustment;
    cumulative.gross_issuance_fallback+=forecastIssue-maturity+withoutBills;
    cumulative.gross_issuance_fallback_tax+=forecastIssue-maturity+withoutBills+scheduledTax.calendar_tax_adjustment;
   }else cumulative.has_complete_finance_inputs=false;
   if(h===3)exAnteDecisions.push({
    decision_date:asof,
    // Conservative event-time assumption: prior announcements + lagged balance, not today's unreleased TGA.
    no_earlier_than_utc:asof+'T23:59:59.000Z',
    forecast_target_date:target,
    forecast_D3_total_weekday_usd_millions:cumulative.weekday,
    forecast_D3_auction_plus_tax_usd_millions:cumulative.tax_calendar,
    forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions:cumulative.has_complete_finance_inputs?cumulative.gross_issuance_fallback_tax:null,
    major_tax_prior_year_examples:cumulative.tax_event_prior_years,
    complete_auction_issuance_announcement_for_all_future_days:cumulative.unannounced_issue_days===0,
    future_days_without_published_auction_issuance:cumulative.unannounced_issue_days,
    report_vintage_verified:false,gold_trade_eligibility:false
   });
   dailyProjection.push({target_date:target,horizon_business_days:h,
    forecast_day_change_auction_tax_usd_millions:known+residualMid+scheduledTax.calendar_tax_adjustment,
    forecast_day_change_issuance_fallback_tax_usd_millions:dailyForecastIssueFallbackTax,
    announcement_offering_count:funding.by_type.Bill.offering_count,source_vintage_verified:false});
   if([1,3,5].includes(h)&&canEvaluate)scored[h].push({asof,target,
    actual:balance.get(target)-asofData.balance,zero:0,weekday:cumulative.weekday,auction_residual:cumulative.auction_residual,
    auction_split_cash:cumulative.auction_split_cash,tax_calendar:cumulative.tax_calendar,cumulative_tax_correction:cumulative.tax_correction,tax_event_prior_years:cumulative.tax_event_prior_years,
    issuance_baseline:cumulative.has_complete_finance_inputs?cumulative.gross_issuance_fallback:null,
    issuance_baseline_tax:cumulative.has_complete_finance_inputs?cumulative.gross_issuance_fallback_tax:null,
    unannounced_issue_days:cumulative.unannounced_issue_days,announced_issue_days:cumulative.announced_issue_days,
    without_maturity:cumulative.without_maturity,without_issue:cumulative.without_issue,cumulative_known_issue:cumulative.known_issue,cumulative_known_maturity:cumulative.known_maturity});
  }
  if(options.include_revision_factors===true&&dailyProjection.length>=5)dailyExAnteForecastPaths.push({
   decision_date:asof,no_earlier_than_utc:asof+'T23:59:59.000Z',
   cashflow_target_predictions:dailyProjection,
   forecast_source_vintage_verified:false
  });
 }
 const priorAvailableForecasts=options.include_decision_forecasts===true?exAnteDecisions:undefined;
 return {history_samples:actualHistory.length,
   ...(priorAvailableForecasts?{research_only_decision_forecasts:priorAvailableForecasts}:{}),
   ...(options.include_revision_factors===true?{research_only_target_level_daily_forecast_paths:dailyExAnteForecastPaths}:{}),
   scored:Object.fromEntries([1,3,5].map(h=>['D+'+h,{overall:score(scored[h]),
  by_year:Object.fromEntries([2025,2026].map(y=>[y,score(scored[h].filter(x=>x.asof.startsWith(String(y))))])),
  worst_five_auction_plus_residual_errors:scored[h].map(x=>({...x,absolute_error:Math.abs(x.actual-x.auction_residual)})).sort((a,b)=>b.absolute_error-a.absolute_error).slice(0,5).map(x=>({
   asof:x.asof,target:x.target,actual_tga_change_usd_billions:+(x.actual/1000).toFixed(3),
   predicted_tga_change_usd_billions:+(x.auction_residual/1000).toFixed(3),
   forecast_error_usd_billions:+((x.auction_residual-x.actual)/1000).toFixed(3),
   published_issue_component_usd_billions:+(x.cumulative_known_issue/1000).toFixed(3),
   historical_maturity_component_usd_billions:+(x.cumulative_known_maturity/1000).toFixed(3),
   residual_seasonality_component_usd_billions:+((x.auction_residual-x.cumulative_known_issue+x.cumulative_known_maturity)/1000).toFixed(3),tax_calendar_adjustment_usd_billions:+(x.cumulative_tax_correction/1000).toFixed(3),
   fallback_issuance_model_prediction_usd_billions:x.issuance_baseline==null?null:+(x.issuance_baseline/1000).toFixed(3),
   future_days_without_published_bill_offerings:x.unannounced_issue_days
  }))}]))};
}
function nextWeekdayBack(s){let n=dateMs(s);do{n-=DAY}while([0,6].includes(new Date(n).getUTCDay()));return iso(n)}
module.exports={evaluate,nextWeekday};
