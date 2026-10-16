const assert=require('node:assert/strict');
const {adjustCOT,conservativeCotRelease}=require('../lib/endpoints/v22-cot-release');
const raw=[{date:'2025-09-30',value:100,available_utc_ms:Date.parse('2025-10-15T00:00:00Z')},
 {date:'2025-10-07',value:110,available_utc_ms:Date.parse('2025-10-22T00:00:00Z')},
 {date:'2025-12-16',value:120,available_utc_ms:Date.parse('2025-12-31T00:00:00Z')},
 {date:'2026-01-20',value:130,available_utc_ms:Date.parse('2026-02-04T00:00:00Z')}];
const z=adjustCOT(raw);
assert.equal(z.shutdown_delayed_report_observations,4);
assert(z.rows[0].available_utc_ms>=Date.parse('2025-11-20T00:00:00Z'));
assert.equal(conservativeCotRelease('2025-10-07'),Date.parse('2025-11-22T00:00:00Z'));
assert.equal(conservativeCotRelease('2025-12-16'),Date.parse('2026-01-07T00:00:00Z'));
assert.equal(conservativeCotRelease('2025-04-08'),Date.parse('2025-04-12T00:00:00Z'));
assert(!z.rows.some(x=>x.date==='2025-09-30'&&x.available_utc_ms<Date.parse('2025-11-20T00:00:00Z')));
console.log('CFTC 2025 shutdown and 2026 catchup releases are protected against historical lookahead');
