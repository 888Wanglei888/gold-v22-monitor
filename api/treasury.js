const base='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/';
async function query(table){
  const url=base+table+'?'+new URLSearchParams({sort:'-record_date','page[size]':'200'});
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(table+' HTTP '+r.status);
  const data=await r.json();return {rows:data.data||[],url};
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  try{
    const [cash,debt]=await Promise.allSettled([query('operating_cash_balance'),query('public_debt_transactions')]);
    const errors=[];
    if(cash.status==='rejected')errors.push('TGA: '+cash.reason.message);
    if(debt.status==='rejected')errors.push('Debt: '+debt.reason.message);
    const records=cash.status==='fulfilled'?cash.value.rows:[];
    const tga=records.filter(r=>String(r.table_nbr||'').trim().toUpperCase()==='I'&&String(r.src_line_nbr||'').trim()==='4').filter(r=>/Treasury General Account|财政部一般账户/i.test(String(r.account_type||''))&&/Closing Balance|期末余额/i.test(String(r.account_type||''))).filter(r=>r.close_today_bal!=null&&Number.isFinite(Number(r.close_today_bal))).sort((a,b)=>b.record_date.localeCompare(a.record_date));
    res.status(tga.length?200:502).json({retrieved_at:new Date().toISOString(),units:'USD millions',latest:tga[0]||null,history:tga.slice(0,30),debt_raw_records:debt.status==='fulfilled'?debt.value.rows.length:null,errors:tga.length?errors:[...errors,'No matching TGA closing balance: verify DTS source schema']});
  }catch(e){res.status(502).json({error:String(e)})}
};