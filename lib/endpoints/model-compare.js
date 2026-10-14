// Historical walk-forward forecast comparison using observed DTS TGA balances.
// Uses only earlier dated observations; source revisions and publication-time vintages
// are not reconstructed. Research only; not a gold trade backtest.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const med=xs=>{if(!xs.length)return null;const a=xs.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const response=await fetch(URL+'?'+p,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('DTS HTTP '+response.status);
  const json=await response.json(),map=new Map();
  for(const r of json.data||[]){
   if(String(r.table_nbr||'').trim().toUpperCase()!=='I'||String(r.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance|财政部一般账户.*期末余额/i.test(String(r.account_type||'')))continue;
   const raw=r.open_today_bal??r.open_month_bal;if(raw==null||raw==='')continue;
   const v=Number(raw);if(Number.isFinite(v)&&v>0&&!map.has(r.record_date))map.set(r.record_date,v);
  }
  const h=[...map].sort((a,b)=>a[0].localeCompare(b[0]));
  if(h.length<110)throw Error('Not enough DTS history: '+h.length);
  const delta=[];
  for(let i=1;i<h.length;i++){
   const gap=(Date.parse(h[i][0])-Date.parse(h[i-1][0]))/86400000;
   if(gap>5)continue;
   delta.push({date:h[i][0],weekday:new Date(h[i][0]+'T12:00:00Z').getUTCDay(),change:h[i][1]-h[i-1][1]});
  }
  const metrics={zero:{errors:[],direction:[]},weekday_median:{errors:[],direction:[]},recent_median:{errors:[],direction:[]}};
  for(let i=80;i<delta.length;i++){
   const train=delta.slice(Math.max(0,i-130),i);
   const wd=train.filter(x=>x.weekday===delta[i].weekday).map(x=>x.change);
   const forecasts={zero:0,weekday_median:med(wd.length>=8?wd:train.map(x=>x.change)),recent_median:med(train.map(x=>x.change))};
   for(const [key,pred] of Object.entries(forecasts)){
    if(pred===null)continue;
    metrics[key].errors.push(delta[i].change-pred);
    metrics[key].direction.push(Math.sign(pred)===Math.sign(delta[i].change)?1:0);
   }
  }
  const models=Object.fromEntries(Object.entries(metrics).map(([name,m])=>[name,{samples:m.errors.length,mae_usd_billions:+(m.errors.reduce((s,e)=>s+Math.abs(e),0)/m.errors.length/1000).toFixed(3),rmse_usd_billions:+Math.sqrt(m.errors.reduce((s,e)=>s+e*e,0)/m.errors.length).toFixed(3),direction_accuracy_pct:+(m.direction.reduce((s,v)=>s+v,0)/m.direction.length*100).toFixed(1)}]));
  const improvement=+(100*(1-models.weekday_median.mae_usd_billions/models.zero.mae_usd_billions)).toFixed(1);
  res.status(200).json({status:'historical_baseline_comparison_not_vintage_backtest',period:{from:delta[80]?.date,to:delta.at(-1)?.date},models,weekday_mae_improvement_vs_no_change_pct:improvement,interpretation:improvement>0?'Weekday median improves MAE versus no-change baseline in this sample':'Weekday median does not improve MAE versus no-change baseline in this sample',source:URL,limitations:['Historical revised dataset, not publication-time archived vintages','Only D+1 observed-report-day changes, not D+3/D+5','No Treasury net cash or tax and spending factors yet','No gold trades, fees, leverage, or win-rate analysis']});
 }catch(e){res.status(502).json({error:String(e)})}
};