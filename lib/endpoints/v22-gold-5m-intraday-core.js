// Exchange-traded Yahoo GC=F 5-minute QUOTE proxy research. NOT exchange authenticated/roll-adjusted fills.
// Pure functions. Every signal uses only COMPLETED candles, enters at NEXT observed five-minute open.
// US NY morning session 08:00-13:00 America/New_York, DST handled by Intl.
const MINUTE=60000,DAY=86400000,TF=5*MINUTE;
const east=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const round=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
function etParts(time){
 const p=Object.fromEntries(east.formatToParts(new Date(time)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute),hour:Number(p.hour)};
}
function clean5m(raw,now=Date.now()){
 const seen=new Set(),out=[],excluded={invalid_ohlc:0,off_grid:0,duplicate:0,unclosed:0},sorting=raw.slice().sort((a,b)=>a.start_ms-b.start_ms);
 for(const x of sorting){
  const t=x.start_ms;
  if(!Number.isFinite(t)||t%TF!==0){excluded.off_grid++;continue}
  if(seen.has(t)){excluded.duplicate++;continue}seen.add(t);
  if(t+TF>now){excluded.unclosed++;continue}
  if(![x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)||
   x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)){excluded.invalid_ohlc++;continue}
  out.push({start_ms:t,close_ms:t+TF,open:x.open,high:x.high,low:x.low,close:x.close,volume:Number.isFinite(x.volume)?x.volume:null});
 }
 const contiguous=new Array(out.length).fill(0),et=out.map(x=>etParts(x.start_ms));
 let gaps=0,largeWeekend=0;
 for(let i=1;i<out.length;i++){
  if(out[i].start_ms-out[i-1].start_ms===TF)contiguous[i]=contiguous[i-1]+1;
  else {gaps++;if(out[i].start_ms-out[i-1].start_ms>=DAY)largeWeekend++}
 }
 return {bars:out,et,contiguous,quality:{raw:raw.length,clean:out.length,excluded,gaps,
  gaps_over_24hours:largeWeekend,first_utc:out.length?new Date(out[0].start_ms).toISOString():null,
  last_closed_utc:out.length?new Date(out.at(-1).close_ms).toISOString():null,
  distinct_NY_dates:new Set(et.map(x=>x.date)).size}};
}
function features(bars,contiguous){
 const n=bars.length,ema20=new Array(n),ema60=new Array(n),atr14=new Array(n),ret=new Array(n).fill(0);
 for(let i=0;i<n;i++){
  const prev=i&&contiguous[i]>0;
  ema20[i]=prev?ema20[i-1]+(bars[i].close-ema20[i-1])*2/21:bars[i].close;
  ema60[i]=prev?ema60[i-1]+(bars[i].close-ema60[i-1])*2/61:bars[i].close;
  let tr=bars[i].high-bars[i].low;
  if(prev)tr=Math.max(tr,Math.abs(bars[i].high-bars[i-1].close),Math.abs(bars[i].low-bars[i-1].close));
  ret[i]=tr;
  if(contiguous[i]>=14){let sum=0;for(let j=i-13;j<=i;j++)sum+=ret[j];atr14[i]=sum/14}
  else atr14[i]=null;
 }
 return {ema20,ema60,atr14};
}
function signals(data){
 const {bars,et,contiguous}=data,f=features(bars,contiguous),labels=[
  'NY_opening_range_30m_breakout','EMA20_EMA60_5m_pullback','prior_12bar_channel_breakout','Bollinger24_2sigma_mean_revert'
 ],all=Object.fromEntries(labels.map(k=>[k,[]])),earlyNY=new Map(),stats={evaluated_close_bars:0,eligible_5m_entry_bars:0};
 // Freeze each day's opening range only from 08:00,08:05,...08:25 ET.
 for(let i=0;i<bars.length;i++){
  const z=et[i];if(z.minute<480||z.minute>=510)continue;
  if(!earlyNY.has(z.date))earlyNY.set(z.date,[]);
  earlyNY.get(z.date).push(i);
 }
 const ranges=new Map();
 for(const [date,indices] of earlyNY){
  if(indices.length!==6||indices.some((j,k)=>et[j].minute!==480+k*5||(k>0&&bars[j].start_ms-bars[indices[k-1]].start_ms!==TF)))continue;
  ranges.set(date,{high:Math.max(...indices.map(j=>bars[j].high)),low:Math.min(...indices.map(j=>bars[j].low))});
 }
 for(let i=80;i<bars.length-1;i++){
  if(contiguous[i]<70)continue;
  const now=et[i],next=et[i+1],b=bars[i],prior=bars[i-1],atr=f.atr14[i];
  if(!Number.isFinite(atr)||atr<=0||next.date!==now.date||next.minute<510||next.minute>=780||bars[i+1].start_ms!==b.close_ms)continue;
  stats.eligible_5m_entry_bars++;
  const long=f.ema20[i]>f.ema60[i],short=f.ema20[i]<f.ema60[i];
  function add(label,direction,riskMult=1.5,targetR=2){
   all[label].push({signal_index:i,entry_index:i+1,dir:direction,signal_closed_at_ms:b.close_ms,
    entry_at_ms:bars[i+1].start_ms,atr5m:atr,stop_width:Math.max(atr*.8,atr*riskMult),
    target_R:targetR,source:'closed_5m',entry_session_date:next.date});
  }
  // Only once on the FIRST 5m close crossing each NY opening-range boundary.
  const range=ranges.get(now.date);
  if(range&&now.minute>=510&&now.minute<720){
   if(b.close>range.high+.15*atr&&prior.close<=range.high+.15*atr)add(labels[0],'long');
   else if(b.close<range.low-.15*atr&&prior.close>=range.low-.15*atr)add(labels[0],'short');
  }
  // EMA pullback across EMA20 with long trend EMA20>EMA60; reject already out-of-trend.
  if(long&&prior.close<=f.ema20[i-1]&&b.close>f.ema20[i]&&b.close>prior.high)add(labels[1],'long');
  else if(short&&prior.close>=f.ema20[i-1]&&b.close<f.ema20[i]&&b.close<prior.low)add(labels[1],'short');
  // Prior 12 complete-bar Donchian channel; no same-bar high/low read as prior range.
  const h=Math.max(...bars.slice(i-12,i).map(x=>x.high)),l=Math.min(...bars.slice(i-12,i).map(x=>x.low));
  if(long&&b.close>h+.15*atr&&prior.close<=h+.15*atr)add(labels[2],'long');
  else if(short&&b.close<l-.15*atr&&prior.close>=l-.15*atr)add(labels[2],'short');
  // Bollinger rebound, using threshold computed from 24 FULLY PREVIOUS closes (past range).
  const old=bars.slice(i-24,i).map(x=>x.close),mid=old.reduce((s,x)=>s+x,0)/old.length;
  const sd=Math.sqrt(old.reduce((s,x)=>s+(x-mid)**2,0)/old.length);
  if(sd>0){
   if(prior.close<mid-2*sd&&b.close>mid-1.7*sd&&b.close>prior.close)add(labels[3],'long',1.5,1.25);
   else if(prior.close>mid+2*sd&&b.close<mid+1.7*sd&&b.close<prior.close)add(labels[3],'short',1.5,1.25);
  }
 }
 stats.evaluated_close_bars=bars.length;
 return {all,technical_indicators:f,opening_range_valid_dates:ranges.size,counts:Object.fromEntries(labels.map(k=>[k,all[k].length])),stats};
}
function maxDD(series,initial){
 let peak=initial,max=0;
 for(const x of series){peak=Math.max(peak,x);if(peak>0)max=Math.max(max,100*(1-x/peak))}
 return round(max,2);
}
function simulator(data,signalList,{initialCash=10000,costBpsRoundTrip=10,riskFraction=.005,maxLeverage=5,
 maxHoldBars=36,maxTradesPerNYDate=3,cooldownBars=6,stopSlippageATR=.1,forcedExitEtMinute=780}={}){
 const {bars,et}=data;
 if(!bars.length||initialCash<=0||costBpsRoundTrip<0||riskFraction<=0||maxLeverage<=0||stopSlippageATR<0)throw Error('Bad simulation inputs');
 const byIndex=new Map();
 for(const x of signalList){if(!Number.isInteger(x.entry_index)||x.entry_index<=x.signal_index||x.entry_at_ms< x.signal_closed_at_ms)throw Error('Future-knowledge 5m event');
  if(!byIndex.has(x.entry_index))byIndex.set(x.entry_index,x);
 }
 const perDate=new Map(),trades=[],curve=[],counts={attempted_signal_entries:signalList.length,max_entries_per_day_blocked:0,cooldown_blocked:0,already_holding_blocked:0,
   ambiguous_same_bar_stop_and_target:0,stop_exits:0,profit_target_exits:0,time_exits:0,session_exits:0,fees_usd:0};
 const feeRate=costBpsRoundTrip/20000;
 let equity=initialCash,pos=null,afterCloseIndex=-Infinity,marketBars=0,entryExposureSum=0;
 for(let i=0;i<bars.length;i++){
  const bar=bars[i],ny=et[i],event=byIndex.get(i);
  if(event){
   if(pos){counts.already_holding_blocked++}
   else if(i-afterCloseIndex<cooldownBars){counts.cooldown_blocked++}
   else if((perDate.get(ny.date)||0)>=maxTradesPerNYDate){counts.max_entries_per_day_blocked++}
   else if(ny.minute>=780||ny.minute<510||event.entry_session_date!==ny.date||event.entry_at_ms!==bar.start_ms){/* skip non-NY morning */}
   else{
    const side=event.dir==='long'?1:-1,stopDist=event.stop_width,qty=Math.min(equity*riskFraction/stopDist,equity*maxLeverage/bar.open);
    if(qty>0&&Number.isFinite(qty)){
     const buyFee=qty*bar.open*feeRate;
     pos={side,qty,price:bar.open,entryIndex:i,entryAt:bar.start_ms,stop:bar.open-side*stopDist,
      take:bar.open+side*stopDist*event.target_R,buyFee,source:event.source,label:event.label||null,atr:event.atr5m,
      date:ny.date,notionalLeverage:qty*bar.open/equity};
     equity-=buyFee;counts.fees_usd+=buyFee;
     perDate.set(ny.date,(perDate.get(ny.date)||0)+1);entryExposureSum+=pos.notionalLeverage;
    }
   }
  }
  if(pos){
   marketBars++;
   const stopHit=pos.side===1?bar.low<=pos.stop:bar.high>=pos.stop;
   const profitHit=pos.side===1?bar.high>=pos.take:bar.low<=pos.take;
   if(stopHit&&profitHit)counts.ambiguous_same_bar_stop_and_target++;
   const isSessionEnd=ny.minute>=forcedExitEtMinute-5||ny.date!==pos.date;
   const isTimed=i-pos.entryIndex+1>=maxHoldBars;
   const endOfData=i===bars.length-1;
   if(stopHit||profitHit||isSessionEnd||isTimed||endOfData){
    let exit,reason;
    if(stopHit){
     // Conservative stop loss: gap-through filled at open or worse stop, plus 0.1x entry ATR impact.
     exit=(pos.side===1?Math.min(pos.stop,bar.open):Math.max(pos.stop,bar.open))-pos.side*stopSlippageATR*pos.atr;reason='stop';
     counts.stop_exits++;
    }else if(profitHit){exit=pos.take;reason='take_profit';counts.profit_target_exits++}
    else{exit=bar.close;reason=isSessionEnd?'NY_session_end':isTimed?'max_5m_bar_hold':'last_valid_bar';if(isSessionEnd)counts.session_exits++;else counts.time_exits++}
    const exitFee=pos.qty*exit*feeRate,net=pos.side*pos.qty*(exit-pos.price)-exitFee-pos.buyFee;
    equity+=pos.side*pos.qty*(exit-pos.price)-exitFee;counts.fees_usd+=exitFee;
    trades.push({entry_utc:new Date(pos.entryAt).toISOString(),exit_utc:new Date(bar.close_ms).toISOString(),
     direction:pos.side>0?'long':'short',exit_reason:reason,pnl_net_usd:round(net,2),
     entry_px:round(pos.price),exit_px:round(exit),entry_qty_oz_fractional_model:round(pos.qty,4),
     stop_at_entry:round(pos.stop),target_at_entry:round(pos.take),entry_leverage:round(pos.notionalLeverage,2),
     input_atr5m:round(pos.atr),gross_pct_for_direction:round(100*pos.side*(exit/pos.price-1),3),
     equity_after_usd:round(equity,2)});
    pos=null;afterCloseIndex=i;
   }
  }
  const marked=equity+(pos?pos.side*pos.qty*(bar.close-pos.price)-pos.qty*bar.close*feeRate:0);
  curve.push(marked);
 }
 const wins=trades.filter(x=>x.pnl_net_usd>0),losses=trades.filter(x=>x.pnl_net_usd<0);
 const pnl=trades.reduce((s,x)=>s+x.pnl_net_usd,0);
 return {initial_usd:initialCash,end_equity_usd:round(equity,2),
  return_pct:round(100*(equity/initialCash-1),2),max_drawdown_pct:maxDD(curve,initialCash),
  executed_trades:trades.length,winning_trades:wins.length,losing_trades:losses.length,
  win_rate_pct:trades.length?round(100*wins.length/trades.length,1):null,
  net_trade_pnl_usd:round(pnl,2),average_pnl_usd:trades.length?round(pnl/trades.length,2):null,
  paid_estimated_roundtrip_fees_usd:round(counts.fees_usd,2),
  market_exposure_bar_pct:round(100*marketBars/bars.length,2),
  mean_entry_notional_leverage:trades.length?round(entryExposureSum/trades.length,2):null,
  engine_counters:counts,trade_ledger:trades};
}
function evaluateIntraday(data,options={}){
 const s=signals(data),out={generated_signal_counts:s.counts,eligible_5m_entry_bars:s.stats.eligible_5m_entry_bars,
  valid_NY_opening_ranges:s.opening_range_valid_dates,strategies:{}};
 for(const [name,list] of Object.entries(s.all)){
  const tagged=list.map(x=>({...x,label:name}));
  out.strategies[name]=simulator(data,tagged,options);
 }
 return out;
}
module.exports={etParts,clean5m,features,signals,simulator,evaluateIntraday,maxDD};
