// DTS operating cash deposits and withdrawals: classification audit, no speculative sums.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const params=new URLSearchParams({sort:'-record_date','page[size]':'500'});
  const source=URL+'?'+params;
  const response=await fetch(source,{headers:{accept:'application/json'},signal:AbortSignal.timeout(17000)});
  if(!response.ok)throw Error('FiscalData cashflow HTTP '+response.status);
  const body=await response.json(),rows=body.data||[];
  const dateGroups=new Map();
  for(const r of rows){const d=r.record_date||'unknown';if(!dateGroups.has(d))dateGroups.set(d,[]);dateGroups.get(d).push(r)}
  const dates=[...dateGroups.keys()].sort().reverse().slice(0,5);
  res.status(200).json({
   status:'cashflow_classification_pending',retrieved_at:new Date().toISOString(),source,
   fields:rows[0]?Object.keys(rows[0]):[],total_rows_fetched:rows.length,
   samples_by_date:dates.map(d=>({date:d,rows:dateGroups.get(d).slice(0,35)})),
   tax_receipts_usd_millions:null,government_spending_usd_millions:null,
   notes:['Rows can include aggregates and subcategories; do not sum without a verified category map','Fiscal receipts are not necessarily equal to tax receipts','Data may be revised; this is not an archived point-in-time dataset']
  });
 }catch(e){res.status(502).json({error:String(e),source:URL})}
};