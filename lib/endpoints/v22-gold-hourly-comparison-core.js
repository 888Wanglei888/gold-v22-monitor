// Research-only GOLD GC=F 1h comparison: B1 Dow weekly+daily plus 4h confirm;
// B2 same Dow higher frames plus 1h breakout+1h confirmation;
// B3 ONLY B1-qualified 4h signals, enter using first 4 1h bars' LIMIT retest.
// Three schemes share 1h OHLC stop/time simulation, same 1.5x REAL 4h ATR
// stop, identical 0.5%-equity risk, 5x cap, next available 1h OHLC and costs.
// All original 4h trends are conservative completed 4h-derived DAILY/WEEKLY proxies.
const {closedHigherFrames,classify}=require('./v22-dow-proxy-core');
const {scan}=require('./v22-price-pattern-core');
const {atr:aTR}=require('./v22-execution-core');
const ONE=3600000,round=(v,n=3)=>Number.isFinite(v)?+v.toFixed(n):null;
function prepareHourly(raw,cutoffMs){
 const audit={raw:raw.length,invalid:0,unclosed:0,off_grid:0,duplicates:0,gaps_over_1h:0};
 const seen=new Set(),bars=[];
 for(const r of raw.slice().sort((a,b)=>a.start_ms-b.start_ms)){
  const t=r.start_ms;
  if(!Number.isFinite(t)||t%ONE!==0){audit.off_grid++;continue}
  if(seen.has(t)){audit.duplicates++;continue}
  seen.add(t);
  if(t+ONE>cutoffMs){audit.unclosed++;continue}
  if(![r.open,r.high,r.low,r.close].every(x=>Number.isFinite(x)&&x>0)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)){audit.invalid++;continue}
  bars.push({start_ms:t,close_ms:t+ONE,open:r.open,high:r.high,low:r.low,close:r.close});
 }
 for(let i=1;i<bars.length;i++)if(bars[i].start_ms!==bars[i-1].close_ms)audit.gaps_over_1h++;
 return {bars,audit};
}
function beforeOrAt4h(bars,at){
 let low=0,high=bars.length;
 while(low<high){const m=(low+high)>>1;if(bars[m].close_ms<=at)low=m+1;else high=m}
 return low-1;
}
function locateHourly(bars,time){
 let lo=0,hi=bars.length;
 while(lo<hi){const m=(lo+hi)>>1;if(bars[m].start_ms<time)lo=m+1;else hi=m}
 return lo<bars.length&&bars[lo].start_ms===time?lo:-1;
}
function countedATR1h(bars,index,period=14){
 if(index<period)return null;
 for(let j=index-period+1;j<=index;j++){
  if(j<=0||bars[j].start_ms!==bars[j-1].close_ms)return null;
 }
 return aTR(bars,index,period);
}
function signals4h({hourly,four,startMs}){
 const dow=closedHigherFrames(four);
 const patterns=scan(four,{lookback:20,atr_period:14,breakout_atr:.25,include_all_candidates:true}).confirmed_candidates;
 const candidates=[],counts={raw_patterns:patterns.length,not_trending:0,entry_1h_missing:0,old_signal:0,accepted:0};
 for(const p of patterns){
  const authorized=Date.parse(p.earliest_hypothetical_entry_open_utc),confirm=Date.parse(p.confirmation_closed_utc);
  if(authorized<startMs){counts.old_signal++;continue}
  const chosen=classify(dow,confirm);
  if(chosen.agreed_direction!==p.direction){counts.not_trending++;continue}
  const idx=locateHourly(hourly,authorized);
  if(idx<0||hourly[idx].start_ms-confirm>ONE*30){counts.entry_1h_missing++;continue}
  candidates.push({entry_index:idx,entry_utc:new Date(authorized).toISOString(),
   known_at_ms:confirm,dir:p.direction,signal_type:'B1_4h_confirmed',
   stop_width:1.5*p.atr_14_4h,atr4:p.atr_14_4h,atr1:null,
   original_confirmed_at_utc:p.confirmation_closed_utc,
   market_entry:true,limit_entry:false,trend_verified_prior:true});
  counts.accepted++;
 }
 return {candidates,counts,higher:dow};
}
function signals1h({hourly,four,higher,startMs,lookbackHours=12,confirmThresholdATR=.25}){
 if(lookbackHours<5||lookbackHours>150)throw Error('Invalid one-hour breakout lookback');
 const events=[],counts={hourly_breakout_seen:0,confirmed_1h:0,confirmed_higher_timeframe:0,
  missing_closed_4h_ATR:0,weekend_or_hourly_gap:0,candidates_after_start:0};
 for(let i=Math.max(lookbackHours,16);i<hourly.length-2;i++){
  const b=hourly[i],prior=hourly.slice(i-lookbackHours,i),confirm=hourly[i+1],next=hourly[i+2];
  if(next.start_ms<startMs)continue;
  // The entire previous channel and confirmation bars must be continuous to make
  // 1h vs 4h comparisons meaningful. No stop events manufactured across missing hours.
  if(prior.some((x,j)=>j>0&&x.start_ms!==prior[j-1].close_ms)||
     b.start_ms!==prior.at(-1).close_ms||confirm.start_ms!==b.close_ms||next.start_ms!==confirm.close_ms){counts.weekend_or_hourly_gap++;continue}
  const a=countedATR1h(hourly,i-1,14);
  if(!(a>0))continue;
  const high=Math.max(...prior.map(x=>x.high)),low=Math.min(...prior.map(x=>x.low));
  const dir=b.close>high+confirmThresholdATR*a?'long':b.close<low-confirmThresholdATR*a?'short':null;
  if(!dir)continue;
  counts.hourly_breakout_seen++;
  const confirmed=dir==='long'?confirm.close>high:confirm.close<low;
  if(!confirmed)continue;
  counts.confirmed_1h++;
  const trend=classify(higher,confirm.close_ms);
  if(trend.agreed_direction!==dir)continue;
  counts.confirmed_higher_timeframe++;
  const at4=beforeOrAt4h(four,confirm.close_ms);
  if(at4<14){counts.missing_closed_4h_ATR++;continue}
  const last4=four[at4];
  if(confirm.close_ms-last4.close_ms>12*ONE){counts.missing_closed_4h_ATR++;continue}
  const a4=aTR(four,at4,14);
  if(!(a4>0)){counts.missing_closed_4h_ATR++;continue}
  events.push({entry_index:i+2,entry_utc:new Date(next.start_ms).toISOString(),
   known_at_ms:confirm.close_ms,dir,signal_type:'B2_1h_breakout_1h_confirmed',
   stop_width:1.5*a4,atr4:a4,atr1:a,original_confirmed_at_utc:new Date(confirm.close_ms).toISOString(),
   market_entry:true,limit_entry:false,trend_verified_prior:true});
  counts.candidates_after_start++;
 }
 return {candidates:events,counts,breakoutLookbackHours:lookbackHours};
}
function make1hRetest({b1Events,hourly,waitHours=4,limitFracATR1=.35}){
 if(waitHours<1||waitHours>8||limitFracATR1<0||limitFracATR1>2)throw Error('Invalid B3 fixed limit rules');
 const events=[],audit={b1_qualified_events:b1Events.length,valid_preentry_1h_ATR:0,missing_preentry_ATR:0};
 for(const s of b1Events){
  const i=s.entry_index,prev=i-1;
  if(prev<14||hourly[i].start_ms!==hourly[prev].close_ms){audit.missing_preentry_ATR++;continue}
  const a=countedATR1h(hourly,prev);
  if(!Number.isFinite(a)||a<=0){audit.missing_preentry_ATR++;continue}
  const side=s.dir==='long'?1:-1;
  const limit=hourly[i].open-side*limitFracATR1*a;
  events.push({...s,signal_type:'B3_4h_confirmed_wait_1h_retest',
   atr1:a,market_entry:false,limit_entry:true,limit_px:limit,
   wait_bars:waitHours,first_authorized_index:i,limit_decided_from_first_1h_open:true});
  audit.valid_preentry_1h_ATR++;
 }
 return {candidates:events,audit};
}
function drawdown(path,init){
 let peak=init,max=0;
 for(const v of path){peak=Math.max(peak,v);if(peak>0)max=Math.max(max,100*(peak-v)/peak)}
 return round(max,2);
}
function simulate(hourly,events,{startMs,initialCash=10000,riskFraction=.005,maxLeverage=5,
 stopDurationHours=60,costBps=10,stopSlippageATR1=0,maxTradesPerNYDay=null}={}){
 if(!hourly.length||!Number.isFinite(startMs)||initialCash<=0||riskFraction<=0||maxLeverage<=0||stopDurationHours<1||costBps<0||stopSlippageATR1<0)throw Error('Invalid 1h research simulation');
 const signals=events.slice().sort((a,b)=>a.entry_index-b.entry_index||a.known_at_ms-b.known_at_ms);
 const schedule=new Map();for(const e of signals)if(!schedule.has(e.entry_index))schedule.set(e.entry_index,e);
 const cost=costBps/20000;
 let cash=initialCash,pos=null,pending=null,barsWithExposure=0;
 const tr=[],curve=[],counts={eligible_signal_events:events.length,scheduled_entries:schedule.size,
  rejected_holding:0,rejected_pending:0,rejected_bad_entry:0,unfilled_limit_expirations:0,
  limit_filled:0,market_filled:0,forced_end:0,stop_exits:0,time_exits:0};
 const startIdx=hourly.findIndex(x=>x.start_ms>=startMs);if(startIdx<0)throw Error('Sample start absent from hourly data');
 function open(s,atIndex,price,isLimit){
  const entryBar=hourly[atIndex],side=s.dir==='long'?1:-1;
  if(!(price>0&&Number.isFinite(s.stop_width)&&s.stop_width>0&&price>s.stop_width)){
   counts.rejected_bad_entry++;return false}
  const cashBefore=cash;
  const qty=Math.min(cashBefore*riskFraction/s.stop_width,cashBefore*maxLeverage/price);
  if(!(qty>0)){counts.rejected_bad_entry++;return false}
  const fee=qty*price*cost;cash-=fee;
  pos={s,side,price,qty,stop:price-side*s.stop_width,openedIndex:atIndex,
   openedMs:entryBar.start_ms,feeEntry:fee,isLimit,remainingHourBars:stopDurationHours,
   capitalAtOpen:cashBefore};
  if(isLimit)counts.limit_filled++;else counts.market_filled++;
  return true;
 }
 for(let i=startIdx;i<hourly.length;i++){
  const b=hourly[i],candidate=schedule.get(i);
  if(candidate){
   if(pos){counts.rejected_holding++}
   else if(pending){counts.rejected_pending++}
   else if(candidate.known_at_ms>b.start_ms){throw Error('Entry authorization cannot be after executable hour')}
   else if(candidate.limit_entry){
    pending={...candidate,expires_index:i+candidate.wait_bars-1};
   }else open(candidate,i,b.open,false);
  }
  if(pending&&!pos){
   const sign=pending.dir==='long'?1:-1;
   const hit=sign===1?b.low<=pending.limit_px:b.high>=pending.limit_px;
   if(i>pending.expires_index||i>=hourly.length-1){
    counts.unfilled_limit_expirations++;pending=null;
   }else if(hit){
    // Assumed fill at predetermined LIMIT, no quote-range price improvement.
    // Intrabar stop must be conservatively evaluated on the same fill hour.
    const event=pending;pending=null;open(event,i,event.limit_px,true);
   }else if(i===pending.expires_index){
    counts.unfilled_limit_expirations++;pending=null;
   }
  }
  if(pos){
   barsWithExposure++;const {side}=pos;
   const stopHit=side===1?b.low<=pos.stop:b.high>=pos.stop;
   const last=i===hourly.length-1,held=i-pos.openedIndex+1>=pos.remainingHourBars;
   if(stopHit||held||last){
    let exitPx=stopHit?(side===1?Math.min(pos.stop,b.open):Math.max(pos.stop,b.open)):b.close;
    if(stopHit&&stopSlippageATR1>0&&Number.isFinite(pos.s.atr1)){
     exitPx-=side*stopSlippageATR1*pos.s.atr1;
    }
    const feeOut=pos.qty*exitPx*cost,pl=side*pos.qty*(exitPx-pos.price)-pos.feeEntry-feeOut;
    cash+=side*pos.qty*(exitPx-pos.price)-feeOut;
    const reason=stopHit?'stop_first_touch_or_worse_gap':last?'last_observed_hour':"max_60_observed_1h_bars";
    if(stopHit)counts.stop_exits++;else if(last)counts.forced_end++;else counts.time_exits++;
    tr.push({strategy_event:pos.s.signal_type,side:side===1?'long':'short',
     original_signal_known_utc:new Date(pos.s.known_at_ms).toISOString(),
     entry_utc:new Date(pos.openedMs).toISOString(),exit_utc:new Date(b.close_ms).toISOString(),
     entry_px:round(pos.price),exit_px:round(exitPx),stop_at_entry:round(pos.stop),
     stop_width_from_prior_complete_4h_ATR:round(pos.s.stop_width),prior_4h_ATR:round(pos.s.atr4),
     prior_1h_ATR:Number.isFinite(pos.s.atr1)?round(pos.s.atr1):null,
     entry_mode:pos.isLimit?'precommitted_1h_limit_retest':'next_1h_market_open',
     pnl_after_costs_usd:round(pl,2),equity_after_usd:round(cash,2),
     fees_usd:round(pos.feeEntry+feeOut,2),why_closed:reason,
     simulated_fractional_oz:round(pos.qty,4),notional_leverage_at_entry:round(pos.qty*pos.price/pos.capitalAtOpen,2)});
    pos=null;
   }
  }
  const mark=cash+(pos?pos.side*pos.qty*(b.close-pos.price)-pos.qty*b.close*cost:0);
  curve.push(mark);
 }
 const wins=tr.filter(x=>x.pnl_after_costs_usd>0),end=cash;
 const years={},track=tr.map(x=>({...x,year:new Date(x.entry_utc).getUTCFullYear()}));
 for(const t of track){const y=String(t.year);if(!years[y])years[y]={trades:0,wins:0,net_pnl_usd:0};
  years[y].trades++;if(t.pnl_after_costs_usd>0)years[y].wins++;years[y].net_pnl_usd+=t.pnl_after_costs_usd}
 for(const t of Object.values(years)){t.net_pnl_usd=round(t.net_pnl_usd,2);t.win_rate_pct=round(100*t.wins/t.trades,1)}
 return {trades:tr.length,winners:wins.length,win_rate_pct:tr.length?round(100*wins.length/tr.length,1):null,
  return_pct:round(100*(end/initialCash-1),2),final_usd:round(end,2),
  max_mark_to_market_drawdown_pct:drawdown([initialCash,...curve],initialCash),
  exposure_hour_pct:round(100*barsWithExposure/(hourly.length-startIdx),2),
  average_trade_pnl_usd:tr.length?round(tr.reduce((a,b)=>a+b.pnl_after_costs_usd,0)/tr.length,2):null,
  cost_bps_roundtrip:costBps,
  counts,by_entry_year:years,trade_ledger:tr};
}
function runThreeWay({hourly,four,startDate='2025-06-02',costBps=10,lookbackHours=12}){
 const startMs=Date.parse(startDate+'T00:00:00Z');
 const b1=signals4h({hourly,four,startMs});
 const b2=signals1h({hourly,four,higher:b1.higher,startMs,lookbackHours});
 const b3=make1hRetest({b1Events:b1.candidates,hourly,waitHours:4,limitFracATR1:.35});
 const options={startMs,costBps,initialCash:10000,riskFraction:.005,maxLeverage:5,stopDurationHours:60};
 return {status:'1h_three_way_common_hourly_fill_research',
  fixed_rules:{B1:'Original Dow daily+weekly and 4h breakout/confirmation; authorized next 4h open simulated in hourly data',
   B2:'Same completed Dow daily+weekly structure and 12 PRIOR continuous 1h breakout+next 1h confirmation; enter third 1h OPEN',
   B3:'Only B1 authorized 4h entries; fixed 0.35 prior-closed ATR1h limit from next 4h open; expire after four 1h bars without execution',
   same_funding:'10000 USD',risk_per_trade_pct:.5,stop_distance:'1.5x last completed 4h ATR for ALL three',time_exit:'60 observed 1h bars after entry',
   cost_bps_round_trip:costBps,orders:'synthetic fractional gold not actual COMEX integer contract lots',
   position_limit:'one open trade per strategy, no overlapping active exposure',drawdown:'hourly marked to market'},
  candidates:{B1:b1.counts,B2:b2.counts,B3:b3.audit},
  result:{B1_4h_rules_1h_execution:simulate(hourly,b1.candidates,options),
   B2_dow_plus_1h_breakout:simulate(hourly,b2.candidates,options),
   B3_confirmed_4h_plus_1h_limit_retest:simulate(hourly,b3.candidates,options)}};
}
module.exports={prepareHourly,signals4h,signals1h,make1hRetest,simulate,runThreeWay,countedATR1h,locateHourly};
