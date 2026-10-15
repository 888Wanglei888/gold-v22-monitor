// Run fiscal research API handlers against official sources directly in GitHub Actions.
// Vercel production may lag GitHub code; do not substitute stale deployment outputs.
const fs=require('node:fs');
const path=require('node:path');
const inputs=['v22-tga-cashflow-identity','v22-auction-known-forecast','v22-auction-source-audit'];
async function invoke(name){
 const handler=require('../lib/endpoints/'+name+'.js');
 let status=200,body;
 const res={setHeader(){return this},status(v){status=v;return this},json(v){body=v;return this}};
 const started=Date.now();
 try{
  await handler({query:{}},res);
  return {http_status:status,elapsed_ms:Date.now()-started,status:body?.status||null,error:body?.error||null,source:body?.source||null,
   audit:name==='v22-tga-cashflow-identity'?body?.years:
     name==='v22-auction-known-forecast'?{sources:body?.data_coverage,by_horizon:body?.by_horizon,limitations:body?.limitations}:
     {per_year:body?.per_year,bad_data:body?.bad_data,missing:body?.missing_required_fields}};
 }catch(e){return {http_status:0,elapsed_ms:Date.now()-started,status:'handler_exception',error:String(e)}}
}
async function main(){
 const out={checked_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA||null,source:'GitHub Actions standalone Node 24; NOT Vercel production',full_v22_trade_backtest_ready:false,trade_signals_enabled:false,endpoints:{}};
 const settled=await Promise.all(inputs.map(invoke));
 for(let i=0;i<inputs.length;i++)out.endpoints[inputs[i]]=settled[i];
 fs.mkdirSync(path.join(__dirname,'..','reports'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'..','reports','fiscal-validation-local-latest.json'),JSON.stringify(out,null,2));
 for(const [name,v] of Object.entries(out.endpoints))console.log(name,v.status,v.error||'',v.elapsed_ms+'ms');
 if(out.endpoints['v22-tga-cashflow-identity'].status==='tga_cashflow_identity_audit_blocked')console.log('Tax identity failed; inspect result, DO NOT enable historical forecast');
}
main().catch(e=>{console.error(e);process.exitCode=1});
