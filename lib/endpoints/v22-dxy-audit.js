// ICE U.S. Dollar Index (Yahoo DX-Y.NYB) historical source audit.
// The actual ICE DXY source is distinct from FRED's broad trade-weighted dollar series.
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function dateET(t){const parts=Object.fromEntries(eastern.formatToParts(new Date(t*1000)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=1800');
 try{
  const url='https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?period1='+Math.floor(Date.UTC(2024,0,1)/1000)+'&period2='+Math.floor(Date.now()/1000)+'&interval=1d';
  const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
  if(!r.ok)throw Error('Dollar Index chart HTTP '+r.status);
  const a=(await r.json()).chart?.result?.[0];if(!a)throw Error('Missing DXY chart results');
  const q=a.indicators?.quote?.[0]||{},ts=a.timestamp||[],byDate=new Map();
  let invalid=0;
  for(let i=0;i<ts.length;i++){
   const x={date:dateET(ts[i]),timestamp:ts[i],open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i]};
   if(![x.open,x.high,x.low,x.close].every(z=>Number.isFinite(z)&&z>0)||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)){invalid++;continue}
   if(!byDate.has(x.date))byDate.set(x.date,[]);
   byDate.get(x.date).push(x);
  }
  const duplicates=[...byDate].filter(([,items])=>items.length!==1),usable=[...byDate].filter(([,items])=>items.length===1).map(([,items])=>items[0]).sort((x,y)=>x.date.localeCompare(y.date));
  const annual=Object.fromEntries([2024,2025,2026].map(y=>[y,usable.filter(x=>x.date.startsWith(String(y))).length]));
  res.status(200).json({status:usable.length>=300?'dxy_daily_source_access_ok':'dxy_daily_coverage_insufficient',source:'Yahoo chart DX-Y.NYB (ICE US Dollar Index)',symbol:'DX-Y.NYB',raw_bars:ts.length,usable_unique_trading_days:usable.length,invalid_ohlc_bars:invalid,duplicate_exchange_dates_excluded:duplicates.length,first_date:usable[0]?.date||null,last_date:usable.at(-1)?.date||null,by_year:annual,recent:usable.slice(-3).map(x=>({date:x.date,close:x.close})),usable_for_full_v22_point_in_time:false,limitations:['Yahoo is an unlicensed research proxy, not a contracted production ICE DXY feed','Duplicate daily dates are quarantined, not silently averaged or chosen','Market daily close is not information available before that session closes','FRED broad trade-weighted US dollar index must not be silently relabeled as ICE DXY','Historical data-vintage, publication release timestamps and gold trade-time joins not verified']});
 }catch(e){res.status(200).json({status:'dxy_daily_source_blocked',source:'DX-Y.NYB',error:String(e),usable_for_full_v22_point_in_time:false,no_invented_data:true})}
};
