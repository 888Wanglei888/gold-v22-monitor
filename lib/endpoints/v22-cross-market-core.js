// Non-trading cross-market coincidence check for price-only 4h candidates.
// The official V2.2 Treasury PRE-EVENT forecast and gold market release vintages remain separate blockers.
const {atOrBefore,dateMs,DAY}=require('./v22-asof-core');
const mandatory=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL','DXY','COT_NET','COT_OI','TGA','GLD_TONNES_DELTA'];
function snap(sources,id,at,maxAgeDays){
 const e=atOrBefore(sources[id]?.rows||[],at);
 if(!e||e.available_utc_ms>at||at-dateMs(e.date)>(maxAgeDays[id]??Infinity)*DAY)return null;
 return e;
}
function delta(sources,id,at,windowDays,maxAgeDays){
 const current=snap(sources,id,at,maxAgeDays),prior=snap(sources,id,at-windowDays*DAY,{...maxAgeDays,[id]:maxAgeDays[id]+windowDays});
 if(!current||!prior||prior.available_utc_ms>=current.available_utc_ms)return null;
 return current.value-prior.value;
}
function sumWindow(sources,id,at,windowDays){
 const history=sources[id]?.rows||[];
 const values=history.filter(x=>x.available_utc_ms>at-windowDays*DAY&&x.available_utc_ms<=at);
 return values.length?values.reduce((total,x)=>total+x.value,0):null;
}
function inspectPriceCandidates(candidates,sources,maxAgeDays){
 const totals={candidates:candidates.length,complete_asof_12_of_12:0,incomplete_asof:0,dxy_real_yield_and_gld_direction_aligned:0,
  dxy_and_real_yield_aligned:0,cftc_net_direction_aligned:0,not_sufficient_source_history_for_change:0};
 const byYear={2025:{candidates:0,complete_asof:0,triple_alignment:0},2026:{candidates:0,complete_asof:0,triple_alignment:0}};
 const recent=[];
 for(const cand of candidates){
  const time=Date.parse(cand.confirmation_closed_utc);
  if(!Number.isFinite(time))throw Error('Candidate confirmation time missing');
  const year=new Date(time).getUTCFullYear();
  if(byYear[year])byYear[year].candidates++;
  const full=mandatory.every(id=>snap(sources,id,time,maxAgeDays)!==null);
  if(full){totals.complete_asof_12_of_12++;if(byYear[year])byYear[year].complete_asof++}
  else{totals.incomplete_asof++;continue}
  const dollar=delta(sources,'DXY',time,7,maxAgeDays),real=delta(sources,'DFII10',time,7,maxAgeDays),gld=sumWindow(sources,'GLD_TONNES_DELTA',time,7);
  const mm=delta(sources,'COT_NET',time,28,maxAgeDays);
  const side=cand.direction==='long'?1:-1;
  const alignDxy=Number.isFinite(dollar)?side*dollar<0:null,alignReal=Number.isFinite(real)?side*real<0:null;
  const alignEtf=Number.isFinite(gld)?side*gld>0:null,alignCftc=Number.isFinite(mm)?side*mm>0:null;
  if([alignDxy,alignReal,alignEtf].some(v=>v===null))totals.not_sufficient_source_history_for_change++;
  if(alignDxy===true&&alignReal===true)totals.dxy_and_real_yield_aligned++;
  const triple=alignDxy===true&&alignReal===true&&alignEtf===true;
  if(triple){totals.dxy_real_yield_and_gld_direction_aligned++;if(byYear[year])byYear[year].triple_alignment++}
  if(alignCftc===true)totals.cftc_net_direction_aligned++;
  recent.push({confirmed_utc:cand.confirmation_closed_utc,direction:cand.direction,asof_full_data:true,
   dxy_delta_7calendar_days:dollar===null?null:+dollar.toFixed(3),real_yield_delta_percentage_points_7calendar_days:real===null?null:+real.toFixed(3),
   gld_holding_tonnes_delta_7calendar_days:gld===null?null:+gld.toFixed(2),
   managed_money_net_futures_contract_delta_28calendar_days:mm===null?null:+mm.toFixed(0),
   direction_aligned:{dxy:alignDxy,real_yield:alignReal,gld_holdings:alignEtf,managed_money:alignCftc,triple}});
 }
 return {status:'technical_patterns_cross_market_asof_descriptive_only',counts:totals,by_year:byYear,recent_descriptive_only:recent.slice(-8),
  full_v22_macro_signals_generated:0,verified_treasury_event_forecast_signals_generated:0,
  trade_signals_enabled:false,limitations:['Coincidence is NOT V2.2 eligibility; no fiscal forecast surprise or positive V2.2 A/A+/A++ proof','DXY and real-rate comparison uses conservative point-in-time lagged CURRENT-VINTAGE values, not verified actual historical release versions','GLD tonnes changes are trust-inventory proxies, not actual daily global ETF dollar creations/redemptions','CFTC 28-calendar-day delta uses conservative as-of release lag and current-vintage files','No daily/weekly Dow trend, COMEX contract roll, costs, PnL, or signal execution is inferred']};
}
module.exports={inspectPriceCandidates,snap,delta,sumWindow};
