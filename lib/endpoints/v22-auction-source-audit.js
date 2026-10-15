// Historical Treasury auction records: audit availability and settlement/auction time fields.
// NEVER call accepted dollars net cash until maturity redemption and SOMA treatment are verified.
const URL='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
async function year(y){
 const p=new URLSearchParams({filter:'auction_date:gte:'+y+'-01-01,auction_date:lte:'+y+'-12-31',sort:'auction_date','page[size]':'10000'});
 const r=await fetch(URL+'?'+p,{signal:AbortSignal.timeout(23000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('Treasury auctions '+y+' HTTP '+r.status);
 const j=await r.json();const rows=j.data||[];const total=Number(j.meta?.total_count??j.meta?.['total-count']??NaN);
 if(rows.length>=10000||(Number.isFinite(total)&&total>rows.length))throw Error('Treasury auctions '+y+' truncated '+rows.length+'/'+total);
 if(rows.length<100)throw Error('Treasury auctions '+y+' unexpectedly sparse '+rows.length);
 return rows;
}
const numeric=x=>x===null||x===undefined||x===''||x==='null'?null:Number(x);
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 try{
  const data=await Promise.all([2023,2024,2025,2026].map(year));
  const rows=data.flat(),seen=new Set(),duplicates=[];
  const bad={unparseable_amount:0,invalid_dates:0,auction_after_issue:0,issue_after_maturity:0};
  const perYear={},samples=[];
  for(const [idx,year] of [2023,2024,2025,2026].entries()){
   const rs=data[idx],types={},accepted=[];
   for(const x of rs){
    const date=x.auction_date,issue=x.issue_date,maturity=x.maturity_date;
    if(!/^20\d\d-\d\d-\d\d$/.test(date)||!/^20\d\d-\d\d-\d\d$/.test(issue))bad.invalid_dates++;
    if(date>issue)bad.auction_after_issue++;
    if(maturity&&maturity!=='null'&&issue>maturity)bad.issue_after_maturity++;
    const key=[x.cusip,date,issue].join('|');if(seen.has(key))duplicates.push(key);seen.add(key);
    const type=String(x.security_type||'unknown');types[type]=(types[type]||0)+1;
    const amount=numeric(x.total_accepted);
    if(amount!==null&&Number.isFinite(amount)&&amount>0)accepted.push(amount);else bad.unparseable_amount++;
   }
   perYear[year]={auction_rows:rs.length,type_counts:types,accepted_amount_rows:accepted.length,first_auction:rs[0]?.auction_date,last_auction:rs.at(-1)?.auction_date};
  }
  const required=['auction_date','issue_date','maturity_date','total_accepted','security_type','security_term','cusip','record_date','reopening'];
  const fields=rows.length?Object.keys(rows[0]):[];
  const missing=required.filter(x=>!fields.includes(x));
  for(const x of rows.slice(-5))samples.push(Object.fromEntries(['auction_date','issue_date','maturity_date','security_type','security_term','total_accepted','offering_amt','record_date','reopening','cusip'].map(k=>[k,x[k]??null])));
  res.status(200).json({status:missing.length||bad.invalid_dates||bad.auction_after_issue||duplicates.length?'auction_historical_schema_requires_reconciliation':'auction_historical_source_access_ok',source:URL,per_year:perYear,raw_record_count:rows.length,columns:fields,missing_required_fields:missing,duplicate_cusip_auction_issue_keys:duplicates.length,bad_data:bad,recent_source_samples:samples,announcement_time_verified:false,issue_date_equals_cash_settlement_verified:false,total_accepted_is_net_new_cash:false,full_v22_fiscal_forecast_ready:false,limitations:['Auction results are only knowable after the auction results are made public; use conservative next-day delay until timestamps independently certified','Maturity cash payout cannot be inferred from auctions in the same year alone','total_accepted includes gross awards and is not directly equivalent to public-market cash proceeds','Need compare per-day inferred issuance and redeemed maturities against DTS IIIA line-item cash amounts','Release/publication record_date semantics require empirical verification; never assume they equal auction_date']});
 }catch(e){res.status(200).json({status:'auction_historical_source_blocked',error:String(e),no_invented_data:true,full_v22_fiscal_forecast_ready:false})}
};
