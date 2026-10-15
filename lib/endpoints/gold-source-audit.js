// Research-only source audit. Never fabricate candles or treat an ETF as spot gold.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800');
 const end=Math.floor(Date.now()/1000),start=Math.floor(Date.UTC(2023,0,1)/1000);
 const sources=[
  {provider:'Yahoo Finance',symbol:'GC=F',asset:'COMEX gold futures continuous proxy',url:'https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+start+'&period2='+end+'&interval=1d'},
  {provider:'Yahoo Finance',symbol:'GLD',asset:'US-listed gold ETF proxy',url:'https://query1.finance.yahoo.com/v8/finance/chart/GLD?period1='+start+'&period2='+end+'&interval=1d'}
 ];
 const attempts=[];
 for(const source of sources){
  try{
   const r=await fetch(source.url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json(),item=j.chart?.result?.[0];
   if(!item)throw Error(j.chart?.error?.description||'Missing chart result');
   const ts=item.timestamp||[],q=item.indicators?.quote?.[0]||{},bars=[];
   for(let i=0;i<ts.length;i++){const [o,h,l,c]=[q.open?.[i],q.high?.[i],q.low?.[i],q.close?.[i]];if(![o,h,l,c].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)||h<Math.max(o,c,l)||l>Math.min(o,c,h))continue;bars.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:o,high:h,low:l,close:c})}
   const duplicates=bars.length-new Set(bars.map(x=>x.date)).size;
   const coverage=Object.fromEntries([2023,2024,2025,2026].map(y=>[y,bars.filter(x=>x.date.startsWith(String(y))).length]));
   const usable=duplicates===0&&coverage[2023]>=190&&coverage[2024]>=190&&coverage[2025]>=190&&coverage[2026]>=100;
   attempts.push({provider:source.provider,symbol:source.symbol,asset:source.asset,status:usable?'candidate_coverage_pass':'incomplete_coverage',bars:bars.length,first_date:bars[0]?.date,last_date:bars.at(-1)?.date,coverage,duplicates,usable_for_research:usable});
  }catch(e){attempts.push({provider:source.provider,symbol:source.symbol,asset:source.asset,status:'unavailable',error:String(e)})}
 }
 const available=attempts.some(x=>x.usable_for_research);
 res.status(200).json({status:available?'gold_proxy_candidate_available':'gold_proxy_sources_unavailable',attempts,trade_backtest_completed:false,limitations:['GC=F is futures proxy, not XAUUSD spot; GLD is an ETF proxy, not gold spot','Yahoo historical chart access is not a licensed production feed','Continuous futures may have roll and adjustment effects','Daily OHLC cannot establish a fill immediately after DTS release','No trading profits or win rates calculated']});
};
