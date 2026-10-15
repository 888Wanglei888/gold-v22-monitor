// V2.2 data feasibility gate: verify actual source access and coverage, not assumed availability.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800');
 const series=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL'];
 const results=await Promise.all(series.map(async id=>{
  try{
   const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd=2024-01-01';
   const r=await fetch(url,{signal:AbortSignal.timeout(11000),headers:{'User-Agent':'Mozilla/5.0'}});
   if(!r.ok)throw Error('HTTP '+r.status);
   const s=await r.text(),lines=s.trim().split(/\r?\n/),head=lines[0]||'';
   if(!head.includes(id)||!/(?:^|,)\s*(?:observation_date|DATE|date)\s*,/i.test(head+','))throw Error('CSV schema mismatch header='+head.slice(0,90));
   const valid=lines.slice(1).map(x=>x.split(',')).filter(x=>/^20\d\d-\d\d-\d\d$/.test(x[0])&&Number.isFinite(Number(x[1]))&&x[1]!=='.'&&x[1]!=='');
   const coverage=Object.fromEntries([2024,2025,2026].map(y=>[y,valid.filter(x=>x[0].startsWith(String(y))).length]));
   return {series:id,status:valid.length>=80?'source_access_ok':'insufficient_data',observations:valid.length,first_date:valid[0]?.[0]||null,last_date:valid.at(-1)?.[0]||null,coverage,frequency:id==='WRESBAL'?'weekly':'daily_or_business_daily'};
  }catch(e){return {series:id,status:'source_unavailable',error:String(e)}}
 }));
 const start=Math.floor(Date.UTC(2025,1,1)/1000),end=Math.floor(Date.now()/1000);
 const intraday=await Promise.all(['GC%3DF','GLD'].map(async(sym)=>{
  try{
   const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+sym+'?period1='+start+'&period2='+end+'&interval=1h',{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0'}});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json(),z=j.chart?.result?.[0],ts=z?.timestamp||[],q=z?.indicators?.quote?.[0];
   const valid=[];for(let k=0;k<ts.length;k++){const a=q?.open?.[k],b=q?.high?.[k],l=q?.low?.[k],d=q?.close?.[k];if([a,b,l,d].every(x=>Number.isFinite(x)&&x>0)&&b>=Math.max(a,d)&&l<=Math.min(a,d))valid.push({t:ts[k],o:a,h:b,l,c:d})}
   const buckets=new Map();for(const x of valid){const b=Math.floor(x.t/14400)*14400;buckets.set(b,(buckets.get(b)||0)+1)}
   const full=[...buckets].filter(([key,n])=>n===4);
   const perYear=Object.fromEntries([2024,2025,2026].map(y=>[y,valid.filter(x=>new Date(x.t*1000).getUTCFullYear()===y).length]));
   const fourHourPerYear=Object.fromEntries([2024,2025,2026].map(y=>[y,full.filter(([t])=>new Date(t*1000).getUTCFullYear()===y).length]));
   return {symbol:decodeURIComponent(sym),status:valid.length>100?'available':'insufficient_data',bars:ts.length,valid_ohlc_bars:valid.length,invalid_or_missing_ohlc_bars:ts.length-valid.length,first_date:valid[0]?new Date(valid[0].t*1000).toISOString():null,last_date:valid.at(-1)?new Date(valid.at(-1).t*1000).toISOString():null,hourly_per_year:perYear,complete_utc_four_hour_buckets:full.length,complete_utc_four_hour_per_year:fourHourPerYear,exchange_session_aligned_4h_verified:false};
  }catch(e){return {symbol:decodeURIComponent(sym),status:'source_unavailable',error:String(e)}}
 }));
 res.status(200).json({status:'v22_source_feasibility_audit',as_of:new Date().toISOString(),fred:results,intraday,complete_v22_backtest:false,limitations:['FRED CSV is current-vintage, not historical release-time archive','WRESBAL weekly frequency cannot be interpreted as daily bank reserves','UTC 4h counts are coverage diagnostics, not verified exchange-session aligned or trade-executable 4-hour candles','CFTC weekly report must be lagged to actual release, not Tuesday observation date','No missing inputs may be treated as passing signal filters']});
};
