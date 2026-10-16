const assert=require('node:assert/strict');
const {makeC2,decide}=require('../lib/endpoints/v22-c2-core');
const {buildAsOf}=require('../lib/endpoints/v22-asof-core');
const names=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL','DXY','COT_NET','COT_OI','TGA','GLD_TONNES_DELTA'];
const dates=['2025-03-01','2025-03-25','2025-04-10','2025-04-20'];
const sources=Object.fromEntries(names.map(id=>{
 const v=id==='DXY'?[105,103,102,100]:id==='DFII10'?[2,1.9,1.8,1.7]:
 id==='GLD_TONNES_DELTA'?[1,1,2,3]:id==='COT_NET'?[100,120,140,160]:
 id==='SOFR'?[4.32,4.32,4.32,4.32]:id==='IORB'?[4.30,4.30,4.30,4.30]:[1,2,3,4];
 return [id,buildAsOf(dates.map((date,i)=>({date,value:v[i]})),1)];
}));
const maxAgeDays=Object.fromEntries(names.map(k=>[k,60]));
const forecast=[{no_earlier_than_utc:'2025-04-18T23:59:59Z',forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions:-40000,
 forecast_target_date:'2025-04-24',future_days_without_published_auction_issuance:1}];
const revisions=[{no_earlier_than_utc:'2025-04-19T23:59:59Z',fiscal_revision_z_research_proxy_fallback:-1.2}];
const candidate={confirmed_at:Date.parse('2025-04-22T20:00:00Z'),dir:'long'};
for(const mode of ['anticipation','credit_exception','combined']){
 const x=makeC2({sources,maxAgeDays,decisionForecasts:forecast,revisionRecords:revisions,mode});
 assert(x.gate(candidate).eligible,mode+' expected research candidate');
 assert(x.counts.eligible===1);
}
const strict=makeC2({sources,maxAgeDays,decisionForecasts:forecast,revisionRecords:revisions,mode:'revision'});
assert(strict.gate(candidate).eligible);
assert(!makeC2({sources,maxAgeDays,decisionForecasts:forecast,revisionRecords:[],mode:'revision'}).gate(candidate).eligible);
assert(!makeC2({sources,maxAgeDays,decisionForecasts:[],revisionRecords:revisions,mode:'combined'}).gate(candidate).eligible);
const missing=makeC2({sources:{...sources,IORB:{rows:[]}},maxAgeDays,decisionForecasts:forecast,revisionRecords:revisions,mode:'combined'});
assert(!missing.gate(candidate).eligible);
const future=makeC2({sources,maxAgeDays,decisionForecasts:[{...forecast,no_earlier_than_utc:'2025-04-23T23:59:59Z'}],revisionRecords:revisions,mode:'combined'});
assert(!future.gate(candidate).eligible);
const base={side:1,usd:true,real:true,gld:true,cot:true,reserve:true,fiscal:-35,spread:0,z:0,credit:false};
assert(decide(base,'anticipation').eligible);
assert(!decide({...base,usd:false,real:false,gld:false,cot:false},'anticipation').eligible);
assert(!decide({...base,fiscal:45},'anticipation').eligible);
assert(decide({...base,fiscal:45,credit:true},'credit_exception').eligible);
assert(!decide({...base,fiscal:45,credit:true,spread:.3},'credit_exception').eligible);
assert.equal(decide(base,'revision').eligible,false);
assert.throws(()=>makeC2({sources,maxAgeDays,decisionForecasts:forecast,revisionRecords:revisions,mode:'unknown'}));
console.log('C2 anticipation, fiscal revision, credit repricing, price timing and missing-source tests passed');
