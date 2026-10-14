// D+1/D+3/D+5 walk-forward historical TGA baseline validation.
// Observation-index horizons are trading-report dates, not calendar days.
// Strictly excludes the target observations from each origin's training window.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function median(a){if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const response=await fetch(BASE+'?'+p,{signal:AbortSignal.timeout(22000),headers:{accept:'application/json'}});
  if(!response.ok)throw Error('DTS HTTP '+response.status);
  const body=await response.json(),m=new Map();
  for(const r of body.data||[]){
   if(String(r.table_nbr||'').trim().toUpperCase()!=='I'||String(r.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance|财政部一般账户.*期末余额/i.test(String(r.account_type||'')))continue;
   const raw=r.open_today_bal??r.open_month_bal;
   if(raw==null||raw==='')continue;
   const n=Number(raw);
   if(Number.isFinite(n)&&n>0&&!m.has(r.record_date))m.set(r.record_date,n);
  }
  const rows=[...m].sort((a,b)=>a[0].localeCompare(b[0]));
  if(rows.length<120)throw Error('Insufficient history: '+rows.length);
  const d=rows.map((r,i)=>({date:r[0],balance:r[1],weekday:new Date(r[0]+'T12:00:00Z').getUTCDay(),delta:i? r[1]-rows[i-1][1]:null}));
  const horizons=[1,3,5],results={};
  for(const h of horizons){
   const errors={no_change:[],weekday_median:[],recent_median:[]},direction={no_change:[],weekday_median:[],recent_median:[]};
   let from=null,to=null;
   for(let i=90;i+h<d.length;i++){
    const training=d.slice(Math.max(1,i-130),i+1);
    if(training.length<60)continue;
    const global=median(training.map(x=>x.delta).filter(Number.isFinite));
    let cum=0;
    for(let k=1;k<=h;k++){
     const wd=d[i+k].weekday;
     const sample=training.filter(x=>x.weekday===wd).map(x=>x.delta).filter(Number.isFinite);
     cum+=median(sample.length>=8?sample:training.map(x=>x.delta).filter(Number.isFinite));
    }
    const actual=d[i+h].balance-d[i].balance;
    const predicted={no_change:0,weekday_median:cum,recent_median:h*global};
    for(const [name,value] of Object.entries(predicted)){
     errors[name].push(actual-value);
     // zero prediction is abstention, not a correct direction call
     if(value!==0&&actual!==0)direction[name].push(Math.sign(value)===Math.sign(actual)?1:0);
    }
    from??=d[i].date;to=d[i].date;
   }
   const models=Object.fromEntries(Object.entries(errors).map(([name,e])=>{const n=e.length;return [name,{samples:n,mae_usd_billions:n?+(e.reduce((s,x)=>s+Math.abs(x),0)/n/1000).toFixed(3):null,rmse_usd_billions:n?+(Math.sqrt(e.reduce((s,x)=>s+x*x,0)/n)/1000).toFixed(3):null,direction_accuracy_pct:direction[name].length?+(direction[name].reduce((s,x)=>s+x,0)/direction[name].length*100).toFixed(1):null,direction_evaluated:direction[name].length}]}));
   const base=errors.no_change,week=errors.weekday_median;
   const improvements=base.map((e,i)=>Math.abs(e)-Math.abs(week[i]));
   const mean=improvements.reduce((a,b)=>a+b,0)/improvements.length;
   const variance=improvements.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,improvements.length-1);
   const standardError=Math.sqrt(variance/improvements.length);
   const z=standardError?mean/standardError:null;
   const improves=mean>0;
   results['D+'+h]={origin_first:from,origin_last:to,models,weekday_vs_no_change:{mae_improvement_pct:+(100*mean/(base.reduce((s,x)=>s+Math.abs(x),0)/base.length)).toFixed(2),paired_mean_absolute_error_improvement_usd_billions:+(mean/1000).toFixed(3),naive_z_score:z===null?null:+z.toFixed(2),statistical_warning:'Overlapping horizons and serial correlation invalidate naive independent-sample z-score for h>1; use block bootstrap or HAC before significance claims',passes_directional_mae_gate:improves}};
  }
  res.status(200).json({status:'historical_walk_forward_baselines_only',as_of:rows.at(-1)[0],observations:rows.length,results,source:BASE,limitations:['Historical current-version DTS observations are not publication-time vintages','Horizon is next observed DTS business/report dates; holidays are handled by observed dates','Not a net-financing or tax-adjusted forecast','Not a gold price backtest, no A/A+/A++ signals','Potential DTS revisions and time-of-publication are not modeled']});
 }catch(e){res.status(502).json({error:String(e)})}
};