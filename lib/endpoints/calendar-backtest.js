// Out-of-sample fiscal calendar test: weekday-only vs weekday+day-of-month.
// Uses rolling past observations only. No Treasury net financing or gold claim.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function med(a){if(!a.length)return null;const x=a.slice().sort((a,b)=>a-b),n=x.length;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const r=await fetch(BASE+'?'+p,{signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const body=await r.json(),map=new Map();
  for(const row of body.data||[]){
   if(String(row.table_nbr||'').trim().toUpperCase()!=='I'||!/Treasury General Account.*Closing Balance/i.test(String(row.account_type||'')))continue;
   const raw=row.open_today_bal??row.close_today_bal;
   if(raw==null||raw==='')continue;
   const v=Number(raw);if(Number.isFinite(v)&&v>0&&!map.has(row.record_date))map.set(row.record_date,v);
  }
  const balances=[...map].sort((a,b)=>a[0].localeCompare(b[0]));
  const d=balances.slice(1).map((x,i)=>({date:x[0],delta:x[1]-balances[i][1],weekday:new Date(x[0]+'T12:00:00Z').getUTCDay(),dom:Number(x[0].slice(8))}));
  if(d.length<180)throw Error('Insufficient observations '+d.length);
  const results={};
  for(const h of [1,3,5]){
   const errs={zero:[],weekday:[],calendar:[]};
   for(let i=150;i+h<d.length;i++){
    const train=d.slice(Math.max(0,i-500),i+1),global=med(train.map(x=>x.delta));
    let wd=0,cal=0;
    for(let j=1;j<=h;j++){
     const target=d[i+j],w=train.filter(x=>x.weekday===target.weekday).map(x=>x.delta);
     const wbase=med(w.length>=8?w:train.map(x=>x.delta));
     wd+=wbase;
     // Calendar model: compare nearby day-of-month observations against weekday baseline.
     // Shrink sparse DOM samples toward weekday prediction.
     const close=train.filter(x=>Math.abs(x.dom-target.dom)<=1).map(x=>x.delta);
     const domEstimate=close.length>=12?med(close):global;
     const weight=close.length>=12?Math.min(.5,close.length/(close.length+60)):0;
     cal+=(1-weight)*wbase+weight*domEstimate;
    }
    const actual=balances[i+h+1][1]-balances[i+1][1];
    for(const [key,pred] of Object.entries({zero:0,weekday:wd,calendar:cal}))errs[key].push(actual-pred);
   }
   const models=Object.fromEntries(Object.entries(errs).map(([name,e])=>[name,{samples:e.length,mae_usd_billions:+(e.reduce((s,x)=>s+Math.abs(x),0)/e.length/1000).toFixed(3),rmse_usd_billions:+(Math.sqrt(e.reduce((s,x)=>s+x*x,0)/e.length)/1000).toFixed(3)}]));
   results['D+'+h]={models,calendar_improvement_vs_weekday_pct:+(100*(1-models.calendar.mae_usd_billions/models.weekday.mae_usd_billions)).toFixed(2),calendar_improvement_vs_zero_pct:+(100*(1-models.calendar.mae_usd_billions/models.zero.mae_usd_billions)).toFixed(2)};
  }
  res.status(200).json({status:'research_walk_forward_calendar_comparison',observations:balances.length,as_of:balances.at(-1)[0],results,method:'Trailing 500 report days; weekday median plus shrunk ±1 day-of-month median; origin-only training.',limitations:['Current-version DTS is not historical publication-time vintage','Day-of-month heuristic is NOT an explicit tax or Treasury settlement schedule','No gold prices or execution backtest','Calendar dates in evaluation are observed report dates only']});
 }catch(e){res.status(502).json({error:String(e)})}
};