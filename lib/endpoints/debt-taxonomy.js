// FiscalData DTS debt transaction taxonomy and date coverage audit.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/public_debt_transactions';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const source=URL+'?'+p,r=await fetch(source,{signal:AbortSignal.timeout(23000),headers:{accept:'application/json'}});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const body=await r.json(),rows=body.data||[];
  if(!rows.length)throw Error('No DTS public debt transactions');
  const fields=Object.keys(rows[0]),labels=fields.filter(k=>/type|category|description|security|line|table|classification/i.test(k));
  const amounts=fields.filter(k=>/amt|amount|balance|today/i.test(k)),groups=new Map(),dates=new Set();
  for(const x of rows){
   dates.add(x.record_date);
   const key=labels.map(k=>String(x[k]??'').trim()).join(' | ');
   const g=groups.get(key)||{category:key,count:0,first_date:x.record_date,last_date:x.record_date,example_amounts:{}};
   g.count++;
   if(x.record_date<g.first_date)g.first_date=x.record_date;
   if(x.record_date>g.last_date)g.last_date=x.record_date;
   if(!Object.keys(g.example_amounts).length)for(const k of amounts)g.example_amounts[k]=x[k]??null;
   groups.set(key,g);
  }
  res.status(200).json({status:'debt_taxonomy_audit_not_net_new_cash',source,rows:rows.length,unique_report_dates:dates.size,fields,label_fields:labels,amount_fields:amounts,categories:[...groups.values()].sort((a,b)=>b.count-a.count).slice(0,120),limitations:['Gross issuance and redemptions must be separated by instrument and timing','Subtotals may overlap components','SOMA rollovers and reopening treatment must be verified','No net financing prediction claimed']});
 }catch(e){res.status(502).json({error:String(e)})}
};