// Independently measured gold A/B benchmark and honest C completeness; nothing labeled full V2.2.
const fs=require('node:fs'),{build4h}=require('../lib/endpoints/v22-asof-core'),{evaluate}=require('../lib/endpoints/v22-benchmark-core');
async function main(){
 const report={checked_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA||null,
  source:'Yahoo GC=F continuous Gold futures hourly research proxy',status:'gold_three_way_comparison_not_yet_validated',trade_signals_enabled:false};
 try{
  const start=Math.floor(Date.UTC(2024,11,1)/1000),end=Math.floor(Date.now()/1000);
  const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+start+'&period2='+end+'&interval=1h';
  const response=await fetch(url,{signal:AbortSignal.timeout(48000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
  if(!response.ok)throw Error('Gold source HTTP '+response.status);
  const d=(await response.json()).chart?.result?.[0];
  if(!d?.timestamp?.length)throw Error('Missing Yahoo gold hourly bars');
  const q=d.indicators?.quote?.[0]||{};
  const input=d.timestamp.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]}));
  const gold=build4h(input,Date.now());
  if(gold.candles.length<1700)throw Error('Insufficient completed gold 4h bars '+gold.candles.length);
  const result=evaluate({inputCandles:gold.candles,startDate:'2025-06-02',initialCash:10000,costBpsRoundTrip:10,stopATR:1.5,maxBars:15,riskFraction:.005,maxLeverage:5});
  if(result.A_always_long.final_equity_usd===null||result.B_dow_higher_frames_plus_4h.final_equity_usd===null||result.C_original_V22.win_rate_pct!==null)throw Error('Comparative benchmark completeness gate');
  report.status='gold_A_B_benchmarks_completed_C_V22_benchmark_explicitly_blocked';
  report.input={raw_hour_records:input.length,closed_four_hour_bars:gold.candles.length,quality:gold.quality};
  report.comparison=result;
 }catch(e){report.status='gold_AB_comparative_benchmark_blocked';report.error=String(e)}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-three-way-benchmark-latest.json',JSON.stringify(report,null,2));
 console.log('Status:',report.status,report.error||'');
 if(report.comparison){
  console.log('A:',report.comparison.A_always_long);
  console.log('B:',report.comparison.B_dow_higher_frames_plus_4h);
  console.log('C:',report.comparison.C_original_V22);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
