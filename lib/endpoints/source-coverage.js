// Date coverage and schema health for historical FiscalData tables.
// Fail closed: never claim 2019 coverage if the endpoint only returned a recent page.
const tables={
 tga:'operating_cash_balance',
 debt:'public_debt_transactions',
 flows:'deposits_withdrawals_operating_cash'
};
const root='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 const result={};
 await Promise.all(Object.entries(tables).map(async([name,path])=>{
  try{
   const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
   const u=root+path+'?'+p,r=await fetch(u,{signal:AbortSignal.timeout(24000)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json(),rows=j.data||[],dates=rows.map(x=>x.record_date).filter(Boolean).sort();
   const total=Number(j.meta?.total_count??j.meta?.totalCount??NaN);
   result[name]={ok:rows.length>0,rows_received:rows.length,earliest_received:dates[0]||null,latest_received:dates.at(-1)||null,source_total_count:Number.isFinite(total)?total:null,may_be_truncated:rows.length>=10000||(Number.isFinite(total)&&total>rows.length),fields:rows[0]?Object.keys(rows[0]):[],source:u};
  }catch(e){result[name]={ok:false,error:String(e)}}
 }));
 const ready=Object.values(result).every(x=>x.ok&&!x.may_be_truncated);
 res.status(200).json({status:ready?'source_pages_complete_not_reconciled':'source_coverage_incomplete_or_unverified',tables:result,ready_for_full_history_backtest:false,notes:['Completeness of one recent page is not evidence of full historical coverage','Use explicit date filters or pagination for 2019 onward','Debt and fiscal cashflow classification must be reconciled before predictive use']});
};