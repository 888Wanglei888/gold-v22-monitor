// Auditable TGA daily cash identity using DTS Table I named totals.
// All amounts USD millions. No net-new-Treasury-financing claim is made.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const N=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'1200'});
  const source=URL+'?'+p,r=await fetch(source,{signal:AbortSignal.timeout(18000),headers:{accept:'application/json'}});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const body=await r.json(),groups=new Map();
  for(const row of body.data||[]){
   if(String(row.table_nbr||'').trim().toUpperCase()!=='I')continue;
   const line=String(row.src_line_nbr||'').trim();
   if(!['1','2','3','4'].includes(line))continue;
   const date=row.record_date;
   if(!groups.has(date))groups.set(date,{date});
   const g=groups.get(date);
   // Current DTS schema places all four Table I daily figures in open_today_bal.
   const val=N(row.open_today_bal);
   if(val!==null)g['line_'+line]=val;
  }
  const days=[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-40).map(g=>{
   const complete=[1,2,3,4].every(n=>Number.isFinite(g['line_'+n]));
   if(!complete)return {...g,verified:false,error:'Missing Table I line(s)'};
   const change=g.line_4-g.line_1,net=g.line_2-g.line_3,difference=change-net;
   return {date:g.date,opening_tga_usd_millions:g.line_1,deposits_usd_millions:g.line_2,withdrawals_usd_millions:g.line_3,closing_tga_usd_millions:g.line_4,change_tga_usd_millions:change,net_cashflow_usd_millions:net,reconciliation_difference_usd_millions:difference,verified:Math.abs(difference)<=2};
  });
  const latest=days.at(-1),passed=days.filter(x=>x.verified).length,failed=days.filter(x=>!x.verified).length;
  res.status(200).json({status:latest?.verified?'tga_cash_identity_verified':'tga_cash_identity_not_verified',latest,summary:{days:days.length,passed,failed},history:days.slice(-15).reverse(),source,units:'USD millions',method:'DTS Table I: closing TGA - opening TGA = total deposits - total withdrawals; daily values in open_today_bal of named lines 1-4.',limitations:['Deposits include financing and other receipts: NOT tax-only','Withdrawals include debt redemption and other payments: NOT government spending-only','This validates accounting consistency, not Treasury net-new cash forecast or publication-time backtest']});
 }catch(e){res.status(502).json({error:String(e)})}
};