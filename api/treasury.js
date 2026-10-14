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
    const tga=records.filter(r=>String(r.table_nbr||'').trim().toUpperCase()==='I'&&String(r.src_line_nbr||'').trim()==='4'&&/Treasury General Account.*Closing Balance|财政部一般账户.*期末余额/i.test(String(r.account_type||''))).map(r=>({...r,close_today_bal:r.open_today_bal??r.open_month_bal??null})).filter(r=>r.close_today_bal!=null&&Number.isFinite(Number(r.close_today_bal))).sort((a,b)=>String(b.record_date).localeCompare(String(a.record_date)));
    const diagnostics={cash_records:records.length,cash_fields:records[0]?Object.keys(records[0]):[],closing_samples:records.filter(r=>String(r.src_line_nbr||'').trim()==='4').slice(0,3),matching_count:tga.length};
    res.status(tga.length?200:502).json({retrieved_at:new Date().toISOString(),units:'USD millions',latest:tga[0]||null,history:tga.slice(0,30),diagnostics: tga.length?undefined:diagnostics,debt_raw_records:debt.status==='fulfilled'?debt.value.rows.length:null,errors:tga.length?errors:[...errors,'No matching TGA closing balance: verify DTS source schema']});
  }catch(e){res.status(502).json({error:String(e)})}
};