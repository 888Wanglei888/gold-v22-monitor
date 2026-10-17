// Educational, comparable single-market gold proxy backtest.
// Three DIFFERENT systems: Turtle S2, Raschke Holy Grail deterministic approximation,
// and an EXPLICITLY NOT AUTHENTIC Druckenmiller-style 10Y real-yield+USD macro regime.
// No sample-selected thresholds; current-vintage rates lag 3 days, dollar 2 days.
const fs=require('node:fs');
const iso=x=>new Date(x).toISOString().slice(0,10),ms=x=>Date.parse(x+'T00:00:00Z'),DAY=86400000;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(x,n=3)=>Number.isFinite(x)?+x.toFixed(n):null;
const sgn=x=>x>0?1:x<0?-1:0;
async function prices(symbol){
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1=1514764800&period2=1792252800&interval=1d';
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Yahoo '+symbol+' HTTP '+r.status);
 const j=(await r.json()).chart?.result?.[0],q=j?.indicators?.quote?.[0];if(!q)throw Error('Yahoo '+symbol+' empty');
 return j.timestamp.map((v,i)=>({date:iso(v*1000),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i],vol:q.volume[i]}))
 .filter(x=>[x.o,x.h,x.l,x.c].every(z=>Number.isFinite(z)&&z>0)&&x.h>=Math.max(x.o,x.c)&&x.l<=Math.min(x.o,x.c)).sort((a,b)=>a.date.localeCompare(b.date));
}
async function fred(id){let r=await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd=2018-01-01',{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(id+' '+r.status);
 return (await r.text()).split(/\r?\n/).slice(1).map(s=>s.replaceAll('"','').trim().split(',')).filter(x=>x.length===2&&x[1]!=='.'&&x[1]!==''&&Number.isFinite(+x[1])).map(x=>({date:x[0],val:+x[1],avail:ms(x[0])+3*DAY}));}
