const assert=require('node:assert/strict');
const {normalize,knownAt,buildKnownFutureLedger}=require('../lib/endpoints/v22-auction-core');
const row=(auction_date,issue_date,maturity_date,amount,cusip)=>({auction_date,issue_date,maturity_date,cusip,security_type:'Bill',total_accepted:String(amount)});
const r1=row('2025-01-06','2025-01-09','2025-02-06',100000000,'AA1111111');
const r2=row('2025-02-03','2025-02-06','2025-03-06',120000000,'BB2222222');
const r3=row('2025-02-05','2025-02-06','2025-03-06',160000000,'CC3333333'); // NOT known on 2025-02-04
const {events,faults}=normalize([r1,r2,r3]);
assert.equal(events.length,3);assert.equal(faults.invalid_fields,0);
assert.equal(knownAt(events,'2025-02-05',2).length,2);
const x=buildKnownFutureLedger(events,'2025-02-05','2025-02-06',2);
assert.equal(x.by_type.Bill.known_gross_awards_usd,120000000);
assert.equal(x.by_type.Bill.known_maturing_original_auction_awards_usd,100000000);
assert.equal(x.known_bill_proxy_net_usd,20000000);
assert.equal(normalize([r1,r1]).faults.duplicate_auction_identity,1);
assert.throws(()=>buildKnownFutureLedger(events,'2025-02-05','2025-02-05',2));
console.log('Treasury auction as-of no-future-results normalization and settlement tests passed');
