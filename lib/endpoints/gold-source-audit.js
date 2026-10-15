// Gold price data-source audit only. Does not generate trades or claim a backtest.
// Stooq's XAUUSD daily CSV is a candidate source; reject HTML/error and incomplete coverage.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 const url='https://stooq.com/q/d/l/?s=xauusd&i=d&d1=20230101&d2=20261231';
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Mozilla/5.0 gold-v22-research'}});
  if(!r.ok)throw Error('Price provider HTTP '+r.status);
  const body=await r.text();
  if(!/^Date,Open,High,Low,Close(?:,Volume)?\r?\n/i.test(body))throw Error('Price provider did not return expected OHLC CSV');
  const lines=body.trim().split(/\r?\n/).slice(1),bars=[];
  for(const line of lines){const a=line.split(',');if(a.length<5)continue;const [date,...v]=a;const nums=v.slice(0,4).map(Number);if(!/^20\d\d-\d\d-\d\d$/.test(date)||nums.some(n=>!Number.isFinite(n)||n<=0))continue;const [open,high,low,close]=nums;if(high<Math.max(open,close,low)||low>Math.min(open,close,high))continue;bars.push({date,open,high,low,close})}
  bars.sort((a,b)=>a.date.localeCompare(b.date));
  const duplicates=bars.length-new Set(bars.map(x=>x.date)).size;
  const coverage=Object.fromEntries([2023,2024,2025,2026].map(y=>[y,bars.filter(x=>x.date.startsWith(String(y))).length]));
  const usable=duplicates===0&&coverage[2023]>=200&&coverage[2024]>=200&&coverage[2025]>=200&&coverage[2026]>=100;
  res.status(200).json({status:usable?'candidate_ohlc_coverage_pass':'candidate_ohlc_coverage_incomplete',provider:'Stooq',symbol:'XAUUSD',bar_type:'daily',bars:bars.length,first_date:bars[0]?.date||null,last_date:bars.at(-1)?.date||null,coverage,duplicates,usable_for_research:usable,trade_backtest_completed:false,limitations:['Provider data licensing, adjustments and timestamp must be verified','Daily OHLC cannot establish intraday execution at fiscal release','No trades or profits have been calculated']});
 }catch(e){res.status(502).json({status:'gold_ohlc_source_unavailable',error:String(e),trade_backtest_completed:false})}
};
