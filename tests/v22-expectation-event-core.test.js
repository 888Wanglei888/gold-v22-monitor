const assert=require('node:assert/strict');
const {study,moveBusiness}=require('../lib/endpoints/v22-expectation-event-core');
const {normalizeAnnouncements}=require('../lib/endpoints/v22-auction-core');
assert.equal(moveBusiness('2025-06-16',-1),'2025-06-13');
assert.equal(moveBusiness('2025-06-16',-5),'2025-06-09');
const H=4*3600000,base=Date.parse('2025-06-01T00:00:00Z'),candles=[];
for(let i=0;i<330;i++){
 const t=base+i*H,close=100+i*.03;
 candles.push({start_ms:t,close_ms:t+H,open:close,close:close+.02,high:close+.15,low:close-.15});
}
const bill={auction_date:'2025-06-05',announcemt_date:'2025-06-04',issue_date:'2025-06-16',maturity_date:'2025-07-16',cusip:'AB1234567',security_type:'Bill',offering_amt:'70000000000',total_accepted:'70000000000'};
const notKnown={...bill,auction_date:'2025-06-17',announcemt_date:'2025-06-17',issue_date:'2025-06-18',maturity_date:'2025-08-16',cusip:'CD1234567',offering_amt:'120000000000'};
const known=normalizeAnnouncements([bill]).events;
const audit=study({auctionEvents:known,goldCandles:candles,startDate:'2025-06-16',endDate:'2025-06-18',thresholdUsdBillions:50});
assert(audit.by_horizon['T-3'].bill_only.screened_known_events>=1);
const altered=study({auctionEvents:normalizeAnnouncements([bill,notKnown]).events,goldCandles:candles,startDate:'2025-06-16',endDate:'2025-06-16',thresholdUsdBillions:50});
assert.deepEqual(altered.by_horizon['T-3'].overall,audit.by_horizon['T-3'].overall);
assert.equal(audit.user_gold_v22_trade_signals,0);
assert.equal(audit.full_v22_backtest_ready,false);

const mature={auction_date:'2025-06-02',announcemt_date:'2025-06-01',issue_date:'2025-06-03',maturity_date:'2025-06-17',cusip:'EF1234567',security_type:'Bill',offering_amt:'80000000000',total_accepted:'80000000000'};
const maturityOnly=study({auctionEvents:normalizeAnnouncements([mature]).events,goldCandles:candles,
 startDate:'2025-06-17',endDate:'2025-06-17',thresholdUsdBillions:50});
assert.equal(maturityOnly.by_horizon['T-3'].maturity_only_without_announced_new_issuance.screened_known_events,1);
assert.equal(maturityOnly.by_horizon['T-3'].bill_only.cashflow_direction_evaluable,0,'Missing future replacement offering must not create bullish liquidity signal');

const unavailable=study({auctionEvents:normalizeAnnouncements([notKnown]).events,goldCandles:candles,startDate:'2025-06-18',endDate:'2025-06-18',thresholdUsdBillions:50});
assert.equal(unavailable.by_horizon['T-1'].bill_only.screened_known_events,0,'Future announcement not known on prior day');
const after=candles.map(x=>({...x}));after[after.length-1].close+=400;
const rerun=study({auctionEvents:known,goldCandles:after,startDate:'2025-06-16',endDate:'2025-06-16',thresholdUsdBillions:50});
assert.equal(rerun.by_horizon['T-3'].bill_only.screened_known_events,altered.by_horizon['T-3'].bill_only.screened_known_events);
assert.throws(()=>study({auctionEvents:known,goldCandles:[...candles,candles[0]]}),/overlapping/);
console.log('Ex-ante Treasury announcement and tax-calendar T-5/3/1 gold study nonhindsight tests passed');
