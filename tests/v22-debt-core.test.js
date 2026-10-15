const assert=require('node:assert/strict'),{audit}=require('../lib/endpoints/v22-debt-core');
const typ={1:['Issues','Bills','Regular Series'],2:['Issues','Bills','Cash Management Series'],3:['Issues','Notes',null],4:['Issues','Bonds',null],15:['Redemptions','Bills',null],16:['Redemptions','Notes',null],17:['Redemptions','Bonds',null]};
const rows=Object.entries(typ).map(([id,[transaction_type,security_type,security_type_desc]])=>({record_date:'2026-04-15',src_line_nbr:id,transaction_type,security_type,security_type_desc,security_market:'Marketable',table_nbr:'IIIA',transaction_today_amt:{1:105000,2:10000,3:25000,4:25000,15:100000,16:20000,17:30000}[id]}));
const x=audit(rows);assert.equal(x.daily.length,1);assert.equal(x.daily[0].bills_net,15000);assert.equal(x.daily[0].coupons_net,0);assert.equal(x.coverage.per_year[2026].subtotal_net_usd_billions,15);
assert.equal(audit([...rows,rows[0]]).daily.length,0);
assert.equal(audit(rows.filter(r=>r.src_line_nbr!=='17')).daily.length,0);
console.log('DTS marketable Bills/Notes/Bonds decomposition unit tests passed');
