// Treasury auction settlement calendar (informational; NOT net financing).
// Auction amount is gross issuance and must never be interpreted as net liquidity drain.
const API='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
module.exports=async function(req,res){
 res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
 try{
  const now=new Date(),today=now.toISOString().slice(0,10),end=new Date(now.getTime()+14*86400000).toISOString().slice(0,10);
  const params=new URLSearchParams({filter:'issue_date:gte:'+today+',issue_date:lte:'+end,sort:'issue_date','page[size]':'1000'});
  const url=API+'?'+params;
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error('Treasury auction API HTTP '+r.status);
  const body=await r.json(),rows=body.data||[];
  const data=rows.map(x=>({issue_date:x.issue_date,auction_date:x.auction_date,security_type:x.security_type,security_term:x.security_term,cusip:x.cusip,offering_amount:x.offering_amt??null,accepted_amount:x.total_accepted??null,record_date:x.record_date??null})).sort((a,b)=>String(a.issue_date).localeCompare(String(b.issue_date)));
  res.status(200).json({retrieved_at:now.toISOString(),window:{from:today,to:end},status:'settlement_calendar_only',count:data.length,items:data,source:url,limitations:['Gross issuance is not net new cash: maturity redemption, SOMA rollovers, buybacks and reopening must be reconciled','Do not treat missing amount as zero','Announcement and auction publication time must be checked before any point-in-time forecast','This endpoint does not generate a trading signal']});
 }catch(e){res.status(502).json({error:String(e)})}
};