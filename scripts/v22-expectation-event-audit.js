// Standalone CI event study of EXPECTED Treasury bill issuance/settlement BEFORE event day.
// Official auction announcements only; no ex-post realised TGA is ever queried or used.
const fs=require('node:fs');
const {normalizeAnnouncements}=require('../lib/endpoints/v22-auction-core');
const {build4h}=require('../lib/endpoints/v22-asof-core');
const {scan}=require('../lib/endpoints/v22-price-pattern-core');
const {study,moveBusiness}=require('../lib/endpoints/v22-expectation-event-core');
async function loadAuction(y){
 const p=new URLSearchParams({filter:'auction_date:gte:'+y+'-01-01,auction_date:lte:'+y+'-12-31',sort:'auction_date','page[size]':'10000'});
 const r=await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?'+p,
  {signal:AbortSignal.timeout(35000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('Treasury auction '+y+' HTTP '+r.status);
 const a=await r.json(),rows=a.data||[],n=Number(a.meta?.total_count??NaN);
 if(rows.length<100||rows.length>=10000||(Number.isFinite(n)&&n>rows.length))throw Error('Treasury auction '+y+' incomplete '+rows.length+'/'+n);
 return rows;
}
async function loadGold(){
 const p1=Math.floor(Date.UTC(2024,11,1)/1000),p2=Math.floor(Date.now()/1000);
 const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+p1+'&period2='+p2+'&interval=1h',
  {signal:AbortSignal.timeout(40000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error('Yahoo GC=F gold 1h HTTP '+r.status);
 const a=(await r.json()).chart?.result?.[0];if(!a?.timestamp?.length)throw Error('No gold proxy hourly OHLC');
 const q=a.indicators?.quote?.[0]||{},raw=a.timestamp.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]}));
 const parsed=build4h(raw,Date.now());
 if(parsed.candles.length<1600)throw Error('Insufficient fully closed 4h futures bars '+parsed.candles.length);
 return {bars:parsed.candles,quality:parsed.quality,raw_hours:raw.length};
}
async function main(){
 const report={checked_at_utc:new Date().toISOString(),github_commit:process.env.GITHUB_SHA||null,
  study:'Gold V2.2: forward-pricing around already-known US Treasury Bill settlements and pre-scheduled US tax dates',
  status:'research_source_validation_pending',original_full_v22_strategy_tested:false,trade_signals_enabled:false};
 try{
  const [auctionYears,gold]=await Promise.all([Promise.all([2023,2024,2025,2026].map(loadAuction)),loadGold()]);
  const auction=normalizeAnnouncements(auctionYears.flat());
  if(auction.events.length<1000||auction.faults.bad_date_order||auction.faults.duplicate_auction_identity)throw Error('Unreliable auction announcement normalization '+JSON.stringify(auction.faults));
  const price=scan(gold.bars,{include_all_candidates:true});
  const availableEnd=moveBusiness(gold.bars.at(-1).session_date,-5);
  if(availableEnd<'2025-12-01')throw Error('Cannot score 2025+ event study');
  const analyses={};
  for(const threshold of [30,50,100]){
   const res=study({auctionEvents:auction.events,goldCandles:gold.bars,priceCandidates:price.confirmed_candidates,
    startDate:'2025-02-03',endDate:availableEnd,thresholdUsdBillions:threshold});
   analyses[threshold+'bn_bill_known_net']=res;
  }
  const primary=analyses['30bn_bill_known_net'];
  if(primary.by_horizon['T-3'].overall.pre_event_price_coverage<20)throw Error('Too few pre-announced event windows for T-3');
  report.status='pre_event_treasury_expectation_pricing_research_completed';
  report.preregistered_bill_net_magnitude_thresholds_usd_billions=[30,50,100];
  report.primary_threshold_usd_billions=30;
  report.auction_source={raw_rows:auctionYears.flat().length,normalized_events:auction.events.length,faults:auction.faults};
  report.gold={raw_hourly_records:gold.raw_hours,complete_four_hour_bars:gold.bars.length,quality:gold.quality,
   price_only_candidate_count:price.candidate_count};
  report.by_threshold=Object.fromEntries(Object.entries(analyses).map(([key,z])=>[key,{
    research_window:z.research_window,distinct_event_calendar_dates:z.total_distinct_event_calendar_dates,
    by_horizon:z.by_horizon,excluded:z.excluded,recent_examples:z.recent_examples,
    limitations:z.limitations}]));
  report.limits=[
   'Research price effects are NOT V2.2 actual trade returns or full TGA predictions',
   'Selection uses calendar-known gross Bill offering minus known old maturity, not ex post TGA changes',
   'Tax-date cohort is date-only with unknown shock direction, kept separate',
   'Gold event boundary is UTC midnight; actual settlement intraday timing unverified',
   'Conservative 1-calendar-day lag for announcements, 2 for accepted auction results; archival release versions not verified',
   'Gold GC=F continuous series does not model COMEX contract rolls, slippage, margin or brokerage costs',
   'Multiple event horizons overlap, so sample counts cannot be treated as independent trades',
   'Year 2025 and 2026 were previously examined during research; this is NOT an untouched out-of-sample test'];
 }catch(e){report.status='pre_event_expectation_study_blocked';report.error=String(e)}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-expectation-event-latest.json',JSON.stringify(report,null,2));
 const x=report.by_threshold?.['30bn_bill_known_net']?.by_horizon;
 console.log('status:',report.status,report.error||'');
 if(x)for(const [h,d] of Object.entries(x))console.log(h,d.overall);
}
main().catch(e=>{console.error(e);process.exitCode=1});
