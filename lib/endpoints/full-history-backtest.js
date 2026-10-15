// Historical 2023-present TGA backtest with yearly source partitioning.
// No invented results: fail closed if any year is missing or truncated.
const ROOT='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
const isoWeekday=s=>new Date(s+'T12:00:00Z').getUTCDay();
async function yearData(year){
 const p=new URLSearchParams({filter:'record_date:gte:'+year+'-01-01,record_date:lte:'+year+'-12-31,table_nbr:eq:I,src_line_nbr:eq:4',sort:'record_date','page[size]':'10000'});
 const r=await fetch(ROOT+'?'+p,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(year+' FiscalData HTTP '+r.status);
 const j=await r.json(),rows=j.data||[],total=Number(j.meta?.total_count??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error(year+' filtered TGA response truncated: '+rows.length+'/'+total);
 const map=new Map();
 for(const x of rows){
  if(String(x.table_nbr||'').trim().toUpperCase()!=='I'||String(x.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||'')))continue;
  const raw=x.open_today_bal??x.close_today_bal,v=Number(raw);
  if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(v)&&v>0)map.set(x.record_date,v);
 }
 if(map.size<30){const sample=rows.slice(0,4).map(x=>({date:x.record_date,table:x.table_nbr,line:x.src_line_nbr,account:x.account_type,fields:Object.keys(x)}));throw Error(year+' missing TGA data: '+map.size+'; received='+rows.length+'; total='+total+'; sample='+JSON.stringify(sample));}
 return [...map].map(([date,balance])=>({date,balance}));
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=7200, stale-while-revalidate=7200');
 try{
  const requestedYear=Number(req.query?.year);if(Number.isInteger(requestedYear)&&requestedYear>=2023&&requestedYear<=new Date().getUTCFullYear()){const rows=await yearData(requestedYear);return res.status(200).json({status:'year_source_ok',year:requestedYear,observations:rows.length,first_date:rows[0]?.date,last_date:rows.at(-1)?.date});}
  const years=Array.from({length:new Date().getUTCFullYear()-2022},(_,i)=>2023+i);
  const all=[];for(const year of years){const rows=await yearData(year);all.push(...rows)}all.sort((a,b)=>a.date.localeCompare(b.date));
  const unique=[...new Map(all.map(x=>[x.date,x])).values()],d=unique.map((x,i)=>({...x,wd:isoWeekday(x.date),dom:+x.date.slice(8),delta:i?x.balance-unique[i-1].balance:null}));
  const results={},validation={};
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
    for(const [name,pred] of Object.entries({zero:0,weekday:wd,calendar:cal}))slot[name].push({error:actual-pred,actual,pred});
   }
   const score=arr=>({samples:arr.length,mae_usd_billions:+(arr.reduce((s,x)=>s+Math.abs(x.error),0)/arr.length/1000).toFixed(3),direction_accuracy_pct:+(100*arr.filter(x=>Math.sign(x.pred)===Math.sign(x.actual)).length/arr.length).toFixed(1),predicted_nonzero:arr.filter(x=>x.pred!==0).length});
   results['D+'+h]=Object.fromEntries(Object.entries(byYear).map(([year,models])=>[year,Object.fromEntries(Object.entries(models).map(([name,arr])=>[name,score(arr)]))]));
   const yearsInOrder=Object.keys(byYear).sort();
   const holdoutYear=yearsInOrder.includes('2026')?'2026':yearsInOrder.at(-1);
   const priorYears=yearsInOrder.filter(y=>y<holdoutYear);
   const prior=Object.fromEntries(['zero','weekday','calendar'].map(name=>[name,priorYears.flatMap(y=>byYear[y][name])]));
   const holdout=byYear[holdoutYear];
   const priorScores=Object.fromEntries(Object.entries(prior).map(([name,arr])=>[name,score(arr)]));
   const selected=Object.entries(priorScores).sort((a,b)=>a[1].mae_usd_billions-b[1].mae_usd_billions)[0][0];
   const testScores=Object.fromEntries(Object.entries(holdout).map(([name,arr])=>[name,score(arr)]));
   validation['D+'+h]={selection_based_on_years:priorYears,holdout_year:holdoutYear,selected_model:selected,training_mae_usd_billions:priorScores[selected].mae_usd_billions,holdout:testScores,selected_vs_zero_holdout_mae_improvement_pct:+(100*(testScores.zero.mae_usd_billions-testScores[selected].mae_usd_billions)/testScores.zero.mae_usd_billions).toFixed(1),holdout_passes_mae:testScores[selected].mae_usd_billions<testScores.zero.mae_usd_billions};

  }
  res.status(200).json({status:'historical_2023_plus_walk_forward_research',first_date:d[0].date,last_date:d.at(-1).date,observations:d.length,results,validation,limitations:['Current-version FiscalData is not archived point-in-time vintage','Future reporting-day calendar is taken from observed dataset and is not a point-in-time executable forecast; direction statistics are research-only','No explicit tax or Treasury auction settlement features','No gold trades, profits or win rates']});
 }catch(e){res.status(502).json({status:'historical_backtest_blocked',error:String(e),warning:'No partial results are presented as full 2023+ history'})}
};