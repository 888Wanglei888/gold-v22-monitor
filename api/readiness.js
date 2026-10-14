// Live validation gate: research signals remain disabled regardless of baseline score.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=300');
 const origin='https://'+(process.env.VERCEL_URL||'gold-v22-real-data-v1.vercel.app');
 const endpoints=['treasury','forecast','tga-identity','holdout-backtest','robustness-backtest'];
 const checks={};
 await Promise.all(endpoints.map(async name=>{
  try{
   const response=await fetch(origin+'/api/'+name,{signal:AbortSignal.timeout(25000)});
   const data=await response.json();
   const valid=response.ok&&(name==='treasury'?!!data.latest:name==='forecast'?data.horizons?.length===3:name==='tga-identity'?data.latest?.verified===true:name==='holdout-backtest'?!!data.results?.['D+5']:!!data.results?.['D+5']?.paired_improvement_95pct_moving_block_interval);
   checks[name]={http_status:response.status,valid:!!valid,source_as_of:data.as_of||data.latest?.record_date||data.latest?.date||null,error:valid?null:data.error||data.status||'Validation failed'};
  }catch(e){checks[name]={valid:false,error:String(e)}}
 }));
 const requiredMissing=['point_in_time_vintage_archive','treasury_net_new_cash_reconciled','tax_and_spending_event_model','gold_ohlc_execution_backtest','risk_adjusted_signal_validation','alert_delivery_end_to_end'];
 res.status(200).json({status:'research_only',baseline_data_checks_passed:Object.values(checks).every(x=>x.valid),checks,missing_for_trade_ready:requiredMissing,trade_signals_enabled:false,automatic_trade_alerts_enabled:false,warning:'Passing TGA model validation is not evidence of a profitable gold strategy. No A/A+/A++ live trading signals.'});
};