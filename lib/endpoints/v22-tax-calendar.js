// Ex-ante fixed calendar for major recurring US quarterly/individual tax-due events.
// Calendar is deliberately approximate; holidays, Emancipation Day and IRS extensions unverified.
const MS=86400000;
const majorDueMonths=[1,4,6,9,12];
function approxFifteenthBusinessDay(year,month){
 const day=new Date(Date.UTC(year,month-1,15));
 while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);
 return day.toISOString().slice(0,10);
}
function dueEvent(date){
 if(!/^20\d\d-\d\d-\d\d$/.test(date))return null;
 const y=Number(date.slice(0,4)),month=Number(date.slice(5,7));
 if(!majorDueMonths.includes(month))return null;
 return date===approxFifteenthBusinessDay(y,month)?month:null;
}
function median(a){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2}
function taxAdjustment(target,past,minPriorYears=1){
 const month=dueEvent(target);
 if(!month)return {candidate:false,calendar_tax_adjustment:0,history_years:0,missing:false,quarterly_tax_window:false};
 const year=Number(target.slice(0,4));
 const samples=[];
 for(let prior=2024;prior<year;prior++){
  const scheduled=approxFifteenthBusinessDay(prior,month);
  const day=past.find(x=>x.target===scheduled);
  if(day&&Number.isFinite(day.tax_net_proxy))samples.push(day);
 }
 const valid=samples.length>=minPriorYears;
 const weekdayTax=median(past.filter(x=>Number.isFinite(x.tax_net_proxy)).map(x=>x.tax_net_proxy));
 const raw=valid&&Number.isFinite(weekdayTax)?median(samples.map(x=>x.tax_net_proxy))-weekdayTax:0;
 return {candidate:true,calendar_tax_adjustment:valid?raw:0,history_years:samples.length,missing:!valid,quarterly_tax_window:true,proxy:'historical prior-year known midmonth Treasury named-tax net receipts minus ordinary median (USD millions)'};
}
module.exports={majorDueMonths,approxFifteenthBusinessDay,dueEvent,taxAdjustment};
