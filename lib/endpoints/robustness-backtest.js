// Robust paired error evaluation: calendar/weekday versus zero-change.
// Fixed model rules, chronological 75/25 holdout, moving-block bootstrap.
// Indicative historical data only: NOT archived publication-time vintages.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function median(a){if(!a.length)return null;const x=a.slice().sort((a,b)=>a-b),n=x.length;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2}
function pct(a,p){const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor((s.length-1)*p)))]}
function bootstrap(diffs,block=10,reps=400){const n=diffs.length;if(n<25)return null;let seed=1729;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}const means=[];for(let b=0;b<reps;b++){let sum=0,count=0;while(count<n){const start=Math.floor(rand()*n);for(let k=0;k<block&&count<n;k++){sum+=diffs[(start+k)%n];count++}}means.push(sum/n)}return {lower_usd_billions:+(pct(means,.025)/1000).toFixed(3),upper_usd_billions:+(pct(means,.975)/1000).toFixed(3),block_size:block,replications:reps}}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'}),r=await fetch(URL+'?'+p,{signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw Error('DTS HTTP '+r.status);
  const raw=await r.json(),map=new Map();
  for(const x of raw.data||[]){
   if(String(x.table_nbr||'').trim().toUpperCase()!=='I'||String(x.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')))continue;
   const v=x.open_today_bal??x.close_today_bal;if(v==null||v==='')continue;
   const n=Number(v);if(Number.isFinite(n)&&n>0&&!map.has(x.record_date))map.set(x.record_date,n);
  }
  const a=[...map].sort((x,y)=>x[0].localeCompare(y[0]));
  if(a.length<350)throw Error('Need >=350 observations; got '+a.length);
  const d=a.map(([date,balance],i)=>({date,balance,delta:i?balance-a[i-1][1]:null,weekday:new Date(date+'T12:00:00Z').getUTCDay(),dom:Number(date.slice(8))}));
  const split=Math.floor(d.length*.75),results={};
  for(const h of [1,3,5]){
   const evals=[];
   for(let i=150;i+h<d.length;i++){
    const hist=d.slice(Math.max(1,i-500),i+1),all=hist.map(x=>x.delta).filter(Number.isFinite),global=median(all);
    let weekday=0,calendar=0;
    for(let k=1;k<=h;k++){
     const t=d[i+k],w=hist.filter(x=>x.weekday===t.weekday).map(x=>x.delta).filter(Number.isFinite);
     const wv=median(w.length>=8?w:all);
     const dom=hist.filter(x=>Math.abs(x.dom-t.dom)<=1).map(x=>x.delta).filter(Number.isFinite);
     const weight=dom.length>=12?Math.min(.5,dom.length/(dom.length+60)):0;
     weekday+=wv;calendar+=(1-weight)*wv+weight*(dom.length>=12?median(dom):global);
    }
    evals.push({origin:i,actual:d[i+h].balance-d[i].balance,weekday,calendar});
   }
   function mae(rows,model){return rows.reduce((s,x)=>s+Math.abs(x.actual-(model==='zero'?0:x[model])),0)/rows.length}
   const train=evals.filter(x=>x.origin<split),test=evals.filter(x=>x.origin>=split);
   const chosen=mae(train,'calendar')<mae(train,'weekday')?'calendar':'weekday';
   const differences=test.map(x=>Math.abs(x.actual)-Math.abs(x.actual-x[chosen]));
   const mean=differences.reduce((s,x)=>s+x,0)/differences.length;
   const interval=bootstrap(differences,Math.max(5,h*2),500);
   results['D+'+h]={selected_on_train:chosen,train_count:train.length,holdout_count:test.length,holdout_from:d[split].date,holdout_to:d.at(-1-h).date,baseline_mae_usd_billions:+(mae(test,'zero')/1000).toFixed(3),selected_mae_usd_billions:+(mae(test,chosen)/1000).toFixed(3),mae_improvement_pct:+(100*mean/mae(test,'zero')).toFixed(2),paired_improvement_95pct_moving_block_interval:interval,robust_improvement_supported:interval!==null&&interval.lower_usd_billions>0};
  }
  res.status(200).json({status:'research_robustness_test_only',as_of:d.at(-1).date,observations:d.length,split:'chronological 75% train / 25% holdout',results,limitations:['Moving-block bootstrap is approximate and conditional on selected model','Historical DTS series may contain revisions; no point-in-time vintages','Overlapping horizon forecasts create serial dependence; blocks are used to partially account for it','No gold execution, leverage, spreads, or trading win rate']});
 }catch(e){res.status(502).json({error:String(e)})}
};