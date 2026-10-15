// DTS marketable issuance/redemption history. This is realized debt, NOT as-of forecast.
const {audit}=require('./v22-debt-core');
async function year(y){
 const p=new URLSearchParams({filter:'record_date:gte:'+y+'-01-01,record_date:lte:'+y+'-12-31',sort:'record_date','page[size]':'10000'});
 const url='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/public_debt_transactions?'+p;
 const response=await fetch(url,{signal:AbortSignal.timeout(19000),headers:{Accept:'application/json'}});
 if(!response.ok)throw Error('Fiscal public debt '+y+' HTTP '+response.status);
 const j=await response.json(),raw=j.data||[];
 if(Number(j.meta?.total_count)>raw.length||raw.length>=10000)throw Error(y+' DTS year truncated '+raw.length+'/'+j.meta?.total_count);
 if(raw.length<2000)throw Error(y+' incomplete DTS '+raw.length);
 return raw;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 try{
  const [a,b,c]=await Promise.all([year(2024),year(2025),year(2026)]);
  const result=audit([...a,...b,...c]),stat=result.coverage;
  if(stat.complete_days<450)throw Error('Too few complete historical public debt dates '+stat.complete_days);
  res.status(200).json({status:'realized_marketable_debt_ledger_research_only',source:'US Treasury FiscalData Daily Treasury Statement Table IIIA',source_field:'transaction_today_amt',units:'USD millions (yearly sums converted to USD billions)',classification:{bills_issue_lines:[1,2],bills_redemption_lines:[15],coupon_notes_bonds_issue_lines:[3,4],coupon_notes_bonds_redemption_lines:[16,17],excluded_lines:[5,6,7,8,9,10,11,12,13,18,19,20,21,22,23,24]},coverage:stat,recent_realized_ledger:result.daily.slice(-8).map(x=>({record_date:x.date,realized_bills_net_usd_billions:+(x.bills_net/1000).toFixed(3),realized_notes_bonds_net_usd_billions:+(x.coupons_net/1000).toFixed(3),realized_subtotal_usd_billions:+(x.net/1000).toFixed(3)})),full_v22_fiscal_forecast_ready:false,trade_signals_enabled:false,limitations:['EX-POST DTS realized transaction amounts: using these values as a future-day forecast would be direct lookahead','Does not incorporate separate cash-basis adjustments, TIPS principal inflation adjustments, SOMA auction rollovers or Treasury buybacks','Bonds and Notes represent a partial coupon bucket, not yet complete TIPS/FRN funding','Tax receipts and government outlays must be classified separately without overlapping categories','TreasuryDirect announcement date, auction date, issue date and publicly held maturing amounts need historical point-in-time reconciliation before forecasting net new cash','Daily realized debt subtotals are not the change in TGA or net dollar liquidity']});
 }catch(e){res.status(200).json({status:'realized_debt_classification_incomplete',error:String(e),full_v22_fiscal_forecast_ready:false,trade_signals_enabled:false,no_invented_data:true})}
};
