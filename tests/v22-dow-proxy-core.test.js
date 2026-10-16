const assert=require('node:assert/strict'),{closedHigherFrames,pivots,classify,trend}=require('../lib/endpoints/v22-dow-proxy-core');
const DAY=86400000;
const dates=[];
for(let i=0;i<130;i++){let t=Date.UTC(2025,0,6+i),d=new Date(t).getUTCDay();if(d!==0&&d!==6)dates.push(new Date(t).toISOString().slice(0,10))}
const bars=[];
for(const [j,d] of dates.entries())for(let i=0;i<5;i++){
 const start_ms=Date.parse(d+'T00:00:00Z')+i*4*3600000;
 const c=200+20*Math.sin(j/4)+j*.15;
 bars.push({session_date:d,slot:i,start_ms,close_ms:start_ms+4*3600000,
  open:c,close:c,high:c+3+Math.sin(j),low:c-3-Math.sin(j)});
}
const out=closedHigherFrames(bars);
assert.equal(out.daily.length,dates.length);
assert(out.weekly.length>=17);
assert(out.weekly[0].available_ms>out.weekly[0].close_ms);
const p=pivots(out.weekly);
assert(p.highs.length>=2&&p.lows.length>=2);
const pre=classify(out,Date.UTC(2025,0,8));
assert.equal(pre.weekly.direction,null);
const later=classify(out,Date.UTC(2025,4,1));assert(later.daily.frames>10);
const sampleSun=closedHigherFrames([{session_date:'2025-03-09',slot:0,start_ms:Date.UTC(2025,2,9,22),close_ms:Date.UTC(2025,2,10,2),open:100,high:102,low:99,close:101},
 ...[1,2,3,4].map(i=>({session_date:'2025-03-09',slot:i,start_ms:Date.UTC(2025,2,9,22)+i*4*3600000,close_ms:Date.UTC(2025,2,9,22)+(i+1)*4*3600000,open:101,high:102,low:99,close:101}))]);
assert.equal(sampleSun.daily[0].label,'2025-03-10','Sunday 18:00 NY Globex session belongs to Monday CME trade date');
const drop=closedHigherFrames(bars.filter(x=>!(x.session_date===dates[5]&&x.slot===4)));
assert.equal(drop.daily.length,dates.length-1);
console.log('Dow-style confirmed daily weekly swing proxy time gating and incomplete-day safeguards passed');