function indicators(p){
 let atr=Array(p.length).fill(null),ema=Array(p.length).fill(null),adx=Array(p.length).fill(null),pdi=Array(p.length).fill(null),mdi=Array(p.length).fill(null),ema100=Array(p.length).fill(null);
 let tr=[],pl=[],mi=[];
 for(let i=0;i<p.length;i++){
  let x=p[i],prev=p[i-1];
  tr[i]=prev?Math.max(x.h-x.l,Math.abs(x.h-prev.c),Math.abs(x.l-prev.c)):x.h-x.l;
  pl[i]=prev?(x.h-prev.h>prev.l-x.l&&x.h>prev.h?x.h-prev.h:0):0;
  mi[i]=prev?(prev.l-x.l>x.h-prev.h&&x.l<prev.l?prev.l-x.l:0):0;
  ema[i]=i===0?x.c:ema[i-1]+2/(20+1)*(x.c-ema[i-1]);
  ema100[i]=i===0?x.c:ema100[i-1]+2/(100+1)*(x.c-ema100[i-1]);
  if(i===19)atr[i]=mean(tr.slice(0,20));
  else if(i>19)atr[i]=(19*atr[i-1]+tr[i])/20;
 }
 let st=0,sp=0,sm=0,ddx=[];
 for(let i=1;i<p.length;i++){
  if(i<=14){st+=tr[i];sp+=pl[i];sm+=mi[i]}
  else{st=st-st/14+tr[i];sp=sp-sp/14+pl[i];sm=sm-sm/14+mi[i]}
  if(i<14)continue;
  pdi[i]=st?100*sp/st:0;mdi[i]=st?100*sm/st:0;
  const denom=pdi[i]+mdi[i];
  const dx=denom?100*Math.abs(pdi[i]-mdi[i])/denom:0;
  ddx[i]=dx;
  if(i===27)adx[i]=mean(ddx.slice(14,28));
  else if(i>27)adx[i]=(13*adx[i-1]+dx)/14;
 }
 return {atr,ema,ema100,adx,pdi,mdi};
}
const within=(d,a,b)=>d>=a&&d<=b;
function closest(rows,t,age=12){
 let lo=0,hi=rows.length;while(lo<hi){let m=(lo+hi)>>1;if(rows[m].avail<=t)lo=m+1;else hi=m}
 let idx=lo-1;return idx>=20&&t-ms(rows[idx].date)<=age*DAY?{v:rows[idx].val,prior:rows[idx-20].val,date:rows[idx].date}:null;
}
function buildMacro(p,real,dollar,ind){
 // Use prior-close knowledge only. Dollar market closes delayed by two calendar days.
 const drows=dollar.map(x=>({date:x.date,val:x.c,avail:ms(x.date)+2*DAY}));
 const flags=[];
 for(let i=0;i<p.length;i++){
  const t=ms(p[i].date)+DAY-1;
  const a=closest(real,t),b=closest(drows,t);
  let side=0;if(a&&b&&i>=100){
   if(a.v<a.prior&&b.v<b.prior&&p[i].c>ind.ema100[i])side=1;
   else if(a.v>a.prior&&b.v>b.prior&&p[i].c<ind.ema100[i])side=-1;
  }
  flags.push({side,real:a?.v??null,dollar:b?.v??null,latest_real_date:a?.date,latest_dollar_date:b?.date});
 }
 return flags;
}
function stopFill(p,bar,level){return p.side===1?Math.min(bar.o,level):Math.max(bar.o,level)}
function simulate(p,ind,macro,kind,period,cost=10){
 const cashStart=10000,fee=cost/20000,start=p.findIndex(x=>x.date>=period.from),end=p.findLastIndex(x=>x.date<=period.to);
 if(start<100||end<=start)throw Error('Data too short '+JSON.stringify(period));
 let cash=cashStart,pos=null,trades=[],equity=[],barsIn=0,entryEvents=0,rejected=0;
 const turnProfit=(price,why,i)=>{
  const gross=pos.side*pos.qty*(price-pos.entry),exitFee=pos.qty*price*fee;
  cash+=gross-exitFee;
  const pnl=gross-pos.entryFee-exitFee,held=i-pos.entryIndex+1;
  trades.push({entry_date:pos.entryDate,exit_date:p[i].date,side:pos.side,entry:round(pos.entry),exit:round(price),stop_initial:round(pos.initStop),reason:why,
    pnl_usd:round(pnl,2),equity_after_usd:round(cash,2),bars_held:held,
    entered_after_signal_date:pos.signalDate});
  pos=null;
 };
 const entry=(i,side,at,stop,target,signalDate)=>{
  const dist=side*(at-stop);
  if(!(dist>0&&Number.isFinite(dist))){rejected++;return}
  const capital=Math.max(cash,0),qty=Math.min(capital*.005/(dist+at*2*fee),capital*5/at);
  if(!(qty>0)){rejected++;return}
  const entryFee=qty*at*fee;
  cash-=entryFee;
  pos={side,qty,entry:at,stop,initStop:stop,target,entryFee,entryDate:p[i].date,entryIndex:i,signalDate};
  entryEvents++;
 };
 const maxhi=(i,n)=>Math.max(...p.slice(i-n,i).map(x=>x.h));
 const minlo=(i,n)=>Math.min(...p.slice(i-n,i).map(x=>x.l));
 const touch=(bar,lev,side)=>side===1?bar.h>=lev:bar.l<=lev;
 const trigger=(bar,lev,side)=>side===1?Math.max(bar.o,lev):Math.min(bar.o,lev);
 const adxStrong=(i)=>{for(let k=Math.max(28,i-10);k<i;k++)if(ind.adx[k]>30&&ind.adx[k]>ind.adx[k-1])return true;return false};
 for(let i=start;i<=end;i++){
  const bar=p[i];let closedToday=false;
  if(pos){
   barsIn++;
   const stopHit=pos.side===1?bar.l<=pos.stop:bar.h>=pos.stop;
   const timed=(kind==='raschke'&&i-pos.entryIndex>=12)||(kind==='macro'&&i-pos.entryIndex>=35);
   const channel=(kind==='turtle')&&i>=20?(pos.side===1?minlo(i,20):maxhi(i,20)):null;
   const channelHit=channel!=null&&(pos.side===1?bar.l<=channel:bar.h>=channel);
   const targetHit=pos.target!=null&&touch(bar,pos.target,pos.side);
   const macroExpired=(kind==='macro'&&macro[i-1]?.side!==pos.side);
   if(macroExpired){turnProfit(bar.o,'macro_regime_exit_next_open',i);closedToday=true}
   else if(stopHit){turnProfit(stopFill(pos,bar,pos.stop),'stop_or_worse_gap',i);closedToday=true}
   else if(channelHit){turnProfit(stopFill(pos,bar,channel),'turtle_20d_opposite_channel',i);closedToday=true}
   else if(targetHit){const exit=pos.side===1?Math.max(bar.o,pos.target):Math.min(bar.o,pos.target);turnProfit(exit,'raschke_prior_swing_target',i);closedToday=true}
   else if(timed){turnProfit(bar.c,'max_holding_days',i);closedToday=true}
  }
  if(!pos&&!closedToday&&i>80){
   if(kind==='turtle'){
    const high=maxhi(i,55),low=minlo(i,55),longHit=bar.h>=high,shortHit=bar.l<=low;
    if(longHit&&shortHit)rejected++;
    else if(longHit||shortHit){
     const side=longHit?1:-1,atr=ind.atr[i-1],price=trigger(bar,side===1?high:low,side);
     entry(i,side,price,price-side*2*atr,null,p[i-1].date);
    }
   } else if(kind==='raschke'){
    const s=i-1,ema=ind.ema[s],adx=ind.adx[s],atr=ind.atr[s];
    const touches=p[s].l<=ema&&p[s].h>=ema;
    const strong=adxStrong(s+1),up=ind.pdi[s]>ind.mdi[s]&&ind.ema[s]>ind.ema[s-5],down=ind.pdi[s]<ind.mdi[s]&&ind.ema[s]<ind.ema[s-5];
    const setupSide=strong&&touches?(up?1:down?-1:0):0;
    if(setupSide!==0){
     const level=setupSide===1?p[s].h:p[s].l;
     if(touch(bar,level,setupSide)){
      const price=trigger(bar,level,setupSide),stop=setupSide===1?p[s].l-.1*atr:p[s].h+.1*atr;
      const distance=setupSide*(price-stop);
      const priorSwing=setupSide===1?maxhi(i,20):minlo(i,20);
      const target=setupSide===1?Math.max(priorSwing,price+distance):Math.min(priorSwing,price-distance);
      entry(i,setupSide,price,stop,target,p[s].date);
     }
    }
   } else if(kind==='macro'){
    const side=macro[i-1]?.side||0,atr=ind.atr[i-1];
    if(side&&Number.isFinite(atr))entry(i,side,bar.o,bar.o-side*2*atr,null,p[i-1].date);
   }
   if(pos){
    // When entry and stop (or target) share an OHLC candle, pessimistically assume stop first;
    // this overstates losses if stop was crossed BEFORE entry and cannot be disambiguated.
    const stopHit=pos.side===1?bar.l<=pos.stop:bar.h>=pos.stop;
    const targetHit=pos.target!=null&&touch(bar,pos.target,pos.side);
    if(stopHit){turnProfit(stopFill(pos,bar,pos.stop),'entry_day_ambiguous_assume_stop',i)}
    else if(targetHit){turnProfit(pos.target,'entry_day_target_after_entry_assumed',i)}
   }
  }
  const mark=cash+(pos?pos.side*pos.qty*(bar.c-pos.entry)-pos.qty*bar.c*fee:0);
  equity.push({date:bar.date,equity:mark,pos:!!pos});
 }
 if(pos){turnProfit(p[end].c,'forced_last_close',end);equity[equity.length-1].equity=cash}
 let peak=cashStart,maxdd=0;
 for(const e of equity){peak=Math.max(e.equity,peak);maxdd=Math.max(maxdd,100*(1-e.equity/peak))}
 const wins=trades.filter(x=>x.pnl_usd>0),losses=trades.filter(x=>x.pnl_usd<0),sum=a=>a.reduce((s,x)=>s+x.pnl_usd,0);
 const final=cash,avgwin=mean(wins.map(x=>x.pnl_usd)),avgloss=mean(losses.map(x=>x.pnl_usd));
 const annual={},group={};for(const v of equity){const year=v.date.slice(0,4);(group[year]??=[]).push(v)}
 let prev=cashStart;for(const [y,vals] of Object.entries(group)){annual[y]={return_pct:round(100*(vals.at(-1).equity/prev-1),2),end_usd:round(vals.at(-1).equity,2),trades_exited:trades.filter(x=>x.exit_date.slice(0,4)===y).length};prev=vals.at(-1).equity}
 return {type:kind,period:period.label,from:p[start].date,to:p[end].date,initial_usd:cashStart,final_usd:round(final,2),total_return_pct:round(100*(final/cashStart-1),2),max_drawdown_pct:round(maxdd,2),
  trades:trades.length,wins:wins.length,win_rate_pct:trades.length?round(100*wins.length/trades.length,1):null,longs:trades.filter(x=>x.side===1).length,shorts:trades.filter(x=>x.side===-1).length,
  gross_profit_usd:round(sum(wins),2),gross_loss_usd:round(sum(losses),2),profit_factor:losses.length&&sum(losses)!==0?round(sum(wins)/-sum(losses)):null,
  avg_win_usd:round(avgwin,2),avg_loss_usd:round(avgloss,2),avg_holding_days:round(mean(trades.map(x=>x.bars_held)),1),
  bar_exposure_pct:round(100*barsIn/(end-start+1),1),entries:entryEvents,ambiguous_or_invalid_skips:rejected,annual,ledger:trades};
}
async function main(){
 const [p,real,dollar,gld]=await Promise.all([prices('GC=F'),fred('DFII10'),prices('DX-Y.NYB'),prices('GLD')]);
 const ind=indicators(p),macro=buildMacro(p,real,dollar,ind);
 const periods=[{label:'full_2019_2026',from:'2019-01-02',to:'2026-10-16'},
  {label:'early_2019_2022',from:'2019-01-02',to:'2022-12-30'},
  {label:'middle_2023_2024',from:'2023-01-03',to:'2024-12-31'},
  {label:'late_2025_2026',from:'2025-01-02',to:'2026-10-16'},
  {label:'year_2025',from:'2025-01-02',to:'2025-12-31'},
  {label:'year_2026',from:'2026-01-02',to:'2026-10-16'}];
 const results={};for(const k of ['turtle','raschke','macro']){results[k]={};for(const per of periods)results[k][per.label]=simulate(p,ind,macro,k,per,10)}
 const sensitivity={};for(const k of ['turtle','raschke','macro'])sensitivity[k]=Object.fromEntries([0,10,20,35].map(v=>[v,simulate(p,ind,macro,k,periods[0],v)]));
 let first=p.findIndex(x=>x.date>=periods[0].from),last=p.findLastIndex(x=>x.date<=periods[0].to);
 const hold=100*(p[last].c/p[first].o-1)-.1;
 const output={created_at:new Date().toISOString(),status:'educational_three_schools_gold_daily_research_only',
  data:{gold:'Yahoo GC=F continuous nearest gold futures 2018-2026 daily OHLC',macro_real_yield:'FRED DFII10 observed daily, delayed 3 calendar days',macro_dxy:'Yahoo DX-Y.NYB delayed 2 calendar days',
    gld_cross_price_available:gld.length,gold_rows:p.length,first_gold:p[0].date,last_gold:p.at(-1).date,real_rows:real.length,dxy_rows:dollar.length,
    yahoo_2018_2019_roll_volume_quality_warning:true},
  design:{same_initial_cash_usd:10000,same_risk_fraction_per_entry:.005,same_max_nominal_leverage:5,
    same_roundtrip_cost_bps:10,same_gold_OHLC:true,conservative_entry_bar_stop_priority:true,assumed_fractional_futures_units:true,
    macro_proxy_not_druckenmiller_authentic:true,turtle_S2_no_pyramiding:true,raschke_discretionary_strategy_simplified:true,
    all_rules_predefined_before_results_observed:true,not_certified_pit_macro_vintages:true,no_contract_roll_or_actual_micro_fills:true},
  rulebook:{
    turtle:'S2 enter intraday at prior 55day high/low, 20-day ATR N, 2N stop, opposite 20day channel exit, no pyramiding (different from original full turtle)',
    raschke:'Holy Grail approximation: ADX14>30 and rising at least once past10 bars, EMA20 slope+DI direction, prior bar touches EMA, next bar penetrates setup high/low, stop setup bar beyond 0.1 ATR, target previous20day extreme or at least 1R, max12 trading days; one setup day next day only',
    macro:'Educational macro regime proxy, NOT Druckenmiller: 10Y real yield and DXY each past20 available observations trend same direction; price aligned with EMA100; enter next open, initial 2ATR20 stop, exit if macro price regime loses alignment at following open or max35 days'},
  buy_and_hold_gold_2019_2026_pct:round(hold,2),results,cost_sensitivity_summary:Object.fromEntries(Object.entries(sensitivity).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([fee,z])=>[fee,{return_pct:z.total_return_pct,trades:z.trades,max_drawdown_pct:z.max_drawdown_pct}]))]))};
 fs.mkdirSync('research-data',{recursive:true});
 fs.writeFileSync('research-data/GOLD_THREE_SCHOOLS_2019_2026_RESEARCH.json',JSON.stringify(output,null,2));
 const col=['method','window','trades','wins','win_rate_pct','longs','shorts','final_usd','net_return_pct','max_drawdown_pct','profit_factor','avg_win_usd','avg_loss_usd','avg_hold_days','time_exposure_pct'];
 const csv=[col.join(',')];for(const [k,v] of Object.entries(results))for(const [period,x] of Object.entries(v))
 csv.push([k,period,x.trades,x.wins,x.win_rate_pct,x.longs,x.shorts,x.final_usd,x.total_return_pct,x.max_drawdown_pct,x.profit_factor,x.avg_win_usd,x.avg_loss_usd,x.avg_holding_days,x.bar_exposure_pct].join(','));
 fs.writeFileSync('research-data/GOLD_THREE_SCHOOLS_2019_2026_RESULTS.csv',csv.join('\n')+'\n');
 let trades=['method,window,entry_date,exit_date,side,entry_price,exit_price,pnl_usd,equity_after_usd,holding_days,reason'];
 for(const [k,v] of Object.entries(results))for(const period of ['full_2019_2026','year_2025','year_2026'])for(const x of v[period].ledger)
 trades.push([k,period,x.entry_date,x.exit_date,x.side,x.entry,x.exit,x.pnl_usd,x.equity_after_usd,x.bars_held,x.reason].join(','));
 fs.writeFileSync('research-data/GOLD_THREE_SCHOOLS_TRADE_LEDGER.csv',trades.join('\n')+'\n');
 console.log('COVERAGE',JSON.stringify(output.data),'HOLD',hold);
 for(const [k,v] of Object.entries(results))for(const [period,x] of Object.entries(v))console.log('RESULT',k,period,x.trades,x.wins,x.win_rate_pct,x.total_return_pct,x.final_usd,x.max_drawdown_pct,x.profit_factor,x.longs,x.shorts,'annual',JSON.stringify(x.annual));
 console.log('COST',JSON.stringify(output.cost_sensitivity_summary));
}
main().catch(e=>{console.error('RESEARCH_FATAL',e);process.exitCode=1});
