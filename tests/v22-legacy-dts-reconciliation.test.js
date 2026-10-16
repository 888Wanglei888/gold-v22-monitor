// Regression test for US Treasury DTS legacy/modern account labels and 2023 labeled subtotals.
const assert=require('node:assert/strict');
const {cashflowByDay,tgaByDay}=require('../lib/endpoints/v22-cashflow-core');
const row=(date,account,type,category,amount,line)=>({record_date:date,table_nbr:'II',account_type:account,transaction_type:type,transaction_catg:category,transaction_today_amt:String(amount),src_line_nbr:String(line)});
const old='Federal Reserve Account',tga='Treasury General Account (TGA)';
const rows=[
 row('2021-04-15',old,'Deposits','Taxes - Individual',30,10),
 row('2021-04-15',old,'Withdrawals','Medicare',10,20),
 row('2023-05-10',tga,'Deposits','Taxes - Withheld Individual/FICA',40,10),
 row('2023-05-10',tga,'Withdrawals','Medicare',20,20),
 row('2023-05-10',tga,'Deposits','Sub-Total Deposits',40,50),
 row('2023-05-10',tga,'Withdrawals','Sub-Total Withdrawals',20,51),
 row('2023-05-10',tga,'Deposits','null',40,52),
 row('2023-05-10',tga,'Withdrawals','null',20,53)
];
const c=cashflowByDay(rows);
assert.equal(c.days.length,2);
assert.equal(c.days[0].cashflow_net,20);
assert.equal(c.days[1].cashflow_net,20);
assert.equal(c.days[1].deposits,40);
assert.equal(c.days[1].withdrawals,20);
assert.equal(c.days[1].rows,2);
assert.equal(c.faults.unlabeled_possible_total_rows_excluded,4);
const balance=[
 {record_date:'2021-04-14',table_nbr:'I',src_line_nbr:'1',account_type:old,close_today_bal:'1000',open_today_bal:'900'},
 {record_date:'2021-04-15',table_nbr:'I',src_line_nbr:'1',account_type:old,close_today_bal:'1020',open_today_bal:'1000'},
 {record_date:'2022-04-18',table_nbr:'I',src_line_nbr:'4',account_type:'Treasury General Account (TGA) Closing Balance',open_today_bal:'1100',close_today_bal:'null'},
 {record_date:'2023-05-09',table_nbr:'I',src_line_nbr:'4',account_type:'Treasury General Account (TGA) Closing Balance',open_today_bal:'1200',close_today_bal:'null'},
 {record_date:'2023-05-10',table_nbr:'I',src_line_nbr:'4',account_type:'Treasury General Account (TGA) Closing Balance',open_today_bal:'1220',close_today_bal:'null'}
];
const b=tgaByDay(balance);
assert.equal(b.days.length,5);
assert.equal(b.days[1].balance-b.days[0].balance,c.days[0].cashflow_net);
assert.equal(b.days[4].balance-b.days[3].balance,c.days[1].cashflow_net);
console.log('Treasury DTS 2021 legacy account and 2023 Sub-Total double-counting regression passed');
