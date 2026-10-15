// Official CFTC Disaggregated Futures Only: COMEX Gold (market code 088691).
// Research-only coverage check. Tuesday observation is NOT released until a later publication date.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 const p=new URLSearchParams();
 p.set('cftc_contract_market_code','088691');
 p.set('$where',"report_date_as_yyyy_mm_dd >= '2024-01-01T00:00:00'");
 p.set('$order','report_date_as_yyyy_mm_dd ASC');
 p.set('$limit','500');
 const source='https://publicreporting.cftc.gov/resource/72hh-3qpy.json?'+p.toString();
 try{
  const r=await fetch(source,{signal:AbortSignal.timeout(17000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
  if(!r.ok)throw Error('CFTC HTTP '+r.status);
  const rows=await r.json();if(!Array.isArray(rows))throw Error('Unexpected CFTC response');
  const observed=rows.map(x=>{
   const long=Number(x.m_money_positions_long_all),short=Number(x.m_money_positions_short_all),oi=Number(x.open_interest_all);
   const date=String(x.report_date_as_yyyy_mm_dd||'').slice(0,10);
   return {date,long,short,net:long-short,open_interest:oi,market:String(x.market_and_exchange_names||'')};
  }).filter(x=>/^20\d\d-\d\d-\d\d$/.test(x.date)&&Number.isFinite(x.net)&&Number.isFinite(x.open_interest)&&x.open_interest>0);
  if(observed.some(x=>!x.market.toUpperCase().includes('GOLD')))throw Error('Market code mismatch: non-gold records');
  const coverage=Object.fromEntries([2024,2025,2026].map(y=>[y,observed.filter(x=>x.date.startsWith(String(y))).length]));
  const recent=observed.slice(-4).map(x=>({...x}));
  res.status(200).json({status:observed.length>=80?'cot_source_access_ok':'cot_insufficient_coverage',source:'CFTC Disaggregated Futures Only (72hh-3qpy)',contract_market_code:'088691',observations:observed.length,first_observation_date:observed[0]?.date||null,last_observation_date:observed.at(-1)?.date||null,coverage_by_year:coverage,recent_reports_observation_date_only:recent,release_timestamp_aligned:false,usable_as_v22_trade_filter:false,limitations:['Tuesday position report date is NOT publication date; official release calendar required before use in trading','Futures-only series must not be mixed with futures-and-options combined series','This source audit neither proves ETF fund flows nor licensed intraday execution','Current data may include revisions; point-in-time historical snapshots are not validated']});
 }catch(e){res.status(200).json({status:'cot_source_blocked',source:'CFTC Disaggregated Futures Only (72hh-3qpy)',error:String(e),no_invented_data:true,usable_as_v22_trade_filter:false})}
};
