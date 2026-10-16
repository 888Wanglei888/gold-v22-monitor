// Frozen 4H Dow baseline (11 trades) CFTC OI point-in-time filter audit.
// Does not modify original trade execution and does not claim reproducible full V2.2.
const fs=require('node:fs'),ONE=864e5,day=x=>Date.parse(x+'T00:00:00Z'),iso=x=>new Date(x).toISOString().slice(0,10),add=(x,d)=>iso(day(x)+d*ONE);
const shutdown={"2025-09-30":"2025-11-19","2025-10-07":"2025-11-21","2025-10-14":"2025-11-25","2025-10-21":"2025-12-02","2025-10-28":"2025-12-05","2025-11-04":"2025-12-09","2025-11-10":"2025-12-10","2025-11-18":"2025-12-12","2025-11-25":"2025-12-15","2025-12-02":"2025-12-17","2025-12-09":"2025-12-19","2025-12-16":"2025-12-23","2025-12-23":"2025-12-29","2025-12-30":"2026-01-05","2026-01-06":"2026-01-09","2026-01-13":"2026-01-16","2026-01-20":"2026-01-23"};
async function main(){
 const p=new URLSearchParams({cftc_contract_market_code:'088691','$where':"report_date_as_yyyy_mm_dd >= '2018-01-01T00:00:00'","$order":"report_date_as_yyyy_mm_dd ASC","$limit":"1200"});
 const rows=await (await fetch('https://publicreporting.cftc.gov/resource/72hh-3qpy.json?'+p)).json();
 const cot=rows.map(x=>({d:x.report_date_as_yyyy_mm_dd.slice(0,10),oi:+x.open_interest_all,mm:+x.m_money_positions_long_all-(+x.m_money_positions_short_all)}));
 const B=require('../reports/v22-c1-three-way-latest.json').B_dow_four_hour.full_costed_trade_ledger;
 const out={run_at:new Date().toISOString(),baseline:{trades:B.length,net_usd:B.reduce((s,x)=>s+x.pnl_after_costs_usd,0)},research_only:true,sensitivity:{}};
 for(const lag of [7,15]){
  let entries=[];
  for(const t of B){
   const confirm=t.source_dow_confirmed_at_utc.slice(0,10);
   let latest=null;
   for(let i=4;i<cot.length;i++){
    const r=cot[i];
    let avail=add(r.d,lag);if(shutdown[r.d])avail=avail>add(shutdown[r.d],1)?avail:add(shutdown[r.d],1);
    if(avail>confirm)continue;
    const age=(day(confirm)-day(r.d))/ONE;if(!latest||r.d>latest.report_date)latest={report_date:r.d,availability_date:avail,oi4_delta_contracts:r.oi-cot[i-4].oi,mm4_delta_contracts:r.mm-cot[i-4].mm,age_days:age};
   }
   let info=latest||{report_date:null,age_days:null,oi4_delta_contracts:null,mm4_delta_contracts:null};
   const fresh=latest&&latest.age_days<=21;
   entries.push({confirmed_utc:t.source_dow_confirmed_at_utc,entry_utc:t.entry_at,exit_utc:t.exit_at,pnl_usd:t.pnl_after_costs_usd,win:t.pnl_after_costs_usd>0,latest_cftc_report:info.report_date,cot_age_days:info.age_days,oi4_delta_contracts:info.oi4_delta_contracts,mm4_delta_contracts:info.mm4_delta_contracts,source_fresh:!!fresh,pass_OI_positive:!!fresh&&info.oi4_delta_contracts>0,pass_MM_positive:!!fresh&&info.mm4_delta_contracts>0,pass_both:!!fresh&&info.oi4_delta_contracts>0&&info.mm4_delta_contracts>0});
  }
  const summary={};for(const k of ['source_fresh','pass_OI_positive','pass_MM_positive','pass_both']){
   const yes=entries.filter(x=>x[k]),no=entries.filter(x=>!x[k]);
   summary[k]={retained:yes.length,retained_win:yes.filter(x=>x.win).length,retained_original_PnL_usd:+yes.reduce((s,x)=>s+x.pnl_usd,0).toFixed(2),
    excluded:no.length,excluded_winners:no.filter(x=>x.win).length,excluded_losses:no.filter(x=>!x.win).length,
    note:'Original trade PnLs are NOT rescaled for changed compounding/capital occupancy. Diagnostic only.'};
  }
  out.sensitivity[lag]={summary,entries};
 }
 fs.mkdirSync('research-data',{recursive:true});fs.writeFileSync('research-data/GOLD_DOW4H_CFTC_OI_11_TRADES_audit.json',JSON.stringify(out,null,2));
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
