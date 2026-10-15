// Strictly historical known-auction settlement forecast research, validated against ex-post DTS Bills.
// Forecasts only the auction-known CASH PROXY component, NOT full net Treasury finance or TGA change.
const {normalize,buildKnownFutureLedger,normalizeAnnouncements,buildAnnouncedFutureLedger}=require('./v22-auction-core');
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
  const rawAuctions=fetched.slice(0,4).flat(),ax=normalize(rawAuctions),announcement=normalizeAnnouncements(rawAuctions),truth=actualLedger(fetched.slice(4).flat());
  if(ax.events.length<700||announcement.events.length<700||truth.daily.length<450||ax.faults.duplicate_auction_identity>0||ax.faults.auction_after_issue>0||announcement.faults.duplicate_auction_identity>0||announcement.faults.bad_date_order>0)throw Error('Input records failed completeness/identity checks '+JSON.stringify({auction:ax.events.length,truth:truth.daily.length,faults:ax.faults}));
  const byDay=new Map(truth.daily.map(x=>[x.date,x]));
  const scored={1:[],3:[],5:[]};
  const recent=[];
  for(const observed of truth.daily){
   const asof=observed.date;
   for(const horizon of [1,3,5]){
    let target=asof,knownBill=0,knownCount=0,announcedBill=0,announcedCount=0;
    for(let step=0;step<horizon;step++){
     target=nextWeekday(target);
     const forecast=buildKnownFutureLedger(ax.events,asof,target,2);
     knownBill+=forecast.known_bill_proxy_net_usd/1e6;
     knownCount+=forecast.by_type.Bill.issue_records+forecast.by_type.Bill.maturity_records;
     const published=buildAnnouncedFutureLedger(announcement.events,asof,target,1,2);
     announcedBill+=published.bill_offering_minus_known_maturities_usd/1e6;
     announcedCount+=published.by_type.Bill.offering_count+published.by_type.Bill.maturing_auctions;
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
    scored[horizon].push({asof,target,pred:knownBill,announced_pred:announcedBill,actual:actualBill,known_event_count:knownCount,announced_event_count:announcedCount});
    if(horizon===1)recent.push({asof,target,known_auction_bill_proxy_usd_billions:+(knownBill/1000).toFixed(3),realized_dts_bill_net_usd_billions:+(actualBill/1000).toFixed(3),known_event_count:knownCount,announced_issuance_bill_proxy_usd_billions:+(announcedBill/1000).toFixed(3),announced_event_count:announcedCount});
   }
  }
  const switchToAnnouncement=rows=>rows.map(x=>({...x,pred:x.announced_pred,known_event_count:x.announced_event_count}));
  const byHorizon=Object.fromEntries([1,3,5].map(h=>['D+'+h,{
   earlier_results_only_proxy:summary(scored[h]),
   announced_offerings_proxy:summary(switchToAnnouncement(scored[h])),
   by_year:Object.fromEntries([2025,2026].map(y=>{const subset=scored[h].filter(x=>x.asof.startsWith(String(y)));return [y,{earlier_results_only_proxy:summary(subset),announced_offerings_proxy:summary(switchToAnnouncement(subset))}]}))
  }]));
  res.status(200).json({status:'auction_known_bill_component_backtest_research_only',model:'Compare earlier auction results only against offerings published on Treasury announcement_date >=1 calendar day earlier (both exclude future auction results)',target:'Ex-post DTS IIIA actual daily BILL issues minus redemptions',units:'USD billions',data_coverage:{raw_auction_rows:fetched.slice(0,4).flat().length,accepted_auction_events:ax.events.length,announced_offering_events:announcement.events.length,auction_faults:ax.faults,announcement_faults:announcement.faults,realized_dts:truth.coverage.complete_days},by_horizon:byHorizon,recent_historical_comparisons:recent.slice(-6),full_TGA_forecast_validated:false,full_V22_strategy_backtested:false,trade_signals_enabled:false,limitations:['A forecast of known auction bill cash is NOT a forecast of all Treasury new cash or TGA balance','Historic auction feed is current-vintage; published result timestamp unverified; assumes data known 2 calendar days after auction and public offerings known 1 calendar day after announcement','Maturity is inferred from prior auction gross awards, which can differ from publicly-held principal and cash redemption','Coupons, TIPS and FRNs excluded from this evaluated known-bill-only proxy','Announced future offerings may be included BEFORE auction date but only once their announcement is as-of known; never use future accepted totals as issuance','Actual DTS comparison is used ONLY for after-the-fact scoring','Non-trading-day and holiday DST calendar mismatches excluded from scored evaluation','Model is diagnostic; no parameters optimized on 2026 outcomes and no claim of tradable profit']});
 }catch(e){res.status(200).json({status:'auction_known_bill_forecast_blocked',error:String(e),no_invented_results:true,trade_signals_enabled:false})}
};
