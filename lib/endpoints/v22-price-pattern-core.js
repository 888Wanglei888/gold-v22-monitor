// Research-only Dow-compatible 4-hour breakout screening.
// Detects CLOSED candle breakouts and subsequent confirmation, never trades on confirmation close.
const {atr}=require('./v22-execution-core');
function scan(candles,settings={lookback:20,atr_period:14,breakout_atr:.25}){
 const cfg={lookback:settings.lookback??20,atr_period:settings.atr_period??14,breakout_atr:settings.breakout_atr??.25};
 if(cfg.lookback<5||cfg.atr_period<5||cfg.breakout_atr<0)throw Error('Invalid price pattern parameters');
 const counts={long_breakout:0,short_breakout:0,long_confirmed:0,short_confirmed:0,market_session_gap_excluded:0},candidates=[];
 for(let i=Math.max(cfg.lookback,cfg.atr_period);i<candles.length-2;i++){
  const b=candles[i],r=atr(candles,i-1,cfg.atr_period);
  if(!Number.isFinite(r)||r<=0)continue;
  const trailing=candles.slice(i-cfg.lookback,i),priorHigh=Math.max(...trailing.map(x=>x.high)),priorLow=Math.min(...trailing.map(x=>x.low));
  const dir=b.close>priorHigh+cfg.breakout_atr*r?'long':b.close<priorLow-cfg.breakout_atr*r?'short':null;
  if(!dir)continue;
  counts[dir+'_breakout']++;
  const confirm=candles[i+1],execution=candles[i+2];
  if(confirm.close_ms-b.close_ms>30*3600000||execution.start_ms<confirm.close_ms||execution.start_ms>confirm.close_ms+30*3600000){counts.market_session_gap_excluded++;continue}
  const valid=dir==='long'?confirm.close>priorHigh:confirm.close<priorLow;
  if(!valid)continue;
  counts[dir+'_confirmed']++;
  candidates.push({direction:dir,breakout_closed_utc:new Date(b.close_ms).toISOString(),confirmation_closed_utc:new Date(confirm.close_ms).toISOString(),
   earliest_hypothetical_entry_open_utc:new Date(execution.start_ms).toISOString(),breakout_price:b.close,atr_14_4h:r,prior_range_high:priorHigh,prior_range_low:priorLow,price_only:true});
 }
 const perYear=Object.fromEntries([2025,2026].map(y=>{
  const q=candidates.filter(x=>x.confirmation_closed_utc.startsWith(String(y)));
  return [y,{confirmed_breakouts:q.length,long:q.filter(x=>x.direction==='long').length,short:q.filter(x=>x.direction==='short').length}];
 }));
 const result={candidate_count:candidates.length,counts,per_year:perYear,recent_confirmed_patterns:candidates.slice(-10)};
 if(settings.include_all_candidates===true)result.confirmed_candidates=candidates;
 return result;
}
module.exports={scan};
