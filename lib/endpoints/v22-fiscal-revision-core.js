// Same-future-target Treasury forecast REVISION proxy, never a completed V2.2 signal.
// Each current and previous forecast sums exactly the SAME remaining future settlement dates.
// Past 252 strictly earlier decision revisions form rolling Z-score baseline; no future outcomes.
const DAY=86400000;
const dayMs=x=>Date.parse(x+'T00:00:00Z');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const sd=a=>{if(a.length<2)return null;const u=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-u)**2,0)/(a.length-1))};
function revision(paths,opts={}){
 const minPrior=opts.min_prior_revisions??60,rolling=opts.rolling_prior_decisions??252;
 if(!Number.isInteger(minPrior)||minPrior<20||!Number.isInteger(rolling)||rolling<minPrior)throw Error('Invalid point-in-time historical revision window');
 const sorted=(paths||[]).slice().sort((a,b)=>a.decision_date.localeCompare(b.decision_date)),byYear={2025:{revision_days:0,usable_z_days:0},2026:{revision_days:0,usable_z_days:0}};
 const output=[],histAuction=[],histFallback=[];
 const sameRange=(path,start,target,key)=>{
  const rows=path.cashflow_target_predictions.filter(x=>x.target_date>start&&x.target_date<=target);
  const total=rows.reduce((s,x)=>s+x[key],0);
  return rows.length&&rows.every(x=>Number.isFinite(x[key]))?total:null;
 };
 for(let i=1;i<sorted.length;i++){
  const cur=sorted[i],before=sorted[i-1],target=cur.cashflow_target_predictions.find(x=>x.horizon_business_days===3)?.target_date;
  if(!target||!cur.no_earlier_than_utc||!before.no_earlier_than_utc)continue;
  if(!(before.no_earlier_than_utc<cur.no_earlier_than_utc)||dayMs(cur.decision_date)-dayMs(before.decision_date)>6*DAY)continue;
  const curKnown=sameRange(cur,cur.decision_date,target,'forecast_day_change_auction_tax_usd_millions');
  const oldKnown=sameRange(before,cur.decision_date,target,'forecast_day_change_auction_tax_usd_millions');
  const curFallback=sameRange(cur,cur.decision_date,target,'forecast_day_change_issuance_fallback_tax_usd_millions');
  const oldFallback=sameRange(before,cur.decision_date,target,'forecast_day_change_issuance_fallback_tax_usd_millions');
  // Previous decision path must contain all 3 remaining settlement days (do not invent events).
  const curDays=cur.cashflow_target_predictions.filter(x=>x.target_date>cur.decision_date&&x.target_date<=target).length;
  const oldDays=before.cashflow_target_predictions.filter(x=>x.target_date>cur.decision_date&&x.target_date<=target).length;
  if(curDays!==3||oldDays!==3||curKnown===null||oldKnown===null)continue;
  const changeKnown=curKnown-oldKnown,changeFallback=curFallback===null||oldFallback===null?null:curFallback-oldFallback;
  const prevKnown=histAuction.slice(-rolling).map(x=>x.value),prevFallback=histFallback.slice(-rolling).map(x=>x.value);
  const knownSD=prevKnown.length>=minPrior?sd(prevKnown):null,fallbackSD=prevFallback.length>=minPrior?sd(prevFallback):null;
  const zKnown=knownSD>0?(changeKnown-mean(prevKnown))/knownSD:null;
  const zFallback=changeFallback!==null&&fallbackSD>0?(changeFallback-mean(prevFallback))/fallbackSD:null;
  const year=Number(cur.decision_date.slice(0,4));if(byYear[year]){byYear[year].revision_days++;if(Number.isFinite(zKnown))byYear[year].usable_z_days++}
  output.push({decision_date:cur.decision_date,no_earlier_than_utc:cur.no_earlier_than_utc,comparison_target_date:target,
   prior_decision_date:before.decision_date,
   same_target_revised_D3_remaining_known_auction_usd_millions:changeKnown,
   same_target_revised_D3_remaining_bill_issuance_fallback_usd_millions:changeFallback,
   rolling_prior_revision_days:prevKnown.length,
   fiscal_revision_z_research_proxy_known_auction:zKnown,
   fiscal_revision_z_research_proxy_fallback:zFallback,
   full_TGA_forecast_revision_vintage_verified:false,
   grade_A_Aplus_Aplusplus_verified:false});
  histAuction.push({decision_date:cur.decision_date,value:changeKnown});
  if(changeFallback!==null)histFallback.push({decision_date:cur.decision_date,value:changeFallback});
 }
 const zReady=output.filter(x=>Number.isFinite(x.fiscal_revision_z_research_proxy_known_auction));
 const threshold=t=>zReady.filter(x=>Math.abs(x.fiscal_revision_z_research_proxy_known_auction)>=t).length;
 return {status:'unverified_tga_revision_z_proxy_no_gold_trades',settings:{rolling_prior_decisions:rolling,min_prior_revisions:minPrior,
  comparison:'revision of future cashflow on SAME 3 remaining business days in current vs prior decision forecast'},
  revision_days:output.length,rolling_z_valid_days:zReady.length,
  research_proxy_abs_z_counts:{gte_0_75:threshold(.75),gte_1_00:threshold(1),gte_1_50:threshold(1.5)},
  by_year:byYear,recent_research_revisions:output.slice(-8),records:opts.return_records===true?output:undefined,
  official_v22_A_Aplus_Aplusplus_signals:0,complete_point_in_time_source_vintage:false,trade_signals_enabled:false,
  limitations:['This is a same-target forecast-revision STATISTICAL PROXY, not certified historical Treasury public release vintages','A/A+/A++ categorization cannot be finalized without full real-time Treasury, tax schedule, Fed and gold factor evidence','252 prior decisions, not 252 independent model vintage archives; one revision per eligible decision date','No gold trade profitability or execution is tested']};
}
module.exports={revision};
