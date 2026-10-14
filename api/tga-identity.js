// Validated-by-identity DTS Table I totals; do not infer semantic roles from line numbers.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const num=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const params=new URLSearchParams({sort:'-record_date','page[size]':'1500'});
  const source=URL+'?'+params,r=await fetch(source,{signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error('FiscalData HTTP '+r.status);
  const body=await r.json(),groups=new Map();
  for(const row of body.data||[]){
   if(String(row.table_nbr||'').trim().toUpperCase()!=='I')continue;
   const name=String(row.account_type||'').trim(),value=num(row.open_today_bal);
   if(value===null)continue;
   let key=null;
   if(/Treasury General Account.*Closing Balance/i.test(name))key='closing';
   else if(/Total TGA Deposits/i.test(name))key='deposits';
   else if(/Total TGA Withdrawals/i.test(name))key='withdrawals';
   else if(/Treasury General Account.*Opening Balance/i.test(name))key='opening';
   if(!key)continue;
   if(!groups.has(row.record_date))groups.set(row.record_date,{date:row.record_date});
   groups.get(row.record_date)[key]=value;
  }
  const sorted=[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const days=sorted.slice(-40).map((x,i)=>{
   const prev=sorted[sorted.length-Math.min(sorted.length,40)+i-1];
   const opening=x.opening??(prev&&prev.closing);
   const complete=[opening,x.deposits,x.withdrawals,x.closing].every(Number.isFinite);
   if(!complete)return {...x,opening:opening??null,verified:false,reason:'Missing named total or prior-day closing balance'};
   // Withdrawal total in DTS is often signed negative.
   const signedNet=x.withdrawals<=0?x.deposits+x.withdrawals:x.deposits-x.withdrawals;
   const change=x.closing-opening,difference=change-signedNet;
   return {date:x.date,opening_tga_usd_millions:opening,deposits_usd_millions:x.deposits,withdrawals_raw_usd_millions:x.withdrawals,closing_tga_usd_millions:x.closing,change_tga_usd_millions:change,net_cashflow_usd_millions:signedNet,reconciliation_difference_usd_millions:difference,verified:Math.abs(difference)<=2};
  });
  const latest=days.at(-1);
  res.status(200).json({status:latest?.verified?'tga_cash_identity_verified':'tga_cash_identity_not_verified',latest,summary:{days:days.length,passed:days.filter(x=>x.verified).length,failed:days.filter(x=>!x.verified).length},history:days.slice(-15).reverse(),source,units:'USD millions',method:'Match exact semantic account_type labels; opening balance from named row or prior report closing; deposits + signed withdrawals = closing - opening.',limitations:['This is an accounting check, not a forecasting model','No publication-time vintages','Deposits and withdrawals include debt operations; not tax-only or spending-only']});
 }catch(e){res.status(502).json({error:String(e)})}
};