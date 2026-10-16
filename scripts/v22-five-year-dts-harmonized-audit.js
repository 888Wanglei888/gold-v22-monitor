// Five-year DTS schema migration audit, research-only; no trading signals.
// Avoid rewriting production reports or publishing raw per-transaction Treasury rows.
const fs=require('node:fs');
const {cashflowByDay,tgaByDay,reconcile}=require('../lib/endpoints/v22-cashflow-core');
const {normalizeAnnouncements}=require('../lib/endpoints/v22-auction-core');
const {audit:debtAudit}=require('../lib/endpoints/v22-debt-core');
const {evaluate}=require('../lib/endpoints/v22-fiscal-composite-core');
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/';
const pad=x=>String(x).padStart(2,'0');
const YMD=(y,m,d)=>y+'-'+pad(m)+'-'+pad(d);
async function load(endpoint,field,start,end){
 const q=new URLSearchParams({filter:field+':gte:'+start+','+field+':lte:'+end,sort:field,'page[size]':'10000'});
 const u=ROOT+endpoint+'?'+q;
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(u,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(endpoint+' HTTP '+r.status);
   const data=await r.json(),n=Number(data.meta?.['total-count']??data.meta?.total_count??NaN),v=data.data||[];
   if(v.length>=10000||(Number.isFinite(n)&&v.length<n))throw Error('TRUNCATED '+endpoint+' '+start+' '+v.length+'/'+n);
   return v;
  }catch(e){if(attempt===2)throw e;await new Promise(done=>setTimeout(done,(attempt+1)*1000))}
 }
}
async function pool(items,n,cb){const out=Array(items.length);await Promise.all(Array.from({length:n},async(_,worker)=>{
 for(let i=worker;i<items.length;i+=n)out[i]=await cb(items[i],i);
}));return out}
async function main(){
 const years=[2021,2022,2023,2024,2025,2026],months=[];
 for(let y of years)for(let m=1;m<=(y===2026?10:12);m++){const end=new Date(Date.UTC(y,m,0)).getUTCDate();months.push({y,m,first:YMD(y,m,1),last:YMD(y,m,end)})}
 const [transactionMonthly,balances,debts,auctions]=await Promise.all([
  pool(months,6,x=>load('dts/deposits_withdrawals_operating_cash','record_date',x.first,x.last)),
  pool(years,6,y=>load('dts/operating_cash_balance','record_date',YMD(y,1,1),YMD(y,12,31))),
  pool(years,4,y=>load('dts/public_debt_transactions','record_date',YMD(y,1,1),YMD(y,12,31))),
  pool([2020,...years],4,y=>load('od/auctions_query','auction_date',YMD(y,1,1),YMD(y,12,31)))
 ]);
 const transactions=transactionMonthly.flat(),cb=cashflowByDay(transactions),
   tb=tgaByDay(balances.flat()),identity=reconcile(cb,tb),
   debt=debtAudit(debts.flat()),auction=normalizeAnnouncements(auctions.flat());
 const lookup=new Map(cb.days.map(x=>[x.date,x]));
 const identityYears={};
 for(let year of years){
  const arr=[];
  for(let i=1;i<tb.days.length;i++){const cur=tb.days[i],prev=tb.days[i-1];if(!cur.date.startsWith(String(year)))continue;
   const c=lookup.get(cur.date);if(!c)continue;const d=cur.balance-prev.balance-c.cashflow_net;
   arr.push({date:cur.date,gap:d});
  }
  const abs=arr.map(x=>Math.abs(x.gap));
  identityYears[year]={tga_days:tb.days.filter(x=>x.date.startsWith(String(year))).length,transaction_days:cb.days.filter(x=>x.date.startsWith(String(year))).length,
   identity_days:arr.length,mae_usd_millions:arr.length?+(abs.reduce((a,b)=>a+b,0)/arr.length).toFixed(3):null,
   max_abs_gap_usd_millions:abs.length?Math.max(...abs):null,
   within_1000_musd_pct:arr.length?+(100*abs.filter(x=>x<=1000).length/arr.length).toFixed(2):null,
   fail_over_1000_musd:arr.filter(x=>Math.abs(x.gap)>1000).slice(0,12)};
 }
 console.log('CASHFLOW_IDENTITY',JSON.stringify(identityYears));
 console.log('SOURCE',JSON.stringify({transactions:transactions.length,tga:tb.days.length,debtdays:debt.coverage.complete_days,auctionEvents:auction.events.length,faults:cb.faults}));
 // Extending training to 2021 replaces unavailable five-year prior-seasonality
 // with available legacy-schema Treasury cashflows; formula is unchanged.
 const model=evaluate(tb.days,cb.days,auction.events,2025,debt.daily,{include_decision_forecasts:true,include_revision_factors:true});
 const scores=Object.fromEntries(['D+1','D+3','D+5'].map(k=>[k,model.scored[k]?.overall??null]));
 const result={audit_utc:new Date().toISOString(),source:'fiscaldata.treasury.gov official DTS + Treasury auction data',trusted_complete:false,
   legacy_schema_and_subtotals_corrected:true,years:identityYears,total:identity,
   raw_dts_cashflow_rows:transactions.length,verified_tga_days:tb.days.length,auction_events:auction.events.length,
   debt_complete_days:debt.coverage.complete_days,cashflow_faults:cb.faults,
   fiscal_forecast_error_summary:scores,forecast_decision_count:model.research_only_decision_forecasts?.length??null,
   disclaimer:'Research model, latest revised source snapshot, NOT independently captured real-time publication vintages; NO certified V2.2 trades.'};
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-five-year-dts-harmonized-audit.json',JSON.stringify(result,null,2));
 if(process.env.EXPORT_CSV==='1'){
  fs.mkdirSync('research-data',{recursive:true});
  const cols=['record_date','tga_balance_musd','daily_change_musd','cashflow_net_musd','reconcile_gap_musd','is_strict_identity_valid'];
  const head=cols.join(',');
  const lines=tb.days.map((t,i)=>{const prev=tb.days[i-1],delta=prev?t.balance-prev.balance:null,c=lookup.get(t.date);
   const gap=delta!==null&&c?delta-c.cashflow_net:null;
   return [t.date,t.balance,delta??'',c?.cashflow_net??'',gap??'',gap!==null&&Math.abs(gap)<=1000?1:0].join(',')
  });
  fs.writeFileSync('research-data/fiscal_cashflow_daily_2021_2026_harmonized.csv',[head,...lines].join('\n')+'\n');
  console.log('EXPORTED_DAILY',lines.length);
 }
 console.log('SCORES',JSON.stringify(scores));
}
main().catch(e=>{console.error('FAILED',e);process.exitCode=1});
