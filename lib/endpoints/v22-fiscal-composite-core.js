// Frozen 2024+ walk-forward experiment: announced Treasury Bills + seasonal cashflow residual.
// It is a nontradable partial TGA prediction test, never a full V2.2 gold trading signal.
const {buildAnnouncedFutureLedger}=require('./v22-auction-core');
const DAY=86400000,dateMs=s=>Date.parse(s+'T12:00:00Z'),iso=n=>new Date(n).toISOString().slice(0,10);
const nextWeekday=s=>{let n=dateMs(s);do{n+=DAY}while([0,6].includes(new Date(n).getUTCDay()));return iso(n)};
const wd=s=>new Date(dateMs(s)).getUTCDay();
const med=arr=>{if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
const meanAbs=(r,key)=>r.length?+(r.reduce((s,x)=>s+Math.abs(x.actual-x[key]),0)/r.length/1000).toFixed(3):null;
const score=a=>{
 const mae=(key)=>meanAbs(a,key);
 const error=a.map(x=>Math.abs(x.actual-x.auction_residual)/1000).sort((x,y)=>x-y);
 const pct=p=>error.length?+(error[Math.min(error.length-1,Math.floor((error.length-1)*p))]).toFixed(3):null;
 return {samples:a.length,mae_zero_usd_billions:mae('zero'),mae_total_weekday_usd_billions:mae('weekday'),
  mae_auction_plus_residual_usd_billions:mae('auction_residual'),mae_auction_plus_split_cash_usd_billions:mae('auction_split_cash'),
  mae_without_known_maturity_usd_billions:mae('without_maturity'),mae_without_known_issue_usd_billions:mae('without_issue'),
  median_absolute_actual_change_usd_billions:a.length?+(med(a.map(x=>Math.abs(x.actual)))/1000).toFixed(3):null,
  predicted_auction_absolute_issue_total_usd_billions:+(a.reduce((s,x)=>s+Math.abs(x.cumulative_known_issue),0)/1000).toFixed(1),
  predicted_auction_absolute_maturity_total_usd_billions:+(a.reduce((s,x)=>s+Math.abs(x.cumulative_known_maturity),0)/1000).toFixed(1),
  auction_plus_residual_error_p50_usd_billions:pct(.5),auction_plus_residual_error_p90_usd_billions:pct(.9),
  auction_plus_residual_error_p99_usd_billions:pct(.99),
  samples_with_error_over_100_billion_usd:error.filter(x=>x>100).length};
};
function evaluate(tgaDays,cashDays,auctionEvents,fromYear=2025){
 const balance=new Map(tgaDays.map(x=>[x.date,x.balance])),cash=new Map(cashDays.map(x=>[x.date,x]));
 const actualHistory=[];
 for(let i=1;i<tgaDays.length;i++){
  const prev=tgaDays[i-1],curr=tgaDays[i];
  if(nextWeekday(prev.date)!==curr.date)continue;
  const cashData=cash.get(curr.date);if(!cashData)continue;
  const known=buildAnnouncedFutureLedger(auctionEvents,prev.date,curr.date,1,2).bill_offering_minus_known_maturities_usd/1e6;
  const actual=curr.balance-prev.balance,nondebt=cashData.nondebt_net;
  actualHistory.push({target:curr.date,prev_date:prev.date,actual,known_bill:known,nondebt,other_finance_residual:actual-known-nondebt,total_residual:actual-known,wd:wd(curr.date)});
 }
 const scored={1:[],3:[],5:[]};
 for(const asofData of tgaDays){
  const asof=asofData.date;
  if(Number(asof.slice(0,4))<fromYear||asof>=tgaDays.at(-1).date)continue;
  const cutoff=iso(dateMs(asof)-3*DAY);
  const past=actualHistory.filter(x=>x.target<=cutoff).slice(-500);
  if(past.length<120)continue;
  let target=asof,cumulative={actual:0,weekday:0,auction_residual:0,auction_split_cash:0,without_maturity:0,without_issue:0,known_issue:0,known_maturity:0,zero:0},canScore=true;
  for(let h=1;h<=5;h++){
   target=nextWeekday(target);
   const before=h===1?asof:nextWeekdayBack(target);
   if(!balance.has(target)||!balance.has(before))canScore=false;
   if(!canScore)continue;
   cumulative.actual=balance.get(target)-asofData.balance;
   const w=wd(target);
   const same=past.filter(x=>x.wd===w),training=same.length>=12?same:past;
   const totalMid=med(training.map(x=>x.actual)),residualMid=med(training.map(x=>x.total_residual));
   const nondebtMid=med(training.map(x=>x.nondebt)),otherFinMid=med(training.map(x=>x.other_finance_residual));
   if(![totalMid,residualMid,nondebtMid,otherFinMid].every(Number.isFinite)){canScore=false;continue}
   const funding=buildAnnouncedFutureLedger(auctionEvents,asof,target,1,2),known=funding.bill_offering_minus_known_maturities_usd/1e6;
   const issuance=funding.by_type.Bill.published_upcoming_offering_usd/1e6,maturity=funding.by_type.Bill.previously_issued_maturing_awards_usd/1e6;
   cumulative.known_issue+=issuance;cumulative.known_maturity+=maturity;
   cumulative.weekday+=totalMid;cumulative.auction_residual+=known+residualMid;
   cumulative.without_maturity+=issuance+residualMid;
   cumulative.without_issue+=-maturity+residualMid;
   cumulative.auction_split_cash+=known+nondebtMid+otherFinMid;
   if([1,3,5].includes(h))scored[h].push({asof,target,actual:cumulative.actual,zero:0,weekday:cumulative.weekday,auction_residual:cumulative.auction_residual,auction_split_cash:cumulative.auction_split_cash,without_maturity:cumulative.without_maturity,without_issue:cumulative.without_issue,cumulative_known_issue:cumulative.known_issue,cumulative_known_maturity:cumulative.known_maturity});
  }
 }
 return {history_samples:actualHistory.length,scored:Object.fromEntries([1,3,5].map(h=>['D+'+h,{overall:score(scored[h]),
  by_year:Object.fromEntries([2025,2026].map(y=>[y,score(scored[h].filter(x=>x.asof.startsWith(String(y))))])),
  worst_five_auction_plus_residual_errors:scored[h].map(x=>({...x,absolute_error:Math.abs(x.actual-x.auction_residual)})).sort((a,b)=>b.absolute_error-a.absolute_error).slice(0,5).map(x=>({
   asof:x.asof,target:x.target,actual_tga_change_usd_billions:+(x.actual/1000).toFixed(3),
   predicted_tga_change_usd_billions:+(x.auction_residual/1000).toFixed(3),
   forecast_error_usd_billions:+((x.auction_residual-x.actual)/1000).toFixed(3),
   published_issue_component_usd_billions:+(x.cumulative_known_issue/1000).toFixed(3),
   historical_maturity_component_usd_billions:+(x.cumulative_known_maturity/1000).toFixed(3),
   residual_seasonality_component_usd_billions:+((x.auction_residual-x.cumulative_known_issue+x.cumulative_known_maturity)/1000).toFixed(3)
  }))}]))};
}
function nextWeekdayBack(s){let n=dateMs(s);do{n-=DAY}while([0,6].includes(new Date(n).getUTCDay()));return iso(n)}
module.exports={evaluate,nextWeekday};
