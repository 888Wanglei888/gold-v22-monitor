// Experimental historical TGA baseline; not a V2.2 trading signal.
// Data source: U.S. Treasury FiscalData Daily Treasury Statement, Table I line 4.
// Every forecast uses only observations dated on or before its forecast origin.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function median(xs){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function weekdays(d,n){const out=[];let t=new Date(d+'T12:00:00Z');while(out.length<n){t.setUTCDate(t.getUTCDate()+1);if(t.getUTCDay()!==0&&t.getUTCDay()!==6)out.push(t.toISOString().slice(0,10))}return out}
async function getHistory(){
 const params=new URLSearchParams({'sort':'-record_date','page[size]':'1200'});
 const response=await fetch(BASE+'?'+params,{signal:AbortSignal.timeout(17000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('FiscalData HTTP '+response.status);
 const body=await response.json();
 const map=new Map();
 for(const r of body.data||[]){
  if(String(r.table_nbr||'').trim().toUpperCase()!=='I'||String(r.src_line_nbr||'').trim()!=='4')continue;
  if(!/Treasury General Account.*Closing Balance/i.test(String(r.account_type||'')))continue;
  const value=Number(r.close_today_bal??r.open_today_bal);
  if(!Number.isFinite(value)||value<=0)continue;
  if(!map.has(r.record_date))map.set(r.record_date,{date:r.record_date,tga_usd_millions:value});
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const h=await getHistory();
  if(h.length<35)throw Error('Insufficient TGA history: '+h.length);
  const latest=h[h.length-1],deltas=[];
  for(let i=1;i<h.length;i++){const days=(Date.parse(h[i].date)-Date.parse(h[i-1].date))/86400000;if(days<=5)deltas.push({date:h[i].date,weekday:new Date(h[i].date+'T12:00:00Z').getUTCDay(),delta:h[i].tga_usd_millions-h[i-1].tga_usd_millions})}
  const recent=deltas.slice(-Math.min(deltas.length,130)),global=median(recent.map(x=>x.delta));
  const upcoming=weekdays(latest.date,5);
  let total=0;const daily=upcoming.map(date=>{const wd=new Date(date+'T12:00:00Z').getUTCDay(),sample=recent.filter(x=>x.weekday===wd).map(x=>x.delta);const estimate=sample.length>=8?median(sample):global;total+=estimate;return {date,expected_delta_usd_billions:+(estimate/1000).toFixed(3),estimated_tga_usd_billions:+((latest.tga_usd_millions+total)/1000).toFixed(3),weekday_sample_size:sample.length}});
  const horizons=[1,3,5].map(n=>({trading_days:n,through_date:daily[n-1].date,expected_change_usd_billions:+((daily[n-1].estimated_tga_usd_billions)-(latest.tga_usd_millions/1000)).toFixed(3),estimated_tga_usd_billions:daily[n-1].estimated_tga_usd_billions}));
  res.status(200).json({status:'experimental_baseline_not_trade_signal',retrieved_at:new Date().toISOString(),as_of:latest.date,latest_tga_usd_billions:+(latest.tga_usd_millions/1000).toFixed(3),history_observations:h.length,method:'Trailing up-to-130 observed daily changes, weekday median; no Treasury settlement or tax calendar adjustments. Business days exclude weekends only, NOT U.S. holidays.',horizons,daily,history_last_10:h.slice(-10),limitations:['No historical vintage store; cannot claim point-in-time backtest','Forecast dates exclude weekends but not federal holidays','No TreasuryDirect auction settlement net cash, DTS taxes, reserves, RRP, gold or COT adjustments','This baseline must not be used for live A/A+/A++ signals'],source:BASE});
 }catch(e){res.status(502).json({error:String(e)})}
};