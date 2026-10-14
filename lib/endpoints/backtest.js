// Walk-forward evaluation of a simple TGA weekday-median baseline.
// Recomputes every prediction using only observations before the target date.
// This is an indicative baseline, not a historical vintage or trade backtest.
const BASE='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance';
function median(xs){if(!xs.length)return null;const a=xs.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=3600');
 try{
  const p=new URLSearchParams({sort:'-record_date','page[size]':'10000'});
  const response=await fetch(BASE+'?'+p,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('DTS HTTP '+response.status);
  const body=await response.json(),m=new Map();
  for(const r of body.data||[]){
   if(String(r.table_nbr||'').trim().toUpperCase()!=='I'||String(r.src_line_nbr||'').trim()!=='4'||!/Treasury General Account.*Closing Balance|财政部一般账户.*期末余额/i.test(String(r.account_type||'')))continue;
   const raw=r.open_today_bal??r.open_month_bal;
   if(raw===null||raw===undefined||raw==='')continue;
   const v=Number(raw);if(Number.isFinite(v)&&v>0&&!m.has(r.record_date))m.set(r.record_date,v);
  }
  const rows=[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const changes=[];for(let i=1;i<rows.length;i++){const gap=(Date.parse(rows[i][0])-Date.parse(rows[i-1][0]))/86400000;if(gap>5)continue;changes.push({date:rows[i][0],weekday:new Date(rows[i][0]+'T12:00:00Z').getUTCDay(),delta:rows[i][1]-rows[i-1][1]})}
  const evaluated=[];
  for(let i=60;i<changes.length;i++){
   const train=changes.slice(Math.max(0,i-130),i);
   const weekday=train.filter(x=>x.weekday===changes[i].weekday).map(x=>x.delta);
   const predicted=median(weekday.length>=8?weekday:train.map(x=>x.delta));
   if(predicted===null)continue;
   evaluated.push({date:changes[i].date,predicted,actual:changes[i].delta,error:changes[i].delta-predicted});
  }
  if(evaluated.length<20)throw Error('Insufficient walk-forward evaluation samples: '+evaluated.length);
  const mae=evaluated.reduce((s,x)=>s+Math.abs(x.error),0)/evaluated.length;
  const rmse=Math.sqrt(evaluated.reduce((s,x)=>s+x.error*x.error,0)/evaluated.length);
  const dir=evaluated.filter(x=>Math.sign(x.predicted)===Math.sign(x.actual)).length/evaluated.length;
  res.status(200).json({status:'indicative_walk_forward_not_vintage_backtest',samples:evaluated.length,first_evaluation_date:evaluated[0].date,last_evaluation_date:evaluated[evaluated.length-1].date,mae_usd_billions:+(mae/1000).toFixed(3),rmse_usd_billions:+(rmse/1000).toFixed(3),direction_accuracy:+(dir*100).toFixed(1),evaluation:'One-day-ahead realized DTS daily changes, expanding walk-forward with trailing max 130 changes; each prediction uses only earlier dated observations.',limitations:['Historical source may be revised: not archived publication-time vintages','Not a D+3 or D+5 backtest','No Treasury settlement, holidays or tax events','Direction accuracy is not a gold trading win rate','No transaction costs, gold price or signal execution tested']});
 }catch(e){res.status(502).json({error:String(e)})}
};