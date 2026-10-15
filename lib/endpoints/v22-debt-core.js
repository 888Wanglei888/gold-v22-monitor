// DTS Table IIIA marketable Bills/Notes/Bonds realized issuance/redemption research.
// Excludes TIPS inflation increment and nonmarketable debt; NOT cash-basis adjusted.
const allowed={1:['Issues','Bills','Regular Series'],2:['Issues','Bills','Cash Management Series'],3:['Issues','Notes',null],4:['Issues','Bonds',null],15:['Redemptions','Bills',null],16:['Redemptions','Notes',null],17:['Redemptions','Bonds',null]};
const ids=Object.keys(allowed);
const parse=x=>{if(x==null||x==='')return null;const n=Number(String(x).replaceAll(',',''));return Number.isFinite(n)?n:null};
function audit(rows){
 const dates=new Map(),faults={other_ignored:0,bad_market:0,bad_category:0,missing_amount:0,duplicate_line_date:0,missing_expected_lines:0};
 for(const r of rows){
  const line=String(r.src_line_nbr||'').trim(),date=String(r.record_date||''),t=allowed[line];
  if(!t){faults.other_ignored++;continue}
  if(r.table_nbr!=='IIIA'||r.security_market!=='Marketable'){faults.bad_market++;continue}
  if(!/^20\d\d-\d\d-\d\d$/.test(date)||r.transaction_type!==t[0]||r.security_type!==t[1]||(t[2]&&r.security_type_desc!==t[2])){faults.bad_category++;continue}
  const v=parse(r.transaction_today_amt);if(v==null){faults.missing_amount++;continue}
  const g=dates.get(date)||new Map();if(!g.has(line))g.set(line,[]);g.get(line).push(v);dates.set(date,g);
 }
 const daily=[];
 for(const [date,map] of dates){
  if(ids.some(id=>!map.has(id))){faults.missing_expected_lines++;continue}
  if(ids.some(id=>map.get(id).length!==1)){faults.duplicate_line_date++;continue}
  const x=id=>map.get(String(id))[0],bills_issue=x(1)+x(2),bills_redemption=x(15),coupons_issue=x(3)+x(4),coupons_redemption=x(16)+x(17);
  daily.push({date,bills_issue,bills_redemption,bills_net:bills_issue-bills_redemption,coupons_issue,coupons_redemption,coupons_net:coupons_issue-coupons_redemption,net:bills_issue-bills_redemption+coupons_issue-coupons_redemption});
 }
 daily.sort((a,b)=>a.date.localeCompare(b.date));
 const summarize=x=>({report_days:x.length,total_market_bills_net_usd_billions:+(x.reduce((s,v)=>s+v.bills_net,0)/1000).toFixed(3),total_market_notes_bonds_net_usd_billions:+(x.reduce((s,v)=>s+v.coupons_net,0)/1000).toFixed(3),subtotal_net_usd_billions:+(x.reduce((s,v)=>s+v.net,0)/1000).toFixed(3),days_net_positive:x.filter(t=>t.net>0).length,days_net_negative:x.filter(t=>t.net<0).length});
 return {daily,coverage:{rows_in_source:rows.length,report_dates_seen:dates.size,complete_days:daily.length,first_date:daily[0]?.date||null,last_date:daily.at(-1)?.date||null,per_year:Object.fromEntries([2024,2025,2026].map(y=>[y,summarize(daily.filter(x=>x.date.startsWith(String(y))))])),faults}};
}
module.exports={audit};
