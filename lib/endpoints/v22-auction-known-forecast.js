// Strictly historical known-auction settlement forecast research, validated against ex-post DTS Bills.
// Forecasts only the auction-known CASH PROXY component, NOT full net Treasury finance or TGA change.
const {normalize,buildKnownFutureLedger}=require('./v22-auction-core');
const {audit:actualLedger}=require('./v22-debt-core');
const auctionRoot='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
const debtRoot='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/public_debt_transactions';
const nextWeekday=s=>{let n=Date.parse(s+'T12:00:00Z');do{n+=86400000}while([0,6].includes(new Date(n).getUTCDay()));return new Date(n).toISOString().slice(0,10)};
async function load(url,year,field){
 const p=new URLSearchParams({filter:field+':gte:'+year+'-01-01,'+field+':lte:'+year+'-12-31',sort:field,'page[size]':'10000'});
 const r=await fetch(url+'?'+p,{signal:AbortSignal.timeout(24000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('Official Treasury '+field+' '+year+' HTTP '+r.status);
 const j=await r.json(),rows=j.data||[],total=Number(j.meta?.total_count??j.meta?.['total-count']??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error('Treasury '+field+' '+year+' truncated '+rows.length+'/'+total);
 if(rows.length<100)throw Error('Treasury '+field+' '+year+' sparse '+rows.length);
 return rows;
}
const summary=rows=>{
 const n=rows.length,s=rows.reduce((o,x)=>{
  o.p+=Math.abs(x.pred-x.actual);o.zero+=Math.abs(x.actual);o.good+=(Math.sign(x.pred)===Math.sign(x.actual)&&x.pred!==0)?1:0;o.with_known+=(x.known_event_count>0)?1:0;
  return o;
 },{p:0,zero:0,good:0,with_known:0});
 return {samples:n,known_event_samples:s.with_known,known_event_coverage_pct:n?+(100*s.with_known/n).toFixed(1):null,auction_known_proxy_mae_usd_billions:n?+(s.p/n/1000).toFixed(3):null,zero_baseline_mae_usd_billions:n?+(s.zero/n/1000).toFixed(3):null,mae_vs_zero_improvement_pct:n&&s.zero?+(100*(s.zero-s.p)/s.zero).toFixed(1):null,direction_match_all_samples_pct:n?+(100*s.good/n).toFixed(1):null};
};
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=5400');
 try{
  const auctionYears=[2023,2024,2025,2026],debtYears=[2024,2025,2026];
  const fetched=await Promise.all([...auctionYears.map(y=>load(auctionRoot,y,'auction_date')),...debtYears.map(y=>load(debtRoot,y,'record_date'))]);
  const ax=normalize(fetched.slice(0,4).flat()),truth=actualLedger(fetched.slice(4).flat());
  if(ax.events.length<700||truth.daily.length<450||ax.faults.duplicate_auction_identity>0||ax.faults.auction_after_issue>0)throw Error('Input records failed completeness/identity checks '+JSON.stringify({auction:ax.events.length,truth:truth.daily.length,faults:ax.faults}));
  const byDay=new Map(truth.daily.map(x=>[x.date,x]));
  const scored={1:[],3:[],5:[]};
  const recent=[];
  for(const observed of truth.daily){
   const asof=observed.date;
   for(const horizon of [1,3,5]){
    let target=asof,knownBill=0,knownCount=0;
    for(let step=0;step<horizon;step++){
     target=nextWeekday(target);
     const forecast=buildKnownFutureLedger(ax.events,asof,target,2);
     knownBill+=forecast.known_bill_proxy_net_usd/1e6;
     knownCount+=forecast.by_type.Bill.issue_records+forecast.by_type.Bill.maturity_records;
    }
    const last=byDay.get(target);
    if(!last||target<='2025-01-01')continue;
    // All calendar weekdays in forecast horizon must be present in future DTS history to evaluate.
    let x=asof,actualBill=0,complete=true;
    for(let step=0;step<horizon;step++){
     x=nextWeekday(x);
     const obs=byDay.get(x);
     if(!obs){complete=false;break}
     actualBill+=obs.bills_net;
    }
    if(!complete)continue;
    scored[horizon].push({asof,target,pred:knownBill,actual:actualBill,known_event_count:knownCount});
    if(horizon===1)recent.push({asof,target,known_auction_bill_proxy_usd_billions:+(knownBill/1000).toFixed(3),realized_dts_bill_net_usd_billions:+(actualBill/1000).toFixed(3),known_event_count:knownCount});
   }
  }
  const byHorizon=Object.fromEntries([1,3,5].map(h=>['D+'+h,{overall:summary(scored[h]),by_year:Object.fromEntries([2025,2026].map(y=>[y,summary(scored[h].filter(x=>x.asof.startsWith(String(y))))]))}]));
  res.status(200).json({status:'auction_known_bill_component_backtest_research_only',model:'Only issuance and maturing awards from Treasury auction results published >=2 calendar days earlier',target:'Ex-post DTS IIIA actual daily BILL issues minus redemptions',units:'USD billions',data_coverage:{raw_auction_rows:fetched.slice(0,4).flat().length,accepted_auction_events:ax.events.length,auction_faults:ax.faults,realized_dts:truth.coverage.complete_days},by_horizon:byHorizon,recent_historical_comparisons:recent.slice(-6),full_TGA_forecast_validated:false,full_V22_strategy_backtested:false,trade_signals_enabled:false,limitations:['A forecast of known auction bill cash is NOT a forecast of all Treasury new cash or TGA balance','Historic auction feed is current-vintage; published result timestamp unverified; assumes data known 2 calendar days after auction','Maturity is inferred from prior auction gross awards, which can differ from publicly-held principal and cash redemption','Coupons, TIPS and FRNs excluded from this evaluated known-bill-only proxy','Future issue amounts from auctions after as-of are always excluded; actual DTS comparison is used ONLY for after-the-fact scoring','Non-trading-day and holiday DST calendar mismatches excluded from scored evaluation','Model is diagnostic; no parameters optimized on 2026 outcomes and no claim of tradable profit']});
 }catch(e){res.status(200).json({status:'auction_known_bill_forecast_blocked',error:String(e),no_invented_results:true,trade_signals_enabled:false})}
};
