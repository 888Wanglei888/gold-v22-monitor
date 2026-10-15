// Audit historical DTS cashflow identity and pre-release-lagged non-debt/tax daily seasonality.
// Aggregated research statistics only; never publish 2023-present detailed raw transaction rows.
const fs=require('node:fs');
const {cashflowByDay,tgaByDay,reconcile}=require('../lib/endpoints/v22-cashflow-core');
const {normalizeAnnouncements}=require('../lib/endpoints/v22-auction-core');
const {evaluate}=require('../lib/endpoints/v22-fiscal-composite-core');
const {build4h}=require('../lib/endpoints/v22-asof-core');
const {scan:scanGoldPrice}=require('../lib/endpoints/v22-price-pattern-core');
const {align:alignFiscalGold}=require('../lib/endpoints/v22-fiscal-price-core');
const {revision:computeFiscalRevisions,alignRevisionToGoldPrice}=require('../lib/endpoints/v22-fiscal-revision-core');
const {audit:marketableDebtLedger}=require('../lib/endpoints/v22-debt-core');
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/';
const MS=86400000;
const iso=t=>new Date(t).toISOString().slice(0,10);
const dt=s=>Date.parse(s+'T12:00:00Z');
const nextWeekday=s=>{let t=dt(s);do{t+=MS}while([0,6].includes(new Date(t).getUTCDay()));return iso(t)};
const median=a=>{if(!a.length)return null;const q=[...a].sort((x,y)=>x-y);return q.length%2?q[(q.length-1)/2]:(q[q.length/2-1]+q[q.length/2])/2};
const num=x=>Number.isFinite(x)?+x.toFixed(3):null;
async function fetchRows(kind,from,to){
 const p=new URLSearchParams({filter:'record_date:gte:'+from+',record_date:lte:'+to+(kind==='operating_cash_balance'?',table_nbr:eq:I,src_line_nbr:eq:4':''),sort:'record_date','page[size]':'10000'});
 const endpoint=ROOT+kind+'?'+p;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(endpoint,{signal:AbortSignal.timeout(35000),headers:{Accept:'application/json'}});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json(),rows=j.data||[],reported=Number(j.meta?.total_count??j.meta?.['total-count']??NaN);
   if(rows.length>=10000||(Number.isFinite(reported)&&reported>rows.length))throw Error('Truncation '+rows.length+'/'+reported);
   return rows;
  }catch(e){if(attempt>=2)throw Error(kind+' '+from+' '+String(e));await new Promise(ok=>setTimeout(ok,(attempt+1)*1600))}
 }
}
async function pool(items,concurrency,handler){
 const out=Array(items.length),workers=Array.from({length:concurrency},async(_,i)=>{
  for(let j=i;j<items.length;j+=concurrency)out[j]=await handler(items[j],j);
 });await Promise.all(workers);return out;
}
function predict(rows,field){
 const dayMap=new Map(rows.map(x=>[x.date,x])),scores=[];
 for(let i=230;i<rows.length-1;i++){
  const asof=rows[i].date,target=nextWeekday(asof),actual=dayMap.get(target);
  if(!actual||target<'2025-01-01')continue;
  // As-of exclusion: DTS observed balance/cashflow records take up to 3 calendar days to be available.
  const cutoff=iso(dt(asof)-3*MS);
  const train=rows.slice(Math.max(0,i-600),i).filter(x=>x.date<=cutoff);
  const wd=new Date(dt(target)).getUTCDay(),same=train.filter(x=>new Date(dt(x.date)).getUTCDay()===wd).map(x=>x[field]);
  const global=median(train.map(x=>x[field])),weekday=median(same.length>=12?same:train.map(x=>x[field]));
  if(!Number.isFinite(weekday)||!Number.isFinite(global))continue;
  // Pre-declared calendar prior: same month and +/- two calendar days from target, no future observations.
  const month=target.slice(5,7),dom=Number(target.slice(8));
  const events=train.filter(x=>x.date.slice(5,7)===month&&Math.abs(Number(x.date.slice(8))-dom)<=2).map(x=>x[field]);
  const calendar=events.length>=5?median(events):weekday;
  scores.push({asof,target,actual:actual[field],weekday,calendar,zero:0,event_history_count:events.length});
 }
 const summarise=q=>{
  const n=q.length;
  const mae=k=>n?num(q.reduce((s,x)=>s+Math.abs(x.actual-x[k]),0)/n/1000):null;
  return {samples:n,weekday_median_mae_usd_billions:mae('weekday'),month_day_calendar_median_mae_usd_billions:mae('calendar'),zero_mae_usd_billions:mae('zero'),calendar_days_with_5_or_more_prior_examples:q.filter(x=>x.event_history_count>=5).length};
 };
 return {overall:summarise(scores),by_year:Object.fromEntries([2025,2026].map(y=>[y,summarise(scores.filter(x=>x.asof.startsWith(String(y))))]))};
}
async function historicalGoldPriceCandidates(){
 const start=Math.floor(Date.UTC(2025,0,1)/1000),end=Math.floor(Date.now()/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+start+'&period2='+end+'&interval=1h';
 const r=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error('Yahoo GC futures hourly HTTP '+r.status);
 const a=(await r.json()).chart?.result?.[0];if(!a?.timestamp?.length)throw Error('Gold hourly chart missing');
 const q=a.indicators?.quote?.[0]||{},raw=a.timestamp.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]}));
 const bars=build4h(raw,Date.now());if(bars.candles.length<1500)throw Error('Gold 4h sessions incomplete');
 return {confirmed:scanGoldPrice(bars.candles,{include_all_candidates:true}).confirmed_candidates,bars:bars.candles.length};
}
async function main(){
 const now=new Date(),maxYear=Math.min(2026,now.getUTCFullYear()),endMonth=maxYear===2026?Math.min(10,now.getUTCMonth()+1):12;
 const months=[];
 for(let y=2023;y<=maxYear;y++)for(let m=1;m<=(y===maxYear?endMonth:12);m++){
  const from=y+'-'+String(m).padStart(2,'0')+'-01',to=iso(Date.UTC(y,m,0));
  months.push({from,to});
 }
 const report={checked_at_utc:now.toISOString(),github_sha:process.env.GITHUB_SHA||null,
  source:'US Treasury DTS II operating cash transactions + Table I TGA close',months_requested:months.length,
  full_v22_fiscal_prediction_ready:false,trade_signals_enabled:false};
 try{
  const goldPromise=historicalGoldPriceCandidates().catch(e=>({error:String(e)}));
  const [monthRows,tgaYears,auctionYears,debtYears]=await Promise.all([
   pool(months,5,m=>fetchRows('deposits_withdrawals_operating_cash',m.from,m.to)),
   pool(Array.from({length:maxYear-2022},(_,i)=>2023+i),3,y=>fetchRows('operating_cash_balance',String(y)+'-01-01',String(y)+'-12-31')),
   pool([2023,2024,2025,2026],3,async y=>{
    const p=new URLSearchParams({filter:'auction_date:gte:'+y+'-01-01,auction_date:lte:'+y+'-12-31',sort:'auction_date','page[size]':'10000'});
    const r=await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?'+p,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('Auction '+y+' HTTP '+r.status);
    const j=await r.json();if(Number(j.meta?.total_count)>j.data?.length||j.data?.length>=10000)throw Error('Auction history truncated '+y);
    return j.data||[];
   }),
   pool([2024,2025,2026],3,y=>fetchRows('public_debt_transactions',String(y)+'-01-01',String(y)+'-12-31'))
  ]);
  if(monthRows.some((x,i)=>x.length<200||x.length>=10000))throw Error('Month was missing or unexpectedly small');
  const raw=monthRows.flat(),cash=cashflowByDay(raw),tga=tgaByDay(tgaYears.flat()),identity_all=reconcile(cash,tga);
  const trustedCash={days:cash.days.filter(x=>x.date>='2024-01-01')};
  const trustedTga={days:tga.days.filter(x=>x.date>='2024-01-01')};
  const identity=reconcile(trustedCash,trustedTga);
  const accounting_ok=cash.faults.duplicate_line_key===0&&tga.duplicate_dates===0&&identity.count>=690&&
   identity.average_absolute_identity_gap_usd_millions<=30&&identity.max_absolute_identity_gap_usd_millions<=200;
  const categoryLabels=new Map();
  for(const x of raw){
   const label=String(x.transaction_catg||''),type=String(x.transaction_type||'');
   if(!/public debt|treasury securities|federal financing|debt service|cash redemp/i.test(label))continue;
   const key=type+'|'+label;if(!categoryLabels.has(key))categoryLabels.set(key,{transaction_type:type,category:label,example_line:String(x.src_line_nbr||''),first_sample_year:String(x.record_date||'').slice(0,4)});
  }
  const byYear={};
  for(const y of [2023,2024,2025,2026]){
   const d=cash.days.filter(x=>x.date.startsWith(String(y)));const t=tga.days.filter(x=>x.date.startsWith(String(y)));
   if(!d.length)continue;
   const r=reconcile({days:d},tga);
   const sum=k=>num(d.reduce((s,x)=>s+x[k],0)/1000);
   byYear[y]={cashflow_days:d.length,tga_days:t.length,identity:r,
    explicit_named_tax_net_proxy_usd_billions:sum('tax_net_proxy'),public_debt_cash_issues_usd_billions:sum('public_debt_cash_issues'),
    public_debt_cash_redemptions_usd_billions:sum('public_debt_cash_redemptions'),non_debt_receipts_usd_billions:sum('nondebt_deposits'),
    non_debt_withdrawals_usd_billions:sum('nondebt_withdrawals'),non_debt_net_usd_billions:sum('nondebt_net')};
  }
  report.status=accounting_ok?'dts_cashflows_2024_plus_identity_reconciled_research':'dts_cashflows_2024_plus_identity_not_validated';
  report.trusted_cashflow_window='2024-01-01 through latest DTS report date';
  report.excluded_unreconciled_year=2023;
  report.debt_related_cashflow_labels=[...categoryLabels.values()].slice(0,70);
  report.raw_transaction_rows=raw.length;report.tga_closing_rows=tga.days.length;report.cashflow_report_days=cash.days.length;
  report.faults=cash.faults;report.tga_duplicate_dates=tga.duplicate_dates;report.identity=identity;report.identity_all_2023_present=identity_all;report.by_year=byYear;
  const auction=normalizeAnnouncements(auctionYears.flat());
  if(auction.events.length<1000||auction.faults.bad_date_order>0||auction.faults.duplicate_auction_identity>0)throw Error('Auction announcement historical source invalid');
  report.auction_announcement_events=auction.events.length;
  const completedDebt=marketableDebtLedger(debtYears.flat());
  if(completedDebt.coverage.complete_days<680||completedDebt.coverage.faults.duplicate_line_date>0)throw Error('Marketable DTS bill gross issue historic training source incomplete');
  report.market_bill_issuance_history={complete_days:completedDebt.coverage.complete_days,first:completedDebt.coverage.first_date,last:completedDebt.coverage.last_date};
  const completeFiscal=evaluate(trustedTga.days,trustedCash.days,auction.events,2025,completedDebt.daily,{include_decision_forecasts:true,include_revision_factors:true});
  const priorKnownPredictions=completeFiscal.research_only_decision_forecasts||[];
  delete completeFiscal.research_only_decision_forecasts; // Never publish per-date prediction path input ledger.
  const futureForecastPaths=completeFiscal.research_only_target_level_daily_forecast_paths||[];
  delete completeFiscal.research_only_target_level_daily_forecast_paths;
  const statisticalRevision=computeFiscalRevisions(futureForecastPaths,{rolling_prior_decisions:252,min_prior_revisions:60,return_records:true});
  const fiscalRevisionRecords=statisticalRevision.records||[];
  delete statisticalRevision.records;
  report.fiscal_D3_same_target_research_revision_Z=statisticalRevision;
  report.exploratory_partial_tga_auction_plus_fiscal_forecast=completeFiscal;
  const priceData=await goldPromise;
  if(priceData.error){
   report.historical_fiscal_vs_gold_price_candidate_alignment={status:'gold_source_unavailable',error:priceData.error,v22_trade_signals_enabled:false};
  } else{
   report.historical_fiscal_vs_gold_price_candidate_alignment={
    ...alignFiscalGold(priorKnownPredictions,priceData.confirmed),
    gold_4h_closed_bars:priceData.bars,
    fiscal_decision_dates_with_research_only_forecasts:priorKnownPredictions.length,
    limited_research_only:true};
   report.fiscal_D3_same_target_research_revision_Z.gold_4h_price_crosscheck=alignRevisionToGoldPrice(priceData.confirmed,fiscalRevisionRecords);
  }
  report.exploratory_fiscal_seasonality={
   tax_net_named_categories:predict(trustedCash.days,'tax_net_proxy'),
   nondebt_net_unvalidated_debt_redemption_category:predict(trustedCash.days,'nondebt_net'),
   disclosure:'Calendar/weekday priors are fixed and one-day walk-forward, lagging training by 3 calendar days; no optimization or actual historical release vintages' };
  report.limitations=['2023 year fails cashflow/TGA accounting identity and is explicitly excluded from all train/test statistics; do not silently reuse','Named taxes are a partial tax proxy, customs separate, not certified entire IRS revenue','Nondebt net cannot be treated as verified discretionary spending until Public Debt Cash Redemptions category mapping is separately confirmed','Daily date samples exclude holidays/closure gaps; this is research not published event-time forecast','Original FiscalData source is current-version and may have revisions','Treasury auction bill announcements and actual DTS gross Bill historical seasonal issuance are tested with no future rows, but TIPS/FRN, tax extensions, settlement cash basis and publication vintages remain unverified','Fiscal D+3 prior forecast revision proxy rolling Z is now compared to price candidates; historical official Treasury release vintages, all V2.2 A/A+/A++ gates and full trading PnL are NOT verified'];
 }catch(e){report.status='multi_year_cashflow_audit_blocked';report.error=String(e)}
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/fiscal-cashflow-history-latest.json',JSON.stringify(report,null,2));
 console.log(report.status,'months',report.months_requested,'matched_days',report.identity?.count,'MAE USD millions',report.identity?.average_absolute_identity_gap_usd_millions,report.error||'');
}
main().catch(e=>{console.error(e);process.exitCode=1});
