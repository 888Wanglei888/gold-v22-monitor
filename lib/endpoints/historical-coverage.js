// Query FiscalData historical TGA by explicit date ranges to avoid a single-page truncation.
// This endpoint reports coverage only, not a backtest or a trade signal.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const years=Array.from({length:8},(_,i)=>2019+i),out=[];
  for(const year of years){
   const p=new URLSearchParams({filter:'record_date:gte:'+year+'-01-01,record_date:lte:'+year+'-12-31',sort:'record_date','page[size]':'10000'});
   const u=URL+'?'+p,r=await fetch(u,{signal:AbortSignal.timeout(17000)});
   if(!r.ok){out.push({year,ok:false,error:'HTTP '+r.status});continue}
   const j=await r.json(),rows=j.data||[],tga=rows.filter(x=>String(x.table_nbr||'').trim().toUpperCase()==='I'&&String(x.src_line_nbr||'').trim()==='4'&&/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')));
   const dates=[...new Set(tga.map(x=>x.record_date))].sort();
   const count=Number(j.meta?.total_count??NaN);
   out.push({year,ok:true,rows_received:rows.length,tga_days:dates.length,first:dates[0]||null,last:dates.at(-1)||null,may_be_truncated:rows.length>=10000||(Number.isFinite(count)&&count>rows.length),source:u});
  }
  res.status(200).json({status:'year_by_year_tga_source_coverage',years:out,all_years_have_data:out.every(x=>x.ok&&x.tga_days>0&&!x.may_be_truncated),limitations:['2019-2026 coverage check; 2026 is a partial year','Source historical records may have been revised after their original publication','No gold strategy results are calculated here']});
 }catch(e){res.status(502).json({error:String(e)})}
};