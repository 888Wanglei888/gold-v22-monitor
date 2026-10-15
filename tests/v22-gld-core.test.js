const assert=require('node:assert/strict');
const {parseDate,parseXlsx}=require('../lib/endpoints/v22-gld-core');
assert.equal(parseDate('18-Nov-2004'),'2004-11-18');
assert.equal(parseDate('29-Feb-2025'),null);
assert.equal(parseDate('14-Oct-2026'),'2026-10-14');
async function main(){
 const url='https://api.spdrgoldshares.com/api/v1/historical-archive?exchange=NYSE&lang=en&product=gld';
 const r=await fetch(url,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
 if(!r.ok)throw Error('SPDR XLSX '+r.status);
 const bytes=Buffer.from(await r.arrayBuffer());
 const data=parseXlsx(bytes),coverage=data.coverage;
 assert(coverage.rows_with_date_and_tonnes>=5000,'Insufficient historic GLD tonnes');
 assert(coverage.annual[2025].change_days>=200,'Insufficient 2025 GLD history');
 assert(coverage.annual[2026].change_days>=120,'Insufficient 2026 GLD history');
 assert(data.changes.every(x=>Number.isFinite(x.value)));
 assert(data.changes.every((x,i)=>i===0||x.date>data.changes[i-1].date));
 console.log('Official GLD Node XLSX parser validated (no raw holdings published):',JSON.stringify(coverage));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
