// Research-only Dow-style higher highs / higher lows on CLOSED daily and weekly 4h-derived proxy bars.
// Inputs are strict CME-session GOLD OHLC blocks, not official settlement daily bars.
// A pivot is only confirmable after RIGHT=1 fully complete later bars, never on a forming week.
const DAY=86400000;
const dateMs=s=>Date.parse(s+'T00:00:00Z');
const day=s=>new Date(s).toISOString().slice(0,10);
function weekMonday(s){const t=dateMs(s),wd=new Date(t).getUTCDay(),shift=(wd+6)%7;return day(t-shift*DAY)}
function aggregate(rows,label,available_ms){
 return {label,start_ms:rows[0].start_ms,close_ms:rows.at(-1).close_ms,available_ms,
  open:rows[0].open,high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low)),close:rows.at(-1).close,count:rows.length};
}
function closedHigherFrames(candles){
 const byDate=new Map(),bad={excluded_missing_four_hour_slots:0,excluded_incomplete_week:0};
 for(const b of candles){
  if(!/20\d\d-\d\d-\d\d/.test(b.session_date)||!Number.isInteger(b.slot))throw Error('Gold candle must declare exchange session_date and 4h slot');
  // build4h labels by local 18:00 REOPEN date (usually previous calendar evening).
  // The CME trading day is the FOLLOWING local calendar date; Sunday evening -> Monday session.
  const exchangeTradeDate=day(dateMs(b.session_date)+DAY);
  if(!byDate.has(exchangeTradeDate))byDate.set(exchangeTradeDate,[]);
  byDate.get(exchangeTradeDate).push(b);
 }
 const daily=[];
 for(const [date,raw] of [...byDate].sort((a,b)=>a[0].localeCompare(b[0]))){
  const rows=raw.slice().sort((a,b)=>a.slot-b.slot);
  if(rows.length!==5||rows.some((x,i)=>x.slot!==i||x.close_ms<=x.start_ms)){
   bad.excluded_missing_four_hour_slots++;continue;
  }
  // This is the *last available 4h-derived proxy* close, around 14:00 New York.
  // It is not the official COMEX daily settlement / regular 17:00 session close.
  daily.push(aggregate(rows,date,rows.at(-1).close_ms));
 }
 const weeks=new Map();
 for(const d of daily){
  const key=weekMonday(d.label);
  if(!weeks.has(key))weeks.set(key,[]);
  weeks.get(key).push(d);
 }
 const weekly=[];
 for(const [m,ds] of [...weeks].sort((a,b)=>a[0].localeCompare(b[0]))){
  if(ds.length<3){bad.excluded_incomplete_week++;continue}
  // At Monday 18:00 UTC NEXT week the previous-week proxy bars are safely known,
  // across daylight-saving changes. Do not use an in-progress current weekly bar.
  const available_ms=dateMs(m)+7*DAY+18*3600000;
  weekly.push(aggregate(ds,m,available_ms));
 }
 return {daily,weekly,quality:bad,ohlc_source:'Reopen-date-to-following-trading-day mapped CME-session five 4h proxy bars ending ~14:00 New York, NOT official daily settlement'};
}
function pivots(rows,left=1,right=1){
 const highs=[],lows=[];
 for(let i=left;i<rows.length-right;i++){
  const h=rows[i].high,l=rows[i].low;
  const prior=rows.slice(i-left,i),after=rows.slice(i+1,i+right+1);
  if(prior.every(x=>h>x.high)&&after.every(x=>h>x.high))highs.push({index:i,value:h,confirmed_ms:rows[i+right].available_ms});
  if(prior.every(x=>l<x.low)&&after.every(x=>l<x.low))lows.push({index:i,value:l,confirmed_ms:rows[i+right].available_ms});
 }
 return {highs,lows};
}
function trend(rows,candleCloseMs,minFrameCount=12){
 const known=rows.filter(x=>x.available_ms<=candleCloseMs);
 if(known.length<minFrameCount)return {direction:null,reason:'insufficient_completed_higher_frames',frames:known.length};
 const {highs,lows}=pivots(known,1,1);
 if(highs.length<2||lows.length<2)return {direction:null,reason:'insufficient_confirmed_swing_highs_lows',frames:known.length,pivots:{highs:highs.length,lows:lows.length}};
 const h=highs.slice(-2),l=lows.slice(-2);
 const rising=h[1].value>h[0].value&&l[1].value>l[0].value;
 const falling=h[1].value<h[0].value&&l[1].value<l[0].value;
 return {direction:rising?'long':falling?'short':null,reason:rising||falling?'confirmed_higher_swing_structure':'mixed_or_flat_swings',
  frames:known.length,confirmed_through_utc:new Date(known.at(-1).available_ms).toISOString(),
  current_close:known.at(-1).close,last_highs:h.map(x=>x.value),last_lows:l.map(x=>x.value)};
}
function classify(derived,at){
 const daily=trend(derived.daily,at,25),weekly=trend(derived.weekly,at,12);
 return {daily,weekly,agreed_direction:daily.direction&&daily.direction===weekly.direction?daily.direction:null};
}
module.exports={closedHigherFrames,pivots,trend,classify,weekMonday};
