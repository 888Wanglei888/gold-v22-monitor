const {snap,delta,sumWindow}=require('./v22-cross-market-core');
const {makeFiscalLookup}=require('./v22-c1-gate-core');
const DAY=86400000, names=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL','DXY','COT_NET','COT_OI','TGA','GLD_TONNES_DELTA'];
const modes=['anticipation','credit_exception','revision','combined'];
const gradeRisk={A:.005,'A+':.0075,'A++':.01};
function revisionLookup(records){
 const rows=(records||[]).filter(x=>Number.isFinite(x.fiscal_revision_z_research_proxy_fallback)).sort((a,b)=>a.no_earlier_than_utc.localeCompare(b.no_earlier_than_utc));
 return time=>{let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;Date.parse(rows[m].no_earlier_than_utc)<=time?lo=m+1:hi=m}
 const x=lo?rows[lo-1]:null;return x&&time-Date.parse(x.no_earlier_than_utc)<=5*DAY?x:null};
}
function decide(f,mode){
 const macro=Number(f.usd)+Number(f.real),flow=Number(f.gld)+Number(f.cot);
 const market=(macro>=1&&flow>=1)||(f.credit&&flow>=1);
 const ant=f.fiscal<=0&&market&&f.spread<=.20;
 const credit=f.credit&&flow>=1&&f.spread<=.20&&Math.abs(f.fiscal)>=30;
 const revision=Number.isFinite(f.z)&&f.side*f.z<=-.75&&market&&f.spread<=.20;
 const branch=mode==='anticipation'?(ant?'anticipation':null):mode==='credit_exception'?(ant?'anticipation':credit?'credit':null):
  mode==='revision'?(revision?'revision':null):mode==='combined'?(revision?'revision':ant?'anticipation':credit?'credit':null):null;
 if(!modes.includes(mode))throw Error('Unrecognized C2 research mode');
 const points=macro+flow+Number(f.reserve)+Number(f.fiscal<=0);
 const grade=!branch?null:points>=5?'A++':points>=4?'A+':'A';
 return {eligible:Boolean(branch),branch,grade};
}
function makeC2({sources,maxAgeDays,decisionForecasts,revisionRecords,mode}){
 if(!modes.includes(mode))throw Error('Invalid C2 mode');
 const cash=makeFiscalLookup(decisionForecasts),revisions=revisionLookup(revisionRecords);
 const counts={checked:0,missing_any_source:0,missing_fiscal:0,missing_changes:0,eligible:0,branches:{anticipation:0,credit:0,revision:0},grades:{A:0,'A+':0,'A++':0}};
 const gate=candidate=>{
  counts.checked++;const at=candidate.confirmed_at,side=candidate.dir==='long'?1:-1;
  const absent=names.filter(n=>!snap(sources,n,at,maxAgeDays));
  if(absent.length){counts.missing_any_source++;return {eligible:false,reason:'source_missing:'+absent.join(',')}}
  const expected=cash(at);if(!expected){counts.missing_fiscal++;return {eligible:false,reason:'forecast_not_yet_available'}}
  const read=(k,n)=>delta(sources,k,at,n,maxAgeDays);
  const values={dx:read('DXY',7),real:read('DFII10',7),nominal:read('DGS10',7),infl:read('T10YIE',7),
   reserve:read('WRESBAL',28),rrp:read('RRPONTSYD',14),cot:read('COT_NET',28),
   gld:sumWindow(sources,'GLD_TONNES_DELTA',at,7)};
  const s=snap(sources,'SOFR',at,maxAgeDays),i=snap(sources,'IORB',at,maxAgeDays);
  const forecast=expected.forecast_D3_auction_plus_missing_issuance_baseline_tax_usd_millions/1000;
  if(!Object.values(values).every(Number.isFinite)||![forecast,s?.value,i?.value].every(Number.isFinite)){
   counts.missing_changes++;return {eligible:false,reason:'historical_delta_missing'};
  }
  const z=revisions(at)?.fiscal_revision_z_research_proxy_fallback??null;
  const features={side,usd:side*values.dx<0,real:side*values.real<0,gld:side*values.gld>0,
   cot:side*values.cot>0,reserve:side*values.reserve>0,fiscal:side*forecast,spread:s.value-i.value,z,
   credit:candidate.dir==='long'&&values.dx<0&&values.nominal>0&&values.infl>0&&Math.abs(values.infl)>=Math.abs(values.real)*.5};
  const decision=decide(features,mode);
  if(decision.eligible){counts.eligible++;counts.branches[decision.branch]++;counts.grades[decision.grade]++}
  return {eligible:decision.eligible,reason:decision.branch||'no_confirmed_multifactor_path',
   features:{forecast_D3_TGA_usd_bn:+forecast.toFixed(2),fiscal_available_utc:expected.no_earlier_than_utc,
    fiscal_includes_imputed_future_bills:expected.future_days_without_published_auction_issuance>0,
    revision_z_proxy:Number.isFinite(z)?+z.toFixed(3):null,
    dxy_7d:values.dx,real_yield_7d:values.real,nominal_yield_7d:values.nominal,inflation_comp_7d:values.infl,
    reserve_28d:values.reserve,on_rrp_14d:values.rrp,GLD_holdings_7d:values.gld,CFTC_net_28d:values.cot,
    sofr_iorb_spread_pp:features.spread,positive_evidence:{usd:features.usd,real_yield:features.real,GLD:features.gld,CFTC:features.cot,reserve:features.reserve},
    fiscal_liquidity_direction_support:features.fiscal<=0,credit_discount_proxy:features.credit,
    mode:decision.branch,grade:decision.grade,unverified_history_vintages:true}};
 };
 return {gate,counts,mode};
}
module.exports={makeC2,modes,gradeRisk,decide,revisionLookup};
