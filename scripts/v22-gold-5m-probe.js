// Gold Yahoo GC=F 5-minute source audit ONLY. Probe actual retained history and clock continuity.
const fs=require('node:fs');
const now=Date.now(),lookback=58*86400000;
async function fetch5m(){
 const u=new URL('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF');
 u.searchParams.set('period1',String(Math.floor((now-lookback)/1000)));
 u.searchParams.set('period2',String(Math.floor(now/1000)));
 u.searchParams.set('interval','5m');
 const r=await fetch(u,{signal:AbortSignal.timeout(50000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error('Yahoo 5m rejected '+r.status+': '+(await r.text()).slice(0,220));
 const a=(await r.json()).chart;
 if(a?.error)throw Error('Yahoo 5m error '+JSON.stringify(a.error));
 const data=a?.result?.[0];
 if(!data?.timestamp?.length)throw Error('No 5-minute GC=F OHLC');
 const q=data.indicators?.quote?.[0]||{};
 return {raw:data.timestamp.map((t,i)=>({start_ms:t*1000,open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i]})),meta:data.meta};
}
async function main(){
 const report={verified_at_utc:new Date(now).toISOString(),sha:process.env.GITHUB_SHA||null,
   status:'probe_5m_pending',source:'Yahoo GC=F continuous Gold futures, NOT actual CME exchange fills'};
 try{
  const {raw,meta}=await fetch5m();
  const valid=raw.filter(x=>[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close)&&x.start_ms+300000<=now);
  const duplicates=new Set(valid.map(x=>x.start_ms)).size!==valid.length;
  const ordered=valid.slice().sort((a,b)=>a.start_ms-b.start_ms);
  const gap={},weekdays={};let gapsAbove15m=0,consecutive=0;
  for(let i=0;i<ordered.length;i++){
   const x=ordered[i];const day=new Date(x.start_ms).toISOString().slice(0,10);
   weekdays[day]=(weekdays[day]||0)+1;
   if(i===0)continue;
   const diff=(x.start_ms-ordered[i-1].start_ms)/60000;
   if(diff===5)consecutive++;else{
    const bucket=diff<=15?'6-15m':diff<=120?'16-120m':diff<=1440?'2h-24h':'>24h';
    gap[bucket]=(gap[bucket]||0)+1;
    if(diff>15)gapsAbove15m++;
   }
  }
  report.status='gold_5m_source_available';
  report.availability={requested_lookback_days:58,requested_start_utc:new Date(now-lookback).toISOString(),
   raw_candles:raw.length,closed_valid:valid.length,duplicates,
   first_5m_start_utc:new Date(ordered[0].start_ms).toISOString(),
   last_5m_close_utc:new Date(ordered.at(-1).start_ms+300000).toISOString(),
   observed_utc_calendar_days:Object.keys(weekdays).length,
   observed_utc_days_with_over_100_bars:Object.values(weekdays).filter(n=>n>=100).length,
   min_max_per_day:[Math.min(...Object.values(weekdays)),Math.max(...Object.values(weekdays))],
   contiguous_pairs:consecutive,gap_buckets:gap,gaps_over_15m:gapsAbove15m,
   instrument_currency:meta.currency,exchange_name:meta.fullExchangeName,
   exchange_timezone:meta.exchangeTimezoneName,
   regular_market_time:meta.regularMarketTime,
   yahoo_granularity:meta.dataGranularity,
   sample_start:ordered.slice(0,2),sample_end:ordered.slice(-2)};
  if(ordered.length<2500||duplicates)throw Error('Too few 5m usable candles or duplicate timestamps');
 }catch(e){report.status='gold_5m_source_blocked';report.error=String(e.stack||e)}
 fs.mkdirSync('reports',{recursive:true});
 fs.writeFileSync('reports/v22-gold-5m-source-audit.json',JSON.stringify(report,null,2));
 console.log(report.status,JSON.stringify(report.availability||report.error));
}
main().catch(e=>{console.error(e);process.exitCode=1});
