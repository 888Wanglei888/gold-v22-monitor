// Audit historical DTS cashflow identity and pre-release-lagged non-debt/tax daily seasonality.
// Aggregated research statistics only; never publish 2023-present detailed raw transaction rows.
const fs=require('node:fs');
const {cashflowByDay,tgaByDay,reconcile}=require('../lib/endpoints/v22-cashflow-core');
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
  const [monthRows,tgaYears]=await Promise.all([
   pool(months,5,m=>fetchRows('deposits_withdrawals_operating_cash',m.from,m.to)),
   pool(Array.from({length:maxYear-2022},(_,i)=>2023+i),3,y=>fetchRows('operating_cash_balance',String(y)+'-01-01',String(y)+'-12-31'))
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
  report.exploratory_fiscal_seasonality={
   tax_net_named_categories:predict(trustedCash.days,'tax_net_proxy'),
   nondebt_net_unvalidated_debt_redemption_category:predict(trustedCash.days,'nondebt_net'),
   disclosure:'Calendar/weekday priors are fixed and one-day walk-forward, lagging training by 3 calendar days; no optimization or actual historical release vintages' };
  report.limitations=['2023 year fails cashflow/TGA accounting identity and is explicitly excluded from all train/test statistics; do not silently reuse','Named taxes are a partial tax proxy, customs separate, not certified entire IRS revenue','Nondebt net cannot be treated as verified discretionary spending until Public Debt Cash Redemptions category mapping is separately confirmed','Daily date samples exclude holidays/closure gaps; this is research not published event-time forecast','Original FiscalData source is current-version and may have revisions','Treasury auction announced issue forecasts and nondebt seasonal estimates have not yet been added for a complete future TGA forecast','GLD cashflow flow signal, gold multi-factor confirmations and execution backtest remain distinct tasks'];
 }catch(e){report.status='multi_year_cashflow_audit_blocked';report.error=String(e)}
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/fiscal-cashflow-history-latest.json',JSON.stringify(report,null,2));
 console.log(report.status,'months',report.months_requested,'matched_days',report.identity?.count,'MAE USD millions',report.identity?.average_absolute_identity_gap_usd_millions,report.error||'');
}
main().catch(e=>{console.error(e);process.exitCode=1});
