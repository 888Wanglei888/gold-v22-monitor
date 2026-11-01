// Live validation gate: research signals remain disabled regardless of baseline score.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=300');
 // VERCEL_URL is a per-deployment URL and can return an HTML protection page.
 // This endpoint audits the public production API, not the deployment alias.
 const productionHost=process.env.VERCEL_PROJECT_PRODUCTION_URL||'gold-v22-real-data-v1.vercel.app';
 const origin='https://'+productionHost.replace(/^https?:\/\//,'').replace(/\/+$/,'');
 const endpoints=['treasury','forecast','tga-identity','holdout-backtest','robustness-backtest','v22-source-audit','v22-dxy-audit','v22-cot-audit','v22-ohlc-integrity'];
 const checks={};
 await Promise.all(endpoints.map(async name=>{
  try{
   const response=await fetch(origin+'/api/'+name,{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});
   const contentType=response.headers.get('content-type')||'';
   if(!/\bapplication\/json\b|\+json\b/i.test(contentType)){
    checks[name]={http_status:response.status,valid:false,failure_type:'non_json_response',error:'Production route returned '+(contentType||'unknown content type')+' instead of JSON'};
    return;
   }
   const data=await response.json();
   const validators={
    treasury:d=>!!d.latest,
    forecast:d=>d.horizons?.length===3,
    'tga-identity':d=>d.latest?.verified===true,
    'holdout-backtest':d=>!!d.results?.['D+5'],
    'robustness-backtest':d=>!!d.results?.['D+5']?.paired_improvement_95pct_moving_block_interval,
    'v22-source-audit':d=>d.fred?.length===7&&d.fred.every(x=>x.status==='source_access_ok'),
    'v22-dxy-audit':d=>d.status==='dxy_daily_source_access_ok'&&d.usable_unique_trading_days>=500,
    'v22-cot-audit':d=>d.status==='cot_source_access_ok'&&d.observations>=100,
    'v22-ohlc-integrity':d=>d.status==='research_cme_session_hour_integrity_audited'&&d.counts?.closed_session_aligned_4h>=1000
   };
   const valid=response.ok&&!!validators[name]?.(data);
   checks[name]={http_status:response.status,valid:!!valid,failure_type:valid?null:(response.ok?'source_validation_failed':'http_error'),source_as_of:data.as_of||data.latest?.record_date||data.latest?.date||null,error:valid?null:data.error||data.status||'Validation failed'};
  }catch(e){checks[name]={valid:false,failure_type:'request_or_json_error',error:String(e)}}
 }));
 const requiredMissing=['point_in_time_vintage_archive','treasury_net_new_cash_reconciled','tax_and_spending_event_model','gold_etf_historical_creation_redemption_flows','COMEX_specific_contract_roll_adjustment_and_tradable_execution','intraday_macro_release_time_joins','complete_v22_A_Aplus_Aplusplus_portfolio_backtest','risk_adjusted_signal_validation','alert_delivery_end_to_end'];
 const sourceNames=['v22-source-audit','v22-dxy-audit','v22-cot-audit','v22-ohlc-integrity'];
 const researchSourceChecksPassed=sourceNames.every(name=>checks[name]?.valid===true);
 res.status(200).json({status:'research_only',audit_scope:'public_production_api',baseline_data_checks_passed:Object.values(checks).every(x=>x.valid),research_source_coverage_passed:researchSourceChecksPassed,research_source_checks:sourceNames,checks,missing_for_trade_ready:requiredMissing,trade_signals_enabled:false,automatic_trade_alerts_enabled:false,warning:'Passing TGA model validation is not evidence of a profitable gold strategy. No A/A+/A++ live trading signals.'});
};