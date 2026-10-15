// Align ex-ante D+3 fiscal cash forecasts with independent GOLD 4h confirmations.
// Association ONLY: fiscal forecast sign is not a V2.2 forecast revision Z score or trade signal.
function align(fiscalDecisions,technicalCandidates,maxAgeHours=72){
 const sorted=(fiscalDecisions||[]).slice().filter(x=>Number.isFinite(Date.parse(x.no_earlier_than_utc))&&Number.isFinite(x.forecast_D3_auction_plus_tax_usd_millions)).sort((a,b)=>a.no_earlier_than_utc.localeCompare(b.no_earlier_than_utc));
 const group={2025:{price_candidates:0,fiscal_forecasts_available:0,known_offers_direction_aligned:0,with_issuance_fallback_direction_aligned:0},2026:{price_candidates:0,fiscal_forecasts_available:0,known_offers_direction_aligned:0,with_issuance_fallback_direction_aligned:0}};
 let eligible=0,unknown=0,standard=0,fallback=0,both=0;
 const recent=[];
 for(const candidate of technicalCandidates||[]){
  const time=Date.parse(candidate.confirmation_closed_utc),y=new Date(time).getUTCFullYear();
  if(!Number.isFinite(time)||!['long','short'].includes(candidate.direction))throw Error('Invalid gold 4h candidate');
  if(group[y])group[y].price_candidates++;
  let lo=0,hi=sorted.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(Date.parse(sorted[mid].no_earlier_than_utc)<=time)lo=mid+1;else hi=mid}
  const d=lo?sorted[lo-1]:null;
  if(!d||time-Date.parse(d.no_earlier_than_utc)>maxAgeHours*3600000){unknown++;continue}
  eligible++;if(group[y])group[y].fiscal_forecasts_available++;
  const targetDirection=candidate.direction==='long'?-1:1;
  const aligned=targetDirection*d.forecast_D3_auction_plus_tax_usd_millions>0;
  const hasFallback=Number.isFinite(d.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions);
  const alternative=hasFallback?targetDirection*d.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions>0:null;
  if(aligned){standard++;if(group[y])group[y].known_offers_direction_aligned++}
  if(alternative===true){fallback++;if(group[y])group[y].with_issuance_fallback_direction_aligned++}
  if(aligned&&alternative===true)both++;
  recent.push({confirmed_utc:candidate.confirmation_closed_utc,direction:candidate.direction,fiscal_issued_date:d.decision_date,
   issued_no_earlier_than_utc:d.no_earlier_than_utc,fiscal_D3_target_date:d.forecast_target_date,
   forecasted_D3_change_auction_known_usd_billions:+(d.forecast_D3_auction_plus_tax_usd_millions/1000).toFixed(3),
   forecasted_D3_change_issuance_fallback_usd_billions:hasFallback?+(d.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions/1000).toFixed(3):null,
   bullish_bearish_direction_aligned_known_offers:aligned,
   bullish_bearish_direction_aligned_fallback:alternative,
   known_future_bills_auction_schedule_complete:d.complete_auction_issuance_announcement_for_all_future_days});
 }
 return {status:'historical_fiscal_predicted_level_direction_vs_gold_price_patterns_only',
  candidates:technicalCandidates?.length||0,conservative_prior_fiscal_forecasts_found:eligible,missing_or_older_than_72h:unknown,
  forecast_TGA_change_direction_aligned_auction_known_only:standard,
  forecast_TGA_change_direction_aligned_with_unannounced_bill_fallback:fallback,
  both_fiscal_models_same_direction_aligned:both,by_year:group,recent_research_examples:recent.slice(-8),
  fiscal_revision_z_score_constructed:false,
  v22_grade_A_Aplus_Aplusplus_signals_constructed:false,
  actual_historical_publication_vintages_verified:false,trade_signals_enabled:false,
  limitations:['Research-only level direction; NOT the V2.2 fiscal forecast REVISION Z-score','No current-day Treasury cash balance is used to generate the decision forecast','Conservative decision availability is 23:59:59 UTC; real historical release time is unverified','Same historical window was used during model iteration; no untouched out-of-sample strategy result','Gold price patterns are non-independent and may represent repeats during one trend','Does NOT imply market profit or combine with full factor and risk rules']};
}
module.exports={align};
