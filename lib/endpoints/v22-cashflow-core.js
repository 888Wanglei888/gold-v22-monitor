// DTS TGA deposits/withdrawals leaf rows. Reconcile against Table I day-on-day TGA balances.
// Abort identity if unexpected parent aggregates, duplicate leaf lines, or missing records occur.
function numeric(v){if(v===undefined||v===null||v===''||v==='null')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function cashflowByDay(rows){
 const by=new Map(),faults={invalid_today_amount:0,bad_transaction_type:0,non_tga_ignored:0,non_table_ii_ignored:0,duplicate_line_key:0,unlabeled_possible_total_rows_excluded:0};
 for(const x of rows){
  if(x.table_nbr!=='II'){faults.non_table_ii_ignored++;continue}
  // DTS used 'Federal Reserve Account' before the TGA label transition.
  const acct=String(x.account_type||'');
  if(!acct.includes('Treasury General Account')&&!(String(x.record_date||'')<'2022-04-18'&&acct==='Federal Reserve Account')){faults.non_tga_ignored++;continue}
  const date=String(x.record_date||''),type=String(x.transaction_type||''),amount=numeric(x.transaction_today_amt);
  if(!/^20\d\d-\d\d-\d\d$/.test(date)||amount==null){faults.invalid_today_amount++;continue}
  if(!['Deposits','Withdrawals'].includes(type)){faults.bad_transaction_type++;continue}
  const category=String(x.transaction_catg||'').trim(),line=String(x.src_line_nbr||'');
  // DTS Table II includes separate unlabeled daily grand-total rows (e.g. deposit lines 80/81).
  // Including both leaf rows and totals doubles the same cash movement.
  // Before autumn 2023, Table II publishes labeled Sub-Total Deposits/Withdrawals
  // alongside the underlying leaf categories. Including them doubles cash movements.
  // 2023-01-04 and 2023-05-10 reconcile to TGA only after excluding these parents.
  if(!category||category.toLowerCase()==='null'||/^(?:sub[ -]?total|total)(?:[\s:-]+(?:deposits|withdrawals|receipts|payments))?$/i.test(category)){faults.unlabeled_possible_total_rows_excluded++;continue}
  const g=by.get(date)||{date,deposits:0,withdrawals:0,tax_deposits:0,tax_refunds:0,customs_deposits:0,public_debt_cash_issues:0,public_debt_cash_redemptions:0,count:0,seen:new Set(),duplicate:false};
  const key=type+'|'+line+'|'+category;
  if(g.seen.has(key)){g.duplicate=true;faults.duplicate_line_key++;continue}
  g.seen.add(key);g.count++;
  if(type==='Deposits'){
   g.deposits+=amount;
   if(category.startsWith('Taxes - '))g.tax_deposits+=amount;
   if(/Public Debt Cash Issues/i.test(category))g.public_debt_cash_issues+=amount;
   if(/Customs Duties|Customs and Certain Excise/i.test(category))g.customs_deposits+=amount;
  } else {
   g.withdrawals+=amount;
   if(/Public Debt Cash Redemp/i.test(category))g.public_debt_cash_redemptions+=amount;
   if(category.startsWith('Taxes - ')&&/Refund/i.test(category))g.tax_refunds+=amount;
  }
  by.set(date,g);
 }
 const days=[...by.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({date:x.date,deposits:x.deposits,withdrawals:x.withdrawals,cashflow_net:x.deposits-x.withdrawals,tax_deposits:x.tax_deposits,tax_refunds:x.tax_refunds,customs_deposits:x.customs_deposits,tax_net_proxy:x.tax_deposits-x.tax_refunds,public_debt_cash_issues:x.public_debt_cash_issues,public_debt_cash_redemptions:x.public_debt_cash_redemptions,nondebt_deposits:x.deposits-x.public_debt_cash_issues,nondebt_withdrawals:x.withdrawals-x.public_debt_cash_redemptions,nondebt_net:(x.deposits-x.public_debt_cash_issues)-(x.withdrawals-x.public_debt_cash_redemptions),rows:x.count,duplicate:x.duplicate}));
 return {days,faults};
}
function tgaByDay(rows){
 const d=new Map();
 for(const x of rows){
  if(String(x.table_nbr)!=='I')continue;
  const date=String(x.record_date||''),label=String(x.account_type||'');
  const modern=date>='2022-04-18';
  // Treasury changed the DTS Table I schema on 2022-04-18. For modern
  // records line 4 is closing TGA stored under open_today_bal. Before
  // the transition, line 1 contains closing TGA under close_today_bal.
  const matches=modern
    ? String(x.src_line_nbr)==='4'&&/Treasury General Account.*Closing Balance/i.test(label)
    : String(x.src_line_nbr)==='1'&&(label==='Federal Reserve Account'||label==='Treasury General Account (TGA)');
  if(!matches)continue;
  const val=numeric(modern?x.open_today_bal:x.close_today_bal);
  if(val==null||val<=0)continue;
  if(!d.has(date))d.set(date,[]);d.get(date).push(val);
 }
 const clean=[...d].filter(([,values])=>values.length===1).map(([date,values])=>({date,balance:values[0]})).sort((a,b)=>a.date.localeCompare(b.date));
 return {days:clean,duplicate_dates:[...d].filter(([,values])=>values.length!==1).length};
}
function reconcile(cash,tga){
 const prev=new Map(tga.days.map((x,i)=>[x.date,i?{delta:x.balance-tga.days[i-1].balance}:null]));
 const observed=cash.days.map(x=>{const p=prev.get(x.date);return p?{date:x.date,reported_tga_delta:p.delta,reported_net_deposits_minus_withdrawals:x.cashflow_net,difference:p.delta-x.cashflow_net,tax_net_proxy:x.tax_net_proxy,customs_deposits:x.customs_deposits}:null}).filter(Boolean);
 const sum=observed.reduce((s,x)=>s+Math.abs(x.difference),0),max=observed.reduce((m,x)=>Math.max(m,Math.abs(x.difference)),0);
 return {count:observed.length,average_absolute_identity_gap_usd_millions:observed.length?+(sum/observed.length).toFixed(3):null,max_absolute_identity_gap_usd_millions:+max.toFixed(3),within_one_billion_pct:observed.length?+(100*observed.filter(x=>Math.abs(x.difference)<=1000).length/observed.length).toFixed(1):null,
  recent_examples:observed.slice(-4).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(3):v])))};
}
module.exports={cashflowByDay,tgaByDay,reconcile};
