// Inspect historical Treasury DTS cashflow category taxonomy and its coverage.
// Research only: categories are not assumed to be non-overlapping.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const source=URL+'?'+p,r=await fetch(source,{signal:AbortSignal.timeout(23000),headers:{accept:'application/json'}});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const body=await r.json(),rows=body.data||[];
  if(!rows.length)throw Error('No DTS cashflow rows');
  const keys=Object.keys(rows[0]);
  const labelKeys=keys.filter(k=>/account_type|transaction_type|category|classification|description|line|table/i.test(k));
  const amountKeys=keys.filter(k=>/amt|amount|balance|today/i.test(k));
  const categories=new Map(),dates=new Set();
  for(const x of rows){
   dates.add(x.record_date);
   const label=labelKeys.map(k=>String(x[k]??'').trim()).join(' | ');
   const entry=categories.get(label)||{label,count:0,first_date:x.record_date,last_date:x.record_date,example_amounts:{}};
   entry.count++;
   if(x.record_date<entry.first_date)entry.first_date=x.record_date;
   if(x.record_date>entry.last_date)entry.last_date=x.record_date;
   if(!Object.keys(entry.example_amounts).length)for(const k of amountKeys)entry.example_amounts[k]=x[k]??null;
   categories.set(label,entry);
  }
  res.status(200).json({status:'taxonomy_audit_not_net_financing',source,rows:rows.length,unique_report_dates:dates.size,fields:keys,label_fields:labelKeys,amount_fields:amountKeys,categories:[...categories.values()].sort((a,b)=>b.count-a.count).slice(0,120),limitations:['Do not sum parent and child rows','Account labels and amount field semantics require confirmation','No historical publication timestamp archive','No tax-only or Treasury net cash amount claimed']});
 }catch(e){res.status(502).json({error:String(e)})}
};