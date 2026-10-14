// Historical 2019+ TGA backtest with yearly source partitioning.
// No invented results: fail closed if any year is missing or truncated.
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
const isoWeekday=s=>new Date(s+'T12:00:00Z').getUTCDay();
async function yearData(year){
 const p=new URLSearchParams({filter:'record_date:gte:'+year+'-01-01,record_date:lte:'+year+'-12-31',sort:'record_date','page[size]':'10000'});
 const r=await fetch(ROOT+'?'+p,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(year+' FiscalData HTTP '+r.status);
 const j=await r.json(),rows=j.data||[],total=Number(j.meta?.total_count??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error(year+' response truncated; pagination required');
 const map=new Map();
 for(const x of rows){
  if(String(x.table_nbr||'').trim().toUpperCase()!=='I'||String(x.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')))continue;
  const raw=x.open_today_bal??x.close_today_bal,v=Number(raw);
  if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(v)&&v>0)map.set(x.record_date,v);
 }
 if(map.size<30)throw Error(year+' missing TGA data: '+map.size);
 return [...map].map(([date,balance])=>({date,balance}));
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=7200, stale-while-revalidate=7200');
 try{
  const years=Array.from({length:new Date().getUTCFullYear()-2018},(_,i)=>2019+i);
  const all=(await Promise.all(years.map(yearData))).flat().sort((a,b)=>a.date.localeCompare(b.date));
  const unique=[...new Map(all.map(x=>[x.date,x])).values()],d=unique.map((x,i)=>({...x,wd:isoWeekday(x.date),dom:+x.date.slice(8),delta:i?x.balance-unique[i-1].balance:null}));
  const results={};
  for(const h of [1,3,5]){
   const byYear={};
   for(let i=150;i+h<d.length;i++){
    const train=d.slice(Math.max(1,i-500),i+1),allDelta=train.map(x=>x.delta).filter(Number.isFinite),global=med(allDelta);
    let wd=0,cal=0;
    for(let k=1;k<=h;k++){
     const t=d[i+k],w=train.filter(x=>x.wd===t.wd).map(x=>x.delta).filter(Number.isFinite),base=med(w.length>=8?w:allDelta);
     const close=train.filter(x=>Math.abs(x.dom-t.dom)<=1).map(x=>x.delta).filter(Number.isFinite);
     const weight=close.length>=12?Math.min(.5,close.length/(close.length+60)):0;
     wd+=base;cal+=(1-weight)*base+weight*(close.length>=12?med(close):global);
    }
    const actual=d[i+h].balance-d[i].balance,year=d[i].date.slice(0,4),slot=byYear[year]||(byYear[year]={zero:[],weekday:[],calendar:[]});
    for(const [name,pred] of Object.entries({zero:0,weekday:wd,calendar:cal}))slot[name].push(actual-pred);
   }
   results['D+'+h]=Object.fromEntries(Object.entries(byYear).map(([year,models])=>[year,Object.fromEntries(Object.entries(models).map(([name,err])=>[name,{samples:err.length,mae_usd_billions:+(err.reduce((s,x)=>s+Math.abs(x),0)/err.length/1000).toFixed(3)}]))]));
  }
  res.status(200).json({status:'historical_2019_plus_walk_forward_research',first_date:d[0].date,last_date:d.at(-1).date,observations:d.length,results,limitations:['Current-version FiscalData is not archived point-in-time vintage','Targets use subsequently observed reporting days (known future values never used in training)','No explicit tax or Treasury auction settlement features','No gold trades, profits or win rates']});
 }catch(e){res.status(502).json({status:'historical_backtest_blocked',error:String(e),warning:'No partial results are presented as full 2019+ history'})}
};