// Research-only gold proxy trading backtest. Fiscal report signal is assumed available
// after publication; execution deliberately delayed to the second subsequent GC=F session open.
// This is NOT a verified release-time execution backtest.
const median=a=>{if(!a.length)return null;const x=a.slice().sort((a,b)=>a-b),n=x.length;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2};
const wd=s=>new Date(s+'T12:00:00Z').getUTCDay();
async function fiscal(y){
 const p=new URLSearchParams({filter:'record_date:gte:'+y+'-01-01,record_date:lte:'+y+'-12-31,table_nbr:eq:I,src_line_nbr:eq:4',sort:'record_date','page[size]':'10000'});
 const r=await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?'+p,{signal:AbortSignal.timeout(22000)});
 if(!r.ok)throw Error('Fiscal '+y+' HTTP '+r.status);
 const j=await r.json(),rows=j.data||[];if(Number(j.meta?.total_count)>rows.length)throw Error('Fiscal rows truncated');
 const m=new Map();
 for(const x of rows){if(String(x.table_nbr).toUpperCase()!=='I'||String(x.src_line_nbr)!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type)))continue;const v=Number(x.open_today_bal??x.close_today_bal);if(v>0&&Number.isFinite(v))m.set(x.record_date,v)}
 if(m.size<100)throw Error('Fiscal '+y+' coverage incomplete '+m.size);
 return [...m].map(([date,balance])=>({date,balance}));
}
async function gold(){
 const start=Math.floor(Date.UTC(2023,0,1)/1000),end=Math.floor(Date.now()/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?period1='+start+'&period2='+end+'&interval=1d';
 const r=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error('Gold HTTP '+r.status);
 const z=(await r.json()).chart?.result?.[0];if(!z)throw Error('Gold chart missing');
 const q=z.indicators?.quote?.[0],out=[];
 for(let i=0;i<z.timestamp.length;i++){const date=new Date(z.timestamp[i]*1000).toISOString().slice(0,10),open=q.open?.[i],close=q.close?.[i];if(open>0&&close>0&&Number.isFinite(open)&&Number.isFinite(close))out.push({date,open,close})}
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 try{
  const [fy23,fy24,fy25,fy26,bars]=await Promise.all([fiscal(2023),fiscal(2024),fiscal(2025),fiscal(2026),gold()]);
  const f=[...fy23,...fy24,...fy25,...fy26].sort((a,b)=>a.date.localeCompare(b.date));
  const rows=f.map((x,i)=>({...x,delta:i?x.balance-f[i-1].balance:null,wd:wd(x.date)}));
  const positions=[];
  for(let i=150;i<rows.length-3;i++){
   const train=rows.slice(Math.max(1,i-500),i+1),hist=train.map(x=>x.delta).filter(Number.isFinite);
   const date=new Date(rows[i].date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);
   while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1);
   const target=date.toISOString().slice(0,10);
   const same=train.filter(x=>x.wd===wd(target)).map(x=>x.delta).filter(Number.isFinite);
   const predicted=median(same.length>=8?same:hist);
   if(!Number.isFinite(predicted)||Math.abs(predicted)<5000)continue; // $5bn TGA threshold, values in millions
   // Two sessions after signal date: avoid assuming fiscal publication time.
   const later=bars.filter(x=>x.date>rows[i].date);
   if(later.length<4)continue;
   const entry=later[1],exit=later[3],side=predicted<0?1:-1;
   // conservative proxy roundtrip cost: 10 bps; no leverage.
   const gross=side*(exit.open/entry.open-1),net=gross-.001;
   positions.push({signal_date:rows[i].date,entry_date:entry.date,exit_date:exit.date,side,forecast_tga_delta_usd_billions:+(predicted/1000).toFixed(2),gross_return_pct:+(gross*100).toFixed(3),net_return_pct:+(net*100).toFixed(3),net});
  }
  const summarize=x=>({trades:x.length,win_rate_pct:x.length?+(100*x.filter(t=>t.net>0).length/x.length).toFixed(1):null,average_net_return_pct:x.length?+(100*x.reduce((s,t)=>s+t.net,0)/x.length).toFixed(3):null});
  const years=Object.fromEntries([2023,2024,2025,2026].map(y=>[y,summarize(positions.filter(x=>x.signal_date.startsWith(String(y))))]));
  res.status(200).json({status:'exploratory_gold_proxy_signal_test_not_trade_ready',model:'weekday median TGA change, threshold $5bn',gold_proxy:'Yahoo GC=F continuous gold futures',execution:'second subsequent futures daily open; exit two sessions later',assumed_roundtrip_cost_bps:10,overall:summarize(positions),by_year:years,recent_trades:positions.slice(-8).map(({net,...rest})=>rest),limitations:['Exploratory hypothesis only; threshold and horizon are not independently pre-registered','GC=F continuous contract is not an executable unadjusted futures series; roll and spread unmodeled','Yahoo daily session timestamps and Treasury release-time alignment not verified','Overlapping signals counted as separate trades; not a portfolio equity curve','No stop loss, funding, margin, slippage model beyond assumed 10bp cost','No genuine 2026 untouched holdout due to prior model iteration','No claim of live trade readiness']});
 }catch(e){res.status(502).json({status:'gold_proxy_backtest_blocked',error:String(e),no_invented_results:true})}
};
