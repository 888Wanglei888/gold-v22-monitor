// Fiscal-data settlement reconciliation research endpoint.
// No "net liquidity" number is emitted until issuance and redemption fields are validated.
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/';
async function fetchTable(name){
 const p=new URLSearchParams({sort:'-record_date','page[size]':'500'});
 const url=ROOT+name+'?'+p;
 const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(17000)});
 if(!response.ok)throw Error(name+' HTTP '+response.status);
 const json=await response.json();return {url,rows:json.data||[],meta:json.meta||null};
}
function numeric(v){if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:null}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const debt=await fetchTable('public_debt_transactions');
  const rows=debt.rows;
  const fields=rows.length?Object.keys(rows[0]):[];
  // Deliberately expose categorized *raw* rows rather than summing mismatched
  // issue/redemption/marketable/nonmarketable categories.
  const groups={};
  for(const r of rows){
   const date=r.record_date||'unknown';
   if(!groups[date])groups[date]={record_date:date,row_count:0,rows:[]};
   groups[date].row_count++;
   if(groups[date].rows.length<25)groups[date].rows.push(r);
  }
  const dates=Object.keys(groups).sort().reverse().slice(0,8);
  res.status(200).json({
   status:'raw_debt_transactions_reconciliation_pending',
   retrieved_at:new Date().toISOString(),units:'Refer to FiscalData schema; monetary units are not normalized here',
   source:debt.url,total_rows_fetched:rows.length,fields,
   recent_dates:dates.map(d=>groups[d]),
   net_new_cash_usd_millions:null,
   checks:{issuance_classification:'not_validated',redemption_classification:'not_validated',double_counting:'not_validated',soma_rollovers:'not_validated',timing:'not_validated'},
   warning:'No net cash calculation or liquidity signal until category definitions, units, redemption timing and double counting are verified.'
  });
 }catch(e){res.status(502).json({error:String(e)})}
};