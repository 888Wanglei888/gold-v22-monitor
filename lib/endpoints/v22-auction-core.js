// Point-in-time filtered known Treasury auction awards: a forecasting INPUT, NOT full net cash.
// Never use future auction outcomes to construct an earlier signal.
const dayMs=s=>Date.parse(s+'T00:00:00Z'),iso=n=>new Date(n).toISOString().slice(0,10);
const validDay=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\d$/.test(s)&&Number.isFinite(dayMs(s));
const n=x=>{if(x===null||x===undefined||x===''||x==='null')return null;const a=Number(x);return Number.isFinite(a)&&a>0?a:null};
function normalize(raw){
 const keys=new Set(),out=[],faults={invalid_fields:0,duplicate_auction_identity:0,auction_after_issue:0};
 for(const x of raw){
  const auction_date=x.auction_date,issue_date=x.issue_date,maturity_date=x.maturity_date,cusip=String(x.cusip||''),type=String(x.security_type||''),amount=n(x.total_accepted);
  if(!validDay(auction_date)||!validDay(issue_date)||!validDay(maturity_date)||!['Bill','Note','Bond','TIPS','FRN'].includes(type)||!amount||!cusip){faults.invalid_fields++;continue}
  if(issue_date<auction_date||maturity_date<issue_date){faults.auction_after_issue++;continue}
  const key=cusip+'|'+auction_date+'|'+issue_date;
  if(keys.has(key)){faults.duplicate_auction_identity++;continue}
  keys.add(key);
  out.push({cusip,type,auction_date,issue_date,maturity_date,total_accepted_usd:amount});
 }
 return {events:out.sort((a,b)=>a.auction_date.localeCompare(b.auction_date)),faults};
}
function knownAt(events,asof,delayCalendarDays=2){
 if(!validDay(asof))throw Error('Invalid historical as-of');
 const cutoff=iso(dayMs(asof)-delayCalendarDays*86400000);
 return events.filter(x=>x.auction_date<=cutoff);
}
function buildKnownFutureLedger(events,asof,target,delayCalendarDays=2){
 if(!validDay(target)||target<=asof)throw Error('Target must be strictly after as-of');
 const knowledge=knownAt(events,asof,delayCalendarDays);
 const issue=knowledge.filter(x=>x.issue_date===target),maturing=knowledge.filter(x=>x.issue_date<=asof&&x.maturity_date===target);
 const sum=(rows)=>rows.reduce((s,x)=>s+x.total_accepted_usd,0);
 const kind={};
 for(const type of ['Bill','Note','Bond','TIPS','FRN']){
  const issued=issue.filter(x=>x.type===type),redeemed=maturing.filter(x=>x.type===type);
  kind[type]={known_gross_awards_usd:sum(issued),known_maturing_original_auction_awards_usd:sum(redeemed),issue_records:issued.length,maturity_records:redeemed.length};
 }
 const bill=kind.Bill;
 return {asof_date:asof,target_date:target,conservative_auction_results_lag_days:delayCalendarDays,
  auction_results_known_asof:knowledge.length,known_future_issued_gross_usd:sum(issue),known_future_maturing_gross_usd:sum(maturing),
  known_bill_proxy_net_usd:bill.known_gross_awards_usd-bill.known_maturing_original_auction_awards_usd,
  by_type:kind,
  // Important: future auctions not yet announced can subsequently add issuance; coupon redemption history before source start is absent.
  complete_net_financing_forecast:false,known_only_components:true};
}

// Announcement-based issuance forecast, using publicly scheduled offerings even before the auction happens.
// Do NOT use future-auction total_accepted for projected issuance.
function normalizeAnnouncements(raw){
 const keys=new Set(),events=[],faults={missing_announcement:0,invalid_offering:0,duplicate_auction_identity:0,bad_date_order:0};
 for(const x of raw){
  const announce_date=x.announcemt_date,auction_date=x.auction_date,issue_date=x.issue_date,maturity_date=x.maturity_date,cusip=String(x.cusip||'');
  const type=String(x.security_type||''),offer=n(x.offering_amt),accepted=n(x.total_accepted);
  if(!validDay(announce_date)){faults.missing_announcement++;continue}
  if(!validDay(auction_date)||!validDay(issue_date)||!validDay(maturity_date)||!['Bill','Note','Bond','TIPS','FRN'].includes(type)||!cusip||!offer){faults.invalid_offering++;continue}
  if(announce_date>auction_date||auction_date>issue_date||issue_date>maturity_date){faults.bad_date_order++;continue}
  const key=cusip+'|'+auction_date+'|'+issue_date;
  if(keys.has(key)){faults.duplicate_auction_identity++;continue}
  keys.add(key);
  events.push({cusip,type,announce_date,auction_date,issue_date,maturity_date,offering_amt_usd:offer,total_accepted_usd:accepted});
 }
 return {events:events.sort((a,b)=>a.announce_date.localeCompare(b.announce_date)),faults};
}
function buildAnnouncedFutureLedger(events,asof,target,announcementLagDays=1,resultsLagDays=2){
 if(!validDay(asof)||!validDay(target)||target<=asof)throw Error('Invalid as-of/target');
 const announceCutoff=iso(dayMs(asof)-announcementLagDays*86400000),auctionCutoff=iso(dayMs(asof)-resultsLagDays*86400000);
 const publicOffers=events.filter(x=>x.announce_date<=announceCutoff&&x.issue_date===target);
 // Only completed/issued past auctions can contribute to a known maturity principal estimate.
 const alreadyIssued=events.filter(x=>x.auction_date<=auctionCutoff&&x.issue_date<=asof&&x.maturity_date===target&&x.total_accepted_usd>0);
 const sum=(list,key)=>list.reduce((s,x)=>s+x[key],0);
 const by_type={};
 for(const type of ['Bill','Note','Bond','TIPS','FRN']){
  const offered=publicOffers.filter(x=>x.type===type),matures=alreadyIssued.filter(x=>x.type===type);
  by_type[type]={published_upcoming_offering_usd:sum(offered,'offering_amt_usd'),previously_issued_maturing_awards_usd:sum(matures,'total_accepted_usd'),offering_count:offered.length,maturing_auctions:matures.length};
 }
 return {asof_date:asof,target_date:target,announcement_cutoff_date:announceCutoff,auction_results_cutoff_date:auctionCutoff,
  known_announcement_record_count:events.filter(x=>x.announce_date<=announceCutoff).length,
  bill_offering_minus_known_maturities_usd:by_type.Bill.published_upcoming_offering_usd-by_type.Bill.previously_issued_maturing_awards_usd,
  by_type,completed_auction_results_are_not_used_for_future_issue_amounts:true,
  full_net_new_cash_forecast:false,
  blockers:['Future unannounced offerings excluded','Historical pre-start maturing long-dated coupons omitted','SOMA rollover and cash-discount adjustments not yet reconciled']};
}

module.exports={normalize,knownAt,buildKnownFutureLedger,normalizeAnnouncements,buildAnnouncedFutureLedger};
