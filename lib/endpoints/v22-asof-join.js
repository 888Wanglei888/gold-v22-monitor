// Historical research feature coverage; deliberately does NOT generate V2.2 trading signals.
// Every joined feature is delayed conservatively relative to its observation date.
// Vintage revisions and exceptional release schedules are not independently verified.
const {buildAsOf,build4h,coverage}=require('./v22-asof-core');
const fredNames=['DFII10','DGS10','T10YIE','RRPONTSYD','SOFR','IORB','WRESBAL'];
const required=[...fredNames,'DXY','COT_NET','COT_OI','TGA'];
const delays={DFII10:3,DGS10:3,T10YIE:3,RRPONTSYD:3,SOFR:3,IORB:3,WRESBAL:9,DXY:2,COT_NET:15,COT_OI:15,TGA:3};
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const etDate=t=>{const p=Object.fromEntries(eastern.formatToParts(new Date(t*1000)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const abort=ms=>AbortSignal.timeout(ms);
async function fred(id){
 const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd=2024-01-01';
 const r=await fetch(url,{signal:abort(15000),headers:{'User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw Error(id+' FRED HTTP '+r.status);
 const lines=(await r.text()).trim().split(/\r?\n/);if(!/(?:observation_date|DATE)/i.test(lines[0]||'')||!lines[0].includes(id))throw Error(id+' CSV schema mismatch');
 const rows=[];for(const line of lines.slice(1)){const [date,raw]=line.trim().replaceAll('"','').split(',');const value=Number(raw);if(/^20\d\d-\d\d-\d\d$/.test(date)&&raw!=='.'&&raw!==''&&Number.isFinite(value))rows.push({date,value})}
 if(rows.length<90)throw Error(id+' historical coverage too short '+rows.length);
 return rows;
}
async function yahoo(symbol,interval,startYear){
 const start=Math.floor(Date.UTC(startYear,0,1)/1000),end=Math.floor(Date.now()/1000);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1='+start+'&period2='+end+'&interval='+interval;
 const r=await fetch(url,{signal:abort(21000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
 if(!r.ok)throw Error(symbol+' chart HTTP '+r.status);
 const a=(await r.json()).chart?.result?.[0];if(!a?.timestamp?.length)throw Error(symbol+' chart payload missing');
 return a;
}
async function dollar(){const a=await yahoo('DX-Y.NYB','1d',2024),q=a.indicators?.quote?.[0]||{};
 const raw=a.timestamp.map((t,i)=>({date:etDate(t),value:q.close?.[i]}));
 return raw.filter(x=>Number.isFinite(x.value)&&x.value>0);
}
async function cot(){const p=new URLSearchParams();p.set('cftc_contract_market_code','088691');p.set('$where',"report_date_as_yyyy_mm_dd >= '2024-01-01T00:00:00'");p.set('$order','report_date_as_yyyy_mm_dd ASC');p.set('$limit','500');
 const r=await fetch('https://publicreporting.cftc.gov/resource/72hh-3qpy.json?'+p,{signal:abort(17000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw Error('CFTC HTTP '+r.status);
 const data=await r.json();if(!Array.isArray(data))throw Error('CFTC payload missing');
 const net=[],oi=[];
 for(const d of data){const date=String(d.report_date_as_yyyy_mm_dd||'').slice(0,10),lo=Number(d.m_money_positions_long_all),sh=Number(d.m_money_positions_short_all),open=Number(d.open_interest_all);
  if(!/^20\d\d-\d\d-\d\d$/.test(date)||![lo,sh,open].every(Number.isFinite)||open<=0||!String(d.market_and_exchange_names||'').toUpperCase().includes('GOLD'))continue;
  net.push({date,value:lo-sh});oi.push({date,value:open});
 }
 if(net.length<100)throw Error('CFTC history insufficient '+net.length);
 return {net,oi};
}
async function tgaYear(y){const p=new URLSearchParams({filter:'record_date:gte:'+y+'-01-01,record_date:lte:'+y+'-12-31,table_nbr:eq:I,src_line_nbr:eq:4',sort:'record_date','page[size]':'10000'});
 const r=await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?'+p,{signal:abort(19000)});
 if(!r.ok)throw Error('FiscalData '+y+' HTTP '+r.status);
 const j=await r.json();if(Number(j.meta?.total_count)>j.data?.length)throw Error('FiscalData '+y+' truncated');
 const seen=new Map();for(const x of j.data||[]){const date=x.record_date,value=Number(x.open_today_bal??x.close_today_bal);
  if(String(x.table_nbr).toUpperCase()!=='I'||String(x.src_line_nbr)!=='4'||!/Treasury General Account.*Closing Balance/i.test(String(x.account_type||''))||!Number.isFinite(value)||value<=0)continue;
  if(!seen.has(date))seen.set(date,[]);seen.get(date).push({date,value});
 }
 const out=[...seen].filter(([,v])=>v.length===1).map(([,v])=>v[0]);if(out.length<100)throw Error('FiscalData '+y+' insufficient '+out.length);
 return out;
}
async function gold(){const a=await yahoo('GC=F','1h',2025),q=a.indicators?.quote?.[0]||{},raw=a.timestamp.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]}));return build4h(raw,Date.now())}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 const keys=[...fredNames,'DXY','COT','TGA2024','TGA2025','TGA2026','GC'];
 const jobs=[...fredNames.map(id=>fred(id)),dollar(),cot(),tgaYear(2024),tgaYear(2025),tgaYear(2026),gold()];
 const results=await Promise.allSettled(jobs),good={},errors={};
 for(let i=0;i<keys.length;i++){const item=results[i];if(item.status==='fulfilled')good[keys[i]]=item.value;else errors[keys[i]]=String(item.reason)}
 const assembled={};for(const id of fredNames)if(good[id])assembled[id]=good[id];
 if(good.DXY)assembled.DXY=good.DXY;
 if(good.COT){assembled.COT_NET=good.COT.net;assembled.COT_OI=good.COT.oi}
 if(good.TGA2024&&good.TGA2025&&good.TGA2026)assembled.TGA=[...good.TGA2024,...good.TGA2025,...good.TGA2026];
 const sourceCoverage={};
 for(const k of required){const b=buildAsOf(assembled[k]||[],delays[k]);sourceCoverage[k]={observations:b.rows.length,duplicate_observation_dates_excluded:b.duplicates_excluded,first_observation_date:b.rows[0]?.date||null,last_observation_date:b.rows.at(-1)?.date||null,conservative_lag_calendar_days:delays[k]};assembled[k]=b}
 const candles=good.GC?.candles||[];
 const audit=coverage(candles,assembled,required);
 const perYear=Object.fromEntries([2025,2026].map(year=>{
  const sub=candles.filter(x=>x.session_date.startsWith(String(year)));
  return [year,{candles:sub.length,...coverage(sub,assembled,required)}];
 }));
 const allAvailable=required.every(id=>sourceCoverage[id].observations>100)&&candles.length>=1000;
 const asOfPolicy='Conservative calendar-day delays only. Not a verified source release calendar or historical vintage archive.';
 res.status(200).json({status:allAvailable&&audit.future_time_violations===0?'v22_lagged_feature_join_research_only':'v22_lagged_feature_join_incomplete',as_of:new Date().toISOString(),gold_proxy:'Yahoo GC=F hourly to New-York-session 4h, validated closed candles',asof_policy:asOfPolicy,assumed_not_before_lags_calendar_days:delays,source_errors:errors,source_coverage:sourceCoverage,ohlc_quality:good.GC?.quality||null,joined_feature_audit:audit,annual_feature_audit:perYear,full_v22_strategy_backtested:false,trade_signals_enabled:false,unavailable_full_v22_inputs:['TreasuryDirect auction net-new-cash and historical settlement forecast','reconstructed historical DTS tax/spending model with vintages','intraday release timestamps and official revisions','GLD/other gold ETF daily creation-redemption flows','specific COMEX GC contract OI/roll-adjusted tradable execution','historically timestamped SRF/Fed expectations where required','frozen A/A+/A++ multi-factor trade execution'],limitations:['No as-of join here is proof of exact public release or original-vintage values','Conservative source lag may fail for exceptional holidays or delayed reports; records need publication-calendar verification','A missing required feature blocks complete status, never defaults to passing a signal','No weights, optimizations, profits, trades or win rate are computed','Prior backtested TGA-only strategy remains excluded from V2.2']});
};
