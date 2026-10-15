const assert=require('node:assert/strict');
const {dueEvent,approxFifteenthBusinessDay,taxAdjustment}=require('../lib/endpoints/v22-tax-calendar');
assert.equal(approxFifteenthBusinessDay(2025,6),'2025-06-16');
assert.equal(approxFifteenthBusinessDay(2026,4),'2026-04-15');
assert.equal(dueEvent('2026-04-15'),4);
assert.equal(dueEvent('2026-04-14'),null);
const prior=[{target:'2024-04-15',tax_net_proxy:180000},{target:'2025-04-15',tax_net_proxy:210000},
 {target:'2025-03-20',tax_net_proxy:10000},{target:'2025-02-20',tax_net_proxy:12000}];
const p=taxAdjustment('2026-04-15',prior,2);
assert.equal(p.history_years,2);assert.equal(p.missing,false);
assert.equal(p.calendar_tax_adjustment,195000-11000);
assert.equal(taxAdjustment('2025-04-15',prior.filter(x=>x.target.startsWith('2024')),2).missing,true);
assert.equal(taxAdjustment('2026-04-14',prior).calendar_tax_adjustment,0);
console.log('Ex-ante recurrent Treasury tax-date detection and prior-year-only correction tests passed');
