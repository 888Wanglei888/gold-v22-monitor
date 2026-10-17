// 2016 XAUUSD 5-minute spot-gold Turtle S2 / S1-like and experimental 5min channel backtest.
// Direct 2015+2016 Dukascopy-derived annual XAUUSD M5 bid/ask candles. Research only.
// Every signal uses ONLY previous completed daily or 5m bars; no future candles.
const fs=require('node:fs');
const zlib=require('node:zlib');
const DAY=864e5;
const fmt=ts=>new Date(ts*1000).toISOString().slice(0,10);
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const session=ts=>{const v=Object.fromEntries(ny.formatToParts(ts*1000).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const local=v.year+'-'+v.month+'-'+v.day;return Number(v.hour)>=17?new Date(Date.parse(local+'T00:00:00Z')+DAY).toISOString().slice(0,10):local};
const rd=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const DATA='https://evtradelabs.com/api/simulator/data/XAUUSD/M5/';
async function getYear(y){
 const r=await fetch(DATA+y+'.json.gz',{signal:AbortSignal.timeout(70000)});
 if(!r.ok)throw Error('Unable to download '+y+' http '+r.status);
 const buf=Buffer.from(await r.arrayBuffer()),s=zlib.gunzipSync(buf).toString();
 const a=JSON.parse(s).map(x=>({...x,date:fmt(x.ts),session:session(x.ts)})).sort((x,y)=>x.ts-y.ts);
 return {rows:a,compressed_bytes:buf.length,plain_bytes:s.length};
}
function quality(bars){
 const q={bars:bars.length,first:bars[0]?.date,last:bars.at(-1)?.date,invalid:0,duplicate:0,chronology_violations:0,
 spread_negative:0,spread_over5:0,spread_over10:0,intervals_missing_5m_within_utc_day:0};
 const spreads=[];
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(![b.o,b.h,b.l,b.c,b.ao,b.ah,b.al,b.ac].every(Number.isFinite)||b.o<=0||b.ao<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.ah<Math.max(b.ao,b.ac)||b.al>Math.min(b.ao,b.ac))q.invalid++;
  if(b.ao<b.o)q.spread_negative++;
  let spread=b.ao-b.o;spreads.push(spread);
  if(spread>5)q.spread_over5++;if(spread>10)q.spread_over10++;
  if(i){const prev=bars[i-1],gap=b.ts-prev.ts;if(gap===0)q.duplicate++;if(gap<0)q.chronology_violations++;
   if(b.date===prev.date&&gap>300)q.intervals_missing_5m_within_utc_day+=Math.round(gap/300)-1;}
 }
 spreads.sort((a,b)=>a-b);
 q.median_open_spread_usd=rd(spreads[Math.floor(.5*spreads.length)],4);
 q.p95_open_spread_usd=rd(spreads[Math.floor(.95*spreads.length)],4);
 q.p99_open_spread_usd=rd(spreads[Math.floor(.99*spreads.length)],4);
 return q;
}
function dailyBars(bars){
 const days=[],index=new Map();
 for(const b of bars){
  let d=index.get(b.session);
  if(!d){d={date:b.session,open:b.o,high:b.h,low:b.l,close:b.c,ask_high:b.ah,ask_low:b.al,n:0};index.set(b.session,d);days.push(d)}
  d.high=Math.max(d.high,b.h);d.low=Math.min(d.low,b.l);d.ask_high=Math.max(d.ask_high,b.ah);
  d.ask_low=Math.min(d.ask_low,b.al);d.close=b.c;d.n++;
 }
 days.sort((a,b)=>a.date.localeCompare(b.date));
 let avgN=0;for(let i=0;i<days.length;i++){
  let d=days[i],prev=days[i-1],tr=prev?Math.max(d.high-d.low,Math.abs(d.high-prev.close),Math.abs(d.low-prev.close)):d.high-d.low;
  if(i<20){avgN+=tr;if(i===19)d.atr20=avgN/20}
  else d.atr20=(19*days[i-1].atr20+tr)/20;
 }
 return days;
}
function rollingIntraday(bars,nmax=55){
 const arr=[],tr=[],total=bars.length;
 for(let i=0;i<total;i++){
  const x=bars[i],prev=bars[i-1];
  tr[i]=prev?Math.max(x.h-x.l,Math.abs(x.h-prev.c),Math.abs(x.l-prev.c)):x.h-x.l;
  let atr;
  if(i===19)atr=avg(tr.slice(0,20));
  else if(i>19)atr=(19*arr[i-1].atr20+tr[i])/20;
  let up={},dn={},exitL={},exitS={};
  for(const n of [10,20,55]){
   if(i<n)continue;
   const a=bars.slice(i-n,i);
   up[n]=Math.max(...a.map(y=>y.h));
   dn[n]=Math.min(...a.map(y=>y.l));
   exitS[n]=Math.max(...a.map(y=>y.ah));
   exitL[n]=dn[n];
  }
  arr[i]={atr20:atr,up,down:dn,exitLong:exitL,exitShort:exitS};
 }
 return arr;
}
function getDailyLevels(days){
 const map=new Map();
 for(let i=55;i<days.length;i++){
  const prev=days[i-1],up={},dn={},exitL={},exitS={};
  for(const n of [10,20,55]){
   const period=days.slice(i-n,i);
   up[n]=Math.max(...period.map(x=>x.high));dn[n]=Math.min(...period.map(x=>x.low));
   exitL[n]=dn[n];exitS[n]=Math.max(...period.map(x=>x.ask_high));
  }
  map.set(days[i].date,{atr20:prev.atr20,up,down:dn,exitLong:exitL,exitShort:exitS,prior_completed_day:prev.date});
 }
 return map;
}
function run(bars,days,flavor,config){
 const first=bars.findIndex(b=>b.date>='2016-01-01'),end=bars.findLastIndex(b=>b.date<='2016-12-31');
 const dailyLevels=getDailyLevels(days);
 const intraday=flavor.frame==='m5'?rollingIntraday(bars):null;
 let cash=10000,pos=null,closed=[],barsHeld=0,triggers=0,excludedWide=0,ambiguousEntry=0;
 let eqCurve=[],entryTicks=0,lastExitIdx=-Infinity,maxConsecutiveLoss=0,losing=0;
 const slip=config.slippage_per_side??.05,zeroSpread=config.zero_spread||false;
 function spread(b){return zeroSpread?0:Math.max(0,b.ao-b.o)}
 function askO(b){return zeroSpread?b.o:b.ao}
 function askH(b){return zeroSpread?b.h:b.ah}
 function askL(b){return zeroSpread?b.l:b.al}
 function fSell(price){return price-slip}
 function fBuy(price){return price+slip}
 function exit(i,at,why){
  const b=bars[i],isLong=pos.side===1;
  let px=isLong?fSell(at):fBuy(at);
  let pnl=pos.side*pos.qty*(px-pos.entry);
  cash+=pnl;
  closed.push({entry_date:pos.date,exit_date:b.date,side:pos.side,entry_price:rd(pos.entry,3),exit_price:rd(px,3),
   entry_time_utc:new Date(pos.ts*1000).toISOString(),exit_time_utc:new Date(b.ts*1000).toISOString(),
   pnl_usd:rd(pnl),balance_usd:rd(cash),bars_held:i-pos.idx+1,reason:why});
  if(pnl<0){losing++;maxConsecutiveLoss=Math.max(maxConsecutiveLoss,losing)}else losing=0;
  pos=null;lastExitIdx=i;
 }
 const threshold=i=>{
  let b=bars[i],d=flavor.frame==='daily'?dailyLevels.get(b.session):intraday[i];
  if(!d)return null;
  if(flavor.frame==='daily'&&!(Number.isFinite(d.atr20)&&d.prior_completed_day<b.session))return null;
  return d;
 };
 function open(i,b,lev,side,atr){
  if(!(atr>0&&Number.isFinite(atr))){return}
  let spr=spread(b);if(spr>config.max_spread_usd){excludedWide++;return}
  let trigger=side===1?Math.max(b.o,lev):Math.min(b.o,lev);
  let entry=side===1?fBuy(Math.max(askO(b),trigger+spr)):fSell(trigger);
  let stop=entry-side*2*atr; // stop is bid price for longs, ask price for shorts
  const dist=2*atr+2*slip;
  const qty=Math.min(cash*.005/dist,cash*5/entry);
  if(!(qty>0)){return}
  pos={entry,stop,initStop:stop,qty,side,date:b.date,ts:b.ts,idx:i,level:lev,atr};
  entryTicks++;triggers++;
  // Pessimistic same-bar stop only when stop is also crossed: unknown intrabar path
  if((side===1&&b.l<=stop)||(side===-1&&askH(b)>=stop)){
   ambiguousEntry++;
   const x=side===1?Math.min(b.o,stop):Math.max(askO(b),stop);
   exit(i,x,'same_bar_entry_stop_assumed');
  }
 }
 for(let i=first;i<=end;i++){
  const b=bars[i],lev=threshold(i);let justExited=false;
  if(pos){
   barsHeld++;
   const stop=pos.side===1?b.l<=pos.stop:askH(b)>=pos.stop;
   const channel=pos.side===1?lev?.exitLong?.[flavor.exit]:lev?.exitShort?.[flavor.exit];
   const exits=Number.isFinite(channel)&&(pos.side===1?b.l<=channel:askH(b)>=channel);
   if(stop){const at=pos.side===1?Math.min(b.o,pos.stop):Math.max(askO(b),pos.stop);exit(i,at,'stop_2N');justExited=true}
   else if(exits){const at=pos.side===1?Math.min(b.o,channel):Math.max(askO(b),channel);exit(i,at,'opposite_channel');justExited=true}
  }
  if(!pos&&!justExited&&lev&&Number.isFinite(lev.atr20)){
   const high=lev.up[flavor.enter],low=lev.down[flavor.enter];
   if(Number.isFinite(high)&&Number.isFinite(low)){
    const long=b.h>=high,short=b.l<=low;
    if(long&&short){ambiguousEntry++;}else if(long||short){const side=long?1:-1;open(i,b,long?high:low,side,lev.atr20)}
   }
  }
  if(pos){const mark=pos.side===1?b.c:askO(b);eqCurve.push({date:b.date,eq:cash+pos.side*pos.qty*(mark-pos.entry)});
  }else eqCurve.push({date:b.date,eq:cash});
 }
 if(pos){const b=bars[end];exit(end,pos.side===1?b.c:askO(b),'forced_year_end');eqCurve.at(-1).eq=cash}
 let peak=10000,maxdd=0;for(const x of eqCurve){peak=Math.max(peak,x.eq);maxdd=Math.max(maxdd,100*(1-x.eq/peak))}
 const wins=closed.filter(x=>x.pnl_usd>0),losses=closed.filter(x=>x.pnl_usd<0);
 const prof=wins.reduce((s,x)=>s+x.pnl_usd,0),loss=-losses.reduce((s,x)=>s+x.pnl_usd,0);
 const months={};for(const x of closed){const mo=x.exit_date.slice(0,7),s=months[mo]??={trades:0,wins:0,pnl_usd:0};s.trades++;s.wins+=(x.pnl_usd>0?1:0);s.pnl_usd=rd(s.pnl_usd+x.pnl_usd)}
 return {flavor:flavor.name,code:flavor.code,period:'2016-01-01 to 2016-12-31',year_end_close:true,bars_eval:end-first+1,
  quote_type:zeroSpread?'bid_only_zero_spread_hypothetical':'Dukascopy XAUUSD bid+ask with spread',
  assumptions:{slippage_per_side_usd:slip,max_acceptable_open_spread:config.max_spread_usd,risk_fraction:0.005,notional_leverage_max:5},
  trades:closed.length,wins:wins.length,win_rate_pct:closed.length?rd(wins.length/closed.length*100,1):null,
  longs:closed.filter(x=>x.side===1).length,shorts:closed.filter(x=>x.side===-1).length,ending_cash_usd:rd(cash),
  return_pct:rd(100*(cash/10000-1)),max_drawdown_pct:rd(maxdd),
  profit_factor:loss>0?rd(prof/loss,3):null,total_gross_wins_usd:rd(prof),total_gross_losses_usd:rd(loss),
  mean_win_usd:rd(avg(wins.map(x=>x.pnl_usd))),mean_loss_usd:rd(avg(losses.map(x=>x.pnl_usd))),
  max_consecutive_losses:maxConsecutiveLoss,average_holding_5m_bars:rd(avg(closed.map(x=>x.bars_held)),1),
  sample_trades:closed.slice(0,4).concat(closed.slice(-4)),monthly:months,
  raw_ledger:closed,entry_ticks:entryTicks,triggers,excluded_wide_spread:excludedWide,
  ambiguous_entry_or_samebar_stop_count:ambiguousEntry};
}
async function main(){
 const [a,b]=await Promise.all([getYear(2015),getYear(2016)]);
 const bars=[...a.rows,...b.rows],days=dailyBars(bars);
 const q=quality(b.rows),qd={days:days.length,sample_2016:days.filter(x=>x.date.startsWith('2016')).length,
  incomplete_2016:days.filter(x=>x.date.startsWith('2016')&&x.n<50).map(x=>[x.date,x.n]).slice(0,20)};
 if(q.invalid||q.duplicate||q.chronology_violations)throw Error('Input quality failed '+JSON.stringify(q));
 const strategies=[
  {code:'daily_55_S2_5m_execution',name:'原海龟S2：55交易日突破、20交易日退出、5分钟执行',frame:'daily',enter:55,exit:20},
  {code:'daily_20_S1_like_5m_execution',name:'海龟S1简化：20交易日突破、10交易日退出、5分钟执行',frame:'daily',enter:20,exit:10},
  {code:'m5_55_20_experiment',name:'纯5分钟实验：55根突破、20根退出',frame:'m5',enter:55,exit:20},
  {code:'m5_20_10_experiment',name:'纯5分钟实验：20根突破、10根退出',frame:'m5',enter:20,exit:10}
 ];
 const variants={};
 for(const strat of strategies){
  const standard=run(bars,days,strat,{slippage_per_side:.05,max_spread_usd:5});
  variants[strat.code]=standard;
  console.log('MAIN',strat.code,'trades',standard.trades,'wins',standard.wins,'hit%',standard.win_rate_pct,'return%',standard.return_pct,
   'final',standard.ending_cash_usd,'maxdd%',standard.max_drawdown_pct,'profitFactor',standard.profit_factor,
   'longs',standard.longs,'shorts',standard.shorts,'skippedWide',standard.excluded_wide_spread,'ambiguous',standard.ambiguous_entry_or_samebar_stop_count);
 }
 const sensitivity={};
 for(const strat of strategies){
  sensitivity[strat.code]={};
  for(const config of [
   {name:'zero_spread_zero_slip',slippage_per_side:0,max_spread_usd:999,zero_spread:true},
   {name:'bid_ask_no_slip',slippage_per_side:0,max_spread_usd:5},
   {name:'bid_ask_0_05_each',slippage_per_side:.05,max_spread_usd:5},
   {name:'bid_ask_0_20_each',slippage_per_side:.20,max_spread_usd:5},
  ]){
   let r=run(bars,days,strat,config);
   sensitivity[strat.code][config.name]={trades:r.trades,hit:r.win_rate_pct,return_pct:r.return_pct,maxdd:r.max_drawdown_pct,final:r.ending_cash_usd};
  }
 }
 const output={run_at_utc:new Date().toISOString(),
  status:'XAUUSD_2016_REAL_BID_ASK_5MIN_TURTLE_RESEARCH',
  source:{url_2015:DATA+'2015.json.gz',url_2016:DATA+'2016.json.gz',original_ticks:'Dukascopy historical spot XAUUSD, resampled OHLC bid and ask by EV Trading Labs',
   only_2016_traded:true,bars_2015_warmup_only:true,bars_2015:a.rows.length,bars_2016:b.rows.length,
   compressed_2015:a.compressed_bytes,compressed_2016:b.compressed_bytes,quality_2016:q,daily_coverage:qd},
  methodology:{starting_usd:10000,per_trade_risk:.005,leverage_cap:5,entry_on_five_minute_breakout:true,
   daily_session:'America/New_York 17:00 FX session close, Sunday FX evening grouped with following Monday, NOT certified CME settlement session',
   first_20_or_55_sessions_previous_completed_only:true,
   intraday_20_or_55_candles_previous_complete_only:true,
   N:'Wilder 20-period daily or 5m ATR based on BID OHLC',
   no_pyramiding:true,one_position_max:true,
   stop_N:2,exit:'prior completed 10/20 sessions or 10/20 m5 bars',
   spread:'buy at ask/sell at bid; bid stop for longs, ask stop for shorts',
   same_bar_ambiguous:'if 5m OHLC contains entry and stop, assume adverse stop occurs after entry, may be pessimistic',
   slippage_usd_per_oz_each:.05,
   broker_commissions_financing_swap_tax_and_gap_fill:'NOT INCLUDED; feed not futures and not investor-specific executable orders',
   S1_20day_exclusion_rule:'NOT implemented, this is S1-like simplified channel, NOT full original turtle S1',
   no_pit_issue:'Signal sources are historical prices only, indicator uses strictly earlier closed bars'},
  variants,sensitivity};
 fs.mkdirSync('research-data',{recursive:true});
 const trim=JSON.parse(JSON.stringify(output));
 for(const v of Object.values(trim.variants))delete v.raw_ledger;
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_5M_TURTLE_SUMMARY.json',JSON.stringify(trim,null,2));
 const cols=['code','trades','wins','hit_pct','longs','shorts','ending_cash_usd','return_pct','max_drawdown_pct','profit_factor','max_consecutive_losses','excluded_wide_spread','ambiguous_entry_stop'];
 const csv=[cols.join(',')];for(const [key,v] of Object.entries(variants))csv.push([key,v.trades,v.wins,v.win_rate_pct,v.longs,v.shorts,v.ending_cash_usd,v.return_pct,v.max_drawdown_pct,v.profit_factor,v.max_consecutive_losses,v.excluded_wide_spread,v.ambiguous_entry_or_samebar_stop_count].join(','));
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_5M_TURTLE_SUMMARY.csv',csv.join('\n')+'\n');
 const led=['variant,entry_date,exit_date,side,entry_price,exit_price,pnl_usd,balance_usd,bars_held,reason'];
 for(const [key,v] of Object.entries(variants))for(const x of v.raw_ledger)led.push([key,x.entry_time_utc,x.exit_time_utc,x.side,x.entry_price,x.exit_price,x.pnl_usd,x.balance_usd,x.bars_held,x.reason].join(','));
 fs.writeFileSync('research-data/GOLD_XAUUSD_2016_5M_TURTLE_LEDGER.csv',led.join('\n')+'\n');
 console.log('QUALITY',JSON.stringify({quality:q,daily:qd,year_2015:a.rows.length,year_2016:b.rows.length}));
 console.log('SENS',JSON.stringify(sensitivity));
 console.log('DONE',Object.values(variants).map(x=>({name:x.code,trades:x.trades,net:x.return_pct})));
}
if(require.main===module)main().catch(e=>{console.error('FATAL',e);process.exitCode=1});
module.exports={getYear,quality,dailyBars,getDailyLevels,session};
