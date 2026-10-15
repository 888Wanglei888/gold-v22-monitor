// Direct-source technical candidates only. No fiscal/macro confirmation => no real V2.2 trades.
const fs=require('node:fs'),{build4h}=require('../lib/endpoints/v22-asof-core'),{scan}=require('../lib/endpoints/v22-price-pattern-core');
async function main(){
 const start=Math.floor(Date.UTC(2025,0,1)/1000),end=Math.floor(Date.now()/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+start+'&period2='+end+'&interval=1h';
 const result={checked_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA||null,source:'Yahoo continuous GC=F 1-hour research proxy',status:'v22_price_patterns_not_a_backtest',complete_v22_trade_backtest:false,trade_signals_enabled:false};
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
  if(!r.ok)throw Error('Gold hourly response '+r.status);
  const a=(await r.json()).chart?.result?.[0];if(!a?.timestamp?.length)throw Error('GC=F hourly chart missing');
  const quote=a.indicators?.quote?.[0]||{},raw=a.timestamp.map((t,i)=>({t:t*1000,o:quote.open?.[i],h:quote.high?.[i],l:quote.low?.[i],c:quote.close?.[i]}));
  const gold=build4h(raw,Date.now());
  if(gold.candles.length<1500)throw Error('Insufficient complete 4h close bars '+gold.candles.length);
  const patterns=scan(gold.candles);
  result.status='closed_four_hour_price_pattern_audited';
  result.ohlc={raw_hours:raw.length,closed_four_hour_candles:gold.candles.length,quality:gold.quality,first:gold.candles[0]?.session_date,last:gold.candles.at(-1)?.session_date};
  result.patterns=patterns;
  result.limitations=['These are technical price-only patterns; not A/A+/A++ verified V2.2 macro signals','Continuous Yahoo gold futures are not specific contracts, roll-adjusted or execution licensed','The original Dow daily/weekly trend still requires separately verified confirmation','4h interval anchored to America/New_York CME sessions and must be cross-checked against actual exchange breaks','No trade PnL is output because fiscal vintages, ETF flows and full strategy factor confirmations are not verified'];
 }catch(e){result.status='four_hour_price_pattern_source_blocked';result.error=String(e)}
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/v22-price-pattern-latest.json',JSON.stringify(result,null,2));
 console.log(result.status,result.ohlc?.closed_four_hour_candles||0,result.patterns?.candidate_count||0,result.error||'');
}
main().catch(e=>{console.error(e);process.exitCode=1});
