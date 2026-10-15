// Inspect DTS Table II detailed cashflow classification for Treasury revenue/spend forecasting.
// This is taxonomy research, NOT a decomposition of TGA or an as-of tax forecast.
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash';
async function month(y,m){
 const start=y+'-'+String(m).padStart(2,'0')+'-01',end=y+'-'+String(m).padStart(2,'0')+'-31';
 const p=new URLSearchParams({filter:'record_date:gte:'+start+',record_date:lte:'+end,sort:'record_date','page[size]':'10000'});
 const r=await fetch(ROOT+'?'+p,{signal:AbortSignal.timeout(23000)});
 if(!r.ok)throw Error('DTS cashflow '+start+' HTTP '+r.status);
 const j=await r.json(),rows=j.data||[],total=Number(j.meta?.total_count??j.meta?.['total-count']??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error('DTS cashflow '+start+' truncated '+rows.length+'/'+total);
 return rows;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=5400');
 try{
  const [a,b]=await Promise.all([month(2025,9),month(2026,9)]),rows=[...a,...b];
  if(rows.length<1000)throw Error('DTS cashflow month source unexpectedly sparse '+rows.length);
  const cats=new Map(),fields=Object.keys(rows[0]||{}),dayCount=new Set(),dup=new Map();
  for(const row of rows){
   if(row.table_nbr!=='II'||String(row.account_type||'').indexOf('Treasury General Account')<0)continue;
   const type=String(row.transaction_type||''),category=String(row.transaction_catg||''),desc=String(row.transaction_catg_desc||''),
         line=String(row.src_line_nbr||''),key=type+'|'+category+'|'+desc+'|'+line,day=String(row.record_date);
   const val=Number(row.transaction_today_amt),g=cats.get(key)||{transaction_type:type,category,description:desc,src_line_nbr:line,records:0,days:new Set(),example_today_usd_millions:null};
   g.records++;g.days.add(day);
   if(g.example_today_usd_millions==null&&Number.isFinite(val))g.example_today_usd_millions=val;
   cats.set(key,g);dayCount.add(day);
   const uniq=day+'|'+key;dup.set(uniq,(dup.get(uniq)||0)+1);
  }
  const classes=[...cats.values()].map(x=>({...x,report_days:x.days.size,days:undefined})).sort((x,y)=>Number(x.src_line_nbr)-Number(y.src_line_nbr)||x.transaction_type.localeCompare(y.transaction_type));
  const suspicious=classes.filter(x=>/total|subtotal|sub-total/i.test(x.description)||/total|subtotal/i.test(x.category));
  const tax=classes.filter(x=>/tax|internal revenue|irs|customs|withheld|federal tax|income tax/i.test(x.description+' '+x.category));
  const disburse=classes.filter(x=>/social security|medicare|medicaid|defense|interest on|government salaries|veteran|education|treasury disburs/i.test(x.description+' '+x.category));
  res.status(200).json({status:'dts_cashflow_category_inventory_research_only',source:ROOT,months:['2025-09','2026-09'],month_rows:{'2025-09':a.length,'2026-09':b.length},unique_tga_report_days:dayCount.size,distinct_category_lines:classes.length,duplicate_exact_day_category_line:[...dup.values()].filter(x=>x!==1).length,columns:fields,likely_tax_related_labels:tax,likely_expense_related_labels:disburse,possible_aggregate_lines:suspicious,category_line_inventory:classes.slice(0,160),net_tax_receipts_usd_millions:null,net_government_spending_usd_millions:null,ready_for_tax_spending_forecast:false,limitations:['Category labels are diagnostic, not an independently certified non-overlapping line-item hierarchy','Never sum category lines before checking table subtotals and cash closing-balance identity','FiscalData current version is not an archive of historical release times','Two sample months do not prove 2024-2026 structural consistency','Do not use realized DTS future-date tax amounts as forecasts']});
 }catch(e){res.status(200).json({status:'dts_cashflow_category_inventory_blocked',error:String(e),ready_for_tax_spending_forecast:false,no_invented_data:true})}
};
