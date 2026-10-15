// Check official SPDR GLD historical holdings archive availability, NOT GLD share-price proxy.
// The archive may restrict reuse/redistribution; do not republish its raw contents.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=3600');
 const official='https://api.spdrgoldshares.com/api/v1/historical-archive?exchange=NYSE&lang=en&product=gld';
 try{
  const response=await fetch(official,{signal:AbortSignal.timeout(16000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.8','Range':'bytes=0-4095'}});
  const contentType=String(response.headers.get('content-type')||'').toLowerCase(),size=Number(response.headers.get('content-length'));
  const valid=response.ok&&(/spreadsheetml\.sheet|application\/octet-stream/.test(contentType));
  await response.body?.cancel().catch(()=>{});
  res.status(200).json({status:valid?'official_gld_archive_binary_access_ok':'official_gld_archive_not_yet_verified',source:'World Gold Trust Services / SPDR Gold Shares official historical archive',archive_url:official,http_status:response.status,content_type:contentType,content_length_bytes:Number.isFinite(size)?size:null,source_binary_access_ok:!!valid,historical_holdings_parsed:false,historical_etf_flows_validated:false,usable_as_v22_trade_filter:false,limitations:['An official XLSX download exists; row-level holdings and date coverage are NOT validated yet','Gold tonnes change is not identical to net-investor-dollar flow; accounting for fees/sales and NAV needed','Raw source may prohibit reproduction/redistribution; verify license before exporting or hosting workbook contents','Historical publication clock and original data revisions are not audited','GLD is a major ETF but not the entire global gold ETF universe']});
 }catch(e){res.status(200).json({status:'official_gld_archive_connection_blocked',source:'SPDR Gold Shares historical archive',error:String(e),source_binary_access_ok:false,historical_holdings_parsed:false,usable_as_v22_trade_filter:false,no_invented_data:true})}
};
