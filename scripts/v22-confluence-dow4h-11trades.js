// Diagnostic 4H B trades conditioned on historically lagged TGA and CFTC.
const fs=require('node:fs');
const {loadResearchInputs}=require('../lib/endpoints/v22-asof-join');
const {buildAsOf,atOrBefore,DAY}=require('../lib/endpoints/v22-asof-core');
const d=s=>Date.parse(s+'T00:00:00Z');
function change(src,t,n,age){const a=src.rows||[],last=atOrBefore(a,t);if(!last||t-d(last.date)>age*DAY)return null;let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m].available_utc_ms<=t)lo=m+1;else hi=m}return lo<=n?null:a[lo-1].value-a[lo-n-1].value}
async function main(){
 const raw=fs.readFileSync('research-data/official_tga_daily_2019_20261014.csv','utf8').trim().split(/\r?\n/).slice(1);
 const tga=buildAsOf(raw.map(s=>s.replaceAll('"','').split(',')).map(x=>({date:x[0],value:+x[1]})).filter(x=>Number.isFinite(x.value)),3);
 const src=(await loadResearchInputs()).sources;
 const b=require('../reports/v22-c1-three-way-latest.json').B_dow_four_hour.full_costed_trade_ledger;
 const rows=b.map(q=>{const time=Date.parse(q.source_dow_confirmed_at_utc),side=q.direction==='long'?1:-1,T=change(tga,time,5,10),C=change(src.COT_NET,time,4,30),R=change(src.DFII10,time,5,10),D=change(src.DXY,time,5,10);
  const passT=Number.isFinite(T)&&side*T<0,passC=Number.isFinite(C)&&side*C>0,passR=Number.isFinite(R)&&side*R<0,passD=Number.isFinite(D)&&side*D<0;
  return {entry:q.entry_at,confirmation:q.source_dow_confirmed_at_utc,direction:q.direction,pnl:q.pnl_after_costs_usd,TGA_change5:T,COT_net_change4:C,real_change5:R,dollar_change5:D,
    passT,passC,passR,passD,pass_price_TGA_COT:passT&&passC,pass_price_DXY_TGA:passT&&passD,pass_price_REAL_DXY_TGA:passT&&passD&&passR};});
 const stats={};for(const k of ['unfiltered','passT','passC','pass_price_TGA_COT','pass_price_DXY_TGA','pass_price_REAL_DXY_TGA']){
  const x=k==='unfiltered'?rows:rows.filter(q=>q[k]),z=rows.filter(q=>k!=='unfiltered'&&!q[k]);
  stats[k]={n:x.length,winners:x.filter(q=>q.pnl>0).length,original_pnl_usd:+x.reduce((a,b)=>a+b.pnl,0).toFixed(2),excluded_winners:z.filter(q=>q.pnl>0).length,excluded_losers:z.filter(q=>q.pnl<=0).length};
 }
 const out={created_utc:new Date().toISOString(),status:'exploratory_original_B_dow4h_confluence_filter',stats,rows,
  caveats:['Only 11 trades, all longs, narrow regime','Original trade PnLs summed, not a rerun cash equity curve','FRED/COT use conservatively lagged revised historical values, not certified vintage','This does not certify original V2.2 strategy or stop execution']};
 fs.mkdirSync('research-data',{recursive:true});fs.writeFileSync('research-data/GOLD_V22_CONFLUENCE_11_DOW4H_TRADES_AUDIT.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}main().catch(e=>{console.error(e);process.exitCode=1});
