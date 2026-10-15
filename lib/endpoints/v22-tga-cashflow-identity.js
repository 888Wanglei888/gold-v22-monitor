// Validate DTS II receipts/withdrawals against I closing TGA balance before using tax/spend history.
// Only two representative September months are checked here: no extrapolated 2024-2026 model.
const {cashflowByDay,tgaByDay,reconcile}=require('./v22-cashflow-core');
const root='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/';
async function month(kind,y){
 const filter=kind==='operating_cash_balance'?
  'record_date:gte:'+y+'-08-20,record_date:lte:'+y+'-09-30,table_nbr:eq:I,src_line_nbr:eq:4':
  'record_date:gte:'+y+'-09-01,record_date:lte:'+y+'-09-30';
 const q=new URLSearchParams({filter,sort:'record_date','page[size]':'10000'});
 const r=await fetch(root+kind+'?'+q,{signal:AbortSignal.timeout(23000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error(kind+' '+y+' HTTP '+r.status);
 const j=await r.json(),rows=j.data||[],total=Number(j.meta?.total_count??j.meta?.['total-count']??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error(kind+' '+y+' source truncated');
 return rows;
}
const asBillions=x=>+(x/1000).toFixed(3);
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=5400');
 try{
  const data=await Promise.all([month('deposits_withdrawals_operating_cash',2025),month('operating_cash_balance',2025),month('deposits_withdrawals_operating_cash',2026),month('operating_cash_balance',2026)]);
  const yearResult={};
  for(const [year,idx] of [[2025,0],[2026,2]]){
   const cash=cashflowByDay(data[idx]),tga=tgaByDay(data[idx+1]),identity=reconcile(cash,tga);
   const noDuplicates=!cash.faults.duplicate_line_key&&!tga.duplicate_dates;
   const identityAdequate=identity.count>=15&&identity.average_absolute_identity_gap_usd_millions<=100&&identity.max_absolute_identity_gap_usd_millions<=1000;
   const taxNet=cash.days.reduce((s,x)=>s+x.tax_net_proxy,0),customs=cash.days.reduce((s,x)=>s+x.customs_deposits,0);
   yearResult[year]={raw_cashflow_rows:data[idx].length,raw_tga_rows:data[idx+1].length,classified_cashflow_report_days:cash.days.length,closing_tga_report_days:tga.days.length,cashflow_faults:cash.faults,duplicate_tga_dates:tga.duplicate_dates,identity,identity_reconciled:!!noDuplicates&&identityAdequate,illustrative_month_tax_withheld_and_other_explicit_tax_deposits_less_named_refunds_usd_billions:asBillions(taxNet),customs_duties_tax_fee_deposits_usd_billions:asBillions(customs),
    disclaimer:'Named tax categories are a partial proxy, not a certified full IRS receipt/spending forecast'};
  }
  const passed=Object.values(yearResult).every(x=>x.identity_reconciled);
  res.status(200).json({status:passed?'tga_operating_cashflows_identity_verified_in_two_months':'tga_cashflows_identity_mismatch_or_incomplete',source:root,years:yearResult,ready_for_historical_tax_spend_forecast:false,trade_signals_enabled:false,limitations:['Two September samples cannot certify all months, structural changes or complete tax classification','Named Taxes - deposit/refund categories exclude other government cashflow and customs are shown separately to avoid ambiguous overlaps','TGA balance delta identity is an EX-POST bookkeeping check, not a market-available preannouncement','A complete 2024-2026 historically lagged tax/spend model is still required','Do not turn these realized cashflows directly into trade or future TGA forecast signals']});
 }catch(e){res.status(200).json({status:'tga_cashflow_identity_audit_blocked',error:String(e),ready_for_historical_tax_spend_forecast:false,no_invented_data:true})}
};
