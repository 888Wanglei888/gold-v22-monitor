// Historic fiscal forecast source collector for C1 research.
// Only public Treasury records; no raw GLD content and no future realized TGA used at entry.
const {cashflowByDay,reconcile}=require('./v22-cashflow-core');
const {audit:debtAudit}=require('./v22-debt-core');
const {normalizeAnnouncements}=require('./v22-auction-core');
const {evaluate:forecast}=require('./v22-fiscal-composite-core');
const root='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/';
const ymd=(y,m,d)=>[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
async function request(source,from,to,sort){
 const q=new URLSearchParams({filter:sort+':gte:'+from+','+sort+':lte:'+to,sort,[ 'page[size]' ]:'10000'});
 const url=root+source+'?'+q;
 for(let n=0;n<3;n++){
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(38000),headers:{Accept:'application/json'}});
   if(!r.ok)throw Error('Treasury '+source+' HTTP '+r.status);
   const data=await r.json(),rows=data.data||[],total=Number(data.meta?.total_count??NaN);
   if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error('Truncated official source '+source+' '+from);
   return rows;
  }catch(e){if(n===2)throw e;await new Promise(done=>setTimeout(done,(n+1)*2000))}
 }
}
async function pool(items,n,fn){
 const output=new Array(items.length);await Promise.all(Array.from({length:n},async(_,worker)=>{
  for(let index=worker;index<items.length;index+=n)output[index]=await fn(items[index],index);
 }));return output;
}
async function loadFiscalForecastFromTreasury(laggedTga){
 const tga=laggedTga?.rows?.filter(x=>x.date>='2024-01-01').map(x=>({date:x.date,balance:x.value}));
 if(!tga||tga.length<650)throw Error('Insufficient original Treasury daily TGA balance records');
 const yearEnd=2026,monthEnd=Math.min(10,new Date().getUTCMonth()+1),months=[];
 for(let y=2024;y<=yearEnd;y++)for(let m=1;m<=(y===yearEnd?monthEnd:12);m++)months.push({from:ymd(y,m,1),to:ymd(y,m,new Date(Date.UTC(y,m,0)).getUTCDate())});
 const [monthly,debtYears,auctionYears]=await Promise.all([
  pool(months,6,m=>request('dts/deposits_withdrawals_operating_cash',m.from,m.to,'record_date')),
  pool([2024,2025,2026],3,y=>request('dts/public_debt_transactions',ymd(y,1,1),ymd(y,12,31),'record_date')),
  pool([2023,2024,2025,2026],4,y=>request('od/auctions_query',ymd(y,1,1),ymd(y,12,31),'auction_date'))
 ]);
 if(monthly.some(x=>x.length<200))throw Error('Missing Treasury deposits/withdrawals statement month');
 const cash=cashflowByDay(monthly.flat()),debt=debtAudit(debtYears.flat()),auction=normalizeAnnouncements(auctionYears.flat());
 if(cash.faults.duplicate_line_key||debt.coverage.complete_days<680||auction.events.length<1000||auction.faults.duplicate_auction_identity||auction.faults.bad_date_order)throw Error('Historical fiscal accounting/source completeness failed');
 // Original TGA observed date is lagged by three days in 12-feature source,
 // and forecast model separately imposes 3-calendar-day trailing data training cutoff.
 // Explicit late decision publication 23:59:59Z prevents using that day's unseen observations.
 const projection=forecast(tga,cash.days,auction.events,2025,debt.daily,{include_decision_forecasts:true,include_revision_factors:false});
 const decisionForecasts=projection.research_only_decision_forecasts||[];
 if(decisionForecasts.length<350)throw Error('No historical D+3 pre-event fiscal expectations to evaluate '+decisionForecasts.length);
 const cashCoverage={start:cash.days[0]?.date,end:cash.days.at(-1)?.date,report_days:cash.days.length,
  duplicate_line_key:cash.faults.duplicate_line_key,marketable_debt_days:debt.coverage.complete_days,
  auction_events:auction.events.length,forecast_decision_dates:decisionForecasts.length,
  history_2023_cashflow_quarantined:true};
 return {decisionForecasts,projection_scores:Object.fromEntries([1,3,5].map(h=>['D+'+h,projection.scored['D+'+h].overall])),
  coverage:cashCoverage,actual_releases_and_revisions_verified:false};
}
module.exports={loadFiscalForecastFromTreasury};
