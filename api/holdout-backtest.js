// Chronological holdout decision gate. No training or selection on the test period.
// Uses the historical daily TGA baseline models as research diagnostics only.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function median(a){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y),i=b.length>>1;return b.length%2?b[i]:(b[i-1]+b[i])/2}
function metrics(rows){const n=rows.length;if(!n)return null;const mae=rows.reduce((s,x)=>s+Math.abs(x.error),0)/n;const rmse=Math.sqrt(rows.reduce((s,x)=>s+x.error*x.error,0)/n);const eligible=rows.filter(x=>x.pred!==0&&x.actual!==0);return {samples:n,mae_usd_billions:+(mae/1000).toFixed(3),rmse_usd_billions:+(rmse/1000).toFixed(3),direction_accuracy_pct:eligible.length?+(100*eligible.filter(x=>Math.sign(x.pred)===Math.sign(x.actual)).length/eligible.length).toFixed(1):null,direction_evaluated:eligible.length}}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'}),r=await fetch(BASE+'?'+p,{signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const body=await r.json(),map=new Map();
  for(const x of body.data||[]){
   if(String(x.table_nbr||'').trim().toUpperCase()!=='I'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')))continue;
   const raw=x.open_today_bal??x.close_today_bal;
   if(raw==null||raw==='')continue;const n=Number(raw);
   if(Number.isFinite(n)&&n>0&&!map.has(x.record_date))map.set(x.record_date,n);
  }
  const data=[...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,balance],i,arr)=>({date,balance,weekday:new Date(date+'T12:00:00Z').getUTCDay(),dom:+date.slice(8),delta:i?balance-arr[i-1][1]:null}));
  if(data.length<350)throw Error('Insufficient data: '+data.length);
  const split=Math.floor(data.length*.75),results={};
  for(const horizon of [1,3,5]){
   const rows={zero:[],weekday:[],calendar:[]};
   for(let i=150;i+horizon<data.length;i++){
    const history=data.slice(Math.max(1,i-500),i+1),global=median(history.map(x=>x.delta).filter(Number.isFinite));
    let weekday=0,calendar=0;
    for(let k=1;k<=horizon;k++){
     const t=data[i+k],same=history.filter(x=>x.weekday===t.weekday).map(x=>x.delta).filter(Number.isFinite);
     const base=median(same.length>=8?same:history.map(x=>x.delta).filter(Number.isFinite));
     const dom=history.filter(x=>Math.abs(x.dom-t.dom)<=1).map(x=>x.delta).filter(Number.isFinite);
     const weight=dom.length>=12?Math.min(.5,dom.length/(dom.length+60)):0;
     weekday+=base;calendar+=(1-weight)*base+weight*(dom.length>=12?median(dom):global);
    }
    const actual=data[i+horizon].balance-data[i].balance;
    for(const [model,pred] of Object.entries({zero:0,weekday,calendar}))rows[model].push({origin:i,actual,pred,error:actual-pred});
   }
   const train=Object.fromEntries(Object.entries(rows).map(([name,r])=>[name,metrics(r.filter(x=>x.origin<split))]));
   const test=Object.fromEntries(Object.entries(rows).map(([name,r])=>[name,metrics(r.filter(x=>x.origin>=split))]));
   const candidate=['weekday','calendar'].sort((a,b)=>train[a].mae_usd_billions-train[b].mae_usd_billions)[0];
   const baseline=test.zero.mae_usd_billions,chosen=test[candidate].mae_usd_billions;
   results['D+'+horizon]={train_period:{through:data[split-1].date},holdout_period:{from:data[split].date,through:data.at(-1-horizon).date},train,test,selected_on_training_only:candidate,holdout_mae_improvement_vs_no_change_pct:+(100*(baseline-chosen)/baseline).toFixed(2),passes_holdout_mae_gate:chosen<baseline};
  }
  res.status(200).json({status:'research_holdout_not_trade_ready',observations:data.length,split:'chronological 75% training / 25% holdout',results,source:BASE,limitations:['Historic source is not publication-time vintage','Calendar heuristic uses future target dates but not future cash values; date known in advance','No bond settlement information, taxes or gold','Holdout is only a preliminary robustness check, not independent strategy validation']});
 }catch(e){res.status(502).json({error:String(e)})}
};