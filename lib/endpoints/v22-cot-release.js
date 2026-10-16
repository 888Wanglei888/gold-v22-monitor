// CFTC reporting as-of Tuesday is NOT public release timestamp.
// Normal Friday 15:30 ET; safe Saturday 00UTC. US-government shutdown backlogs 2025 and Jan 2026
// drawn conservatively from official 2025-11-18 CFTC resumption notice (later of competing updated schedules).
// Source: https://www.cftc.gov/PressRoom/PressReleases/9138-25
const delayed={
 '2025-09-30':'2025-11-19','2025-10-07':'2025-11-21','2025-10-14':'2025-11-25',
 '2025-10-21':'2025-12-02','2025-10-28':'2025-12-05','2025-11-04':'2025-12-09',
 '2025-11-10':'2025-12-12','2025-11-18':'2025-12-16','2025-11-25':'2025-12-19',
 '2025-12-02':'2025-12-23','2025-12-09':'2025-12-30','2025-12-16':'2026-01-06',
 '2025-12-23':'2026-01-09','2025-12-30':'2026-01-13','2026-01-06':'2026-01-16',
 '2026-01-13':'2026-01-20','2026-01-20':'2026-01-23'};
const DAY=86400000,ms=d=>Date.parse(d+'T00:00:00Z');
function conservativeCotRelease(asof){
 const time=ms(asof);
 if(!Number.isFinite(time))throw Error('Invalid COT report date');
 const special=delayed[asof];
 if(special)return ms(special)+DAY; // after special published date, 00UTC next calendar day
 const d=new Date(time),weekday=d.getUTCDay(),daysToFriday=(5-weekday+7)%7;
 // Saturday UTC is later than Friday 15:30 ET even in northern winter.
 return time+(daysToFriday+1)*DAY;
}
function adjustCOT(rows){
 let delayedRecords=0;
 const adjusted=rows.map(x=>{
  const safe=conservativeCotRelease(x.date);
  if(delayed[x.date])delayedRecords++;
  return {...x,available_utc_ms:Math.max(x.available_utc_ms,safe)};
 }).sort((a,b)=>a.available_utc_ms-b.available_utc_ms);
 // Delayed releases can cause publication not ordered by observation date; preserve chronological availability.
 return {rows:adjusted,shutdown_delayed_report_observations:delayedRecords,official_resumption_calendar_applied:true,
  timing_assumption:'Max(5-calendar-day conservative lag, safe midnight UTC after CFTC official known release date)'};
}
module.exports={adjustCOT,conservativeCotRelease,delayed};
