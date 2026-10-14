// Historical TGA model performance by year and horizon, strictly rolling-origin.
// Diagnostic only; not publication-time-vintage and not a gold backtest.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const median=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2};
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const r=await fetch(BASE+'?'+p,{signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const j=await r.json(),map=new Map();
  for(const x of j.data||[]){
   if(String(x.table_nbr||'').trim().toUpperCase()!=='I'||String(x.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')))continue;
   const v=x.open_today_bal??x.close_today_bal;if(v==null||v==='')continue;
   const n=Number(v);if(Number.isFinite(n)&&n>0&&!map.has(x.record_date))map.set(x.record_date,n);
  }
  const b=[...map].sort((a,b)=>a[0].localeCompare(b[0]));
  if(b.length<200)throw Error('Insufficient history '+b.length);
  const d=b.map(([date,balance],i)=>({date,balance,delta:i?balance-b[i-1][1]:null,wd:new Date(date+'T12:00:00Z').getUTCDay(),dom:+date.slice(8)}));
  const byYear={};
  for(const h of [1,3,5]){
   for(let i=150;i+h<d.length;i++){
    const train=d.slice(Math.max(1,i-500),i+1),all=train.map(x=>x.delta).filter(Number.isFinite);
    const global=median(all);
    let weekday=0,calendar=0;
    for(let k=1;k<=h;k++){
     const t=d[i+k],wd=train.filter(x=>x.wd===t.wd).map(x=>x.delta).filter(Number.isFinite);
     const w=median(wd.length>=8?wd:all);
     const dm=train.filter(x=>Math.abs(x.dom-t.dom)<=1).map(x=>x.delta).filter(Number.isFinite);
     const weight=dm.length>=12?Math.min(.5,dm.length/(dm.length+60)):0;
     weekday+=w;calendar+=(1-weight)*w+weight*(dm.length>=12?median(dm):global);
    }
    const actual=d[i+h].balance-d[i].balance,year=d[i].date.slice(0,4),key=year+'_D+'+h;
    const entry=byYear[key]||(byYear[key]={year,horizon:h,errors:{zero:[],weekday:[],calendar:[]}});
    for(const [name,pred] of Object.entries({zero:0,weekday,calendar}))entry.errors[name].push(actual-pred);
   }
  }
  const periods=Object.values(byYear).sort((a,b)=>a.year.localeCompare(b.year)||a.horizon-b.horizon).map(x=>{
   const metrics=Object.fromEntries(Object.entries(x.errors).map(([k,errors])=>[k,{samples:errors.length,mae_usd_billions:+(errors.reduce((s,v)=>s+Math.abs(v),0)/errors.length/1000).toFixed(3)}]));
   return {year:x.year,horizon:x.horizon,models:metrics,weekday_improvement_pct:+(100*(1-metrics.weekday.mae_usd_billions/metrics.zero.mae_usd_billions)).toFixed(2),calendar_improvement_pct:+(100*(1-metrics.calendar.mae_usd_billions/metrics.zero.mae_usd_billions)).toFixed(2)};
  });
  res.status(200).json({status:'historical_yearly_robustness_only',as_of:d.at(-1).date,observations:d.length,periods,source:BASE,limitations:['Uses current-version historical DTS, not historical published vintages','Years with short samples are unstable','Horizon counts report observations, not calendar days','No debt settlement forecast, no gold trade returns']});
 }catch(e){res.status(502).json({error:String(e)})}
};