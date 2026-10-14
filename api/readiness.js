// V2.2 readiness: explicit fail-closed gate. This endpoint does NOT claim to trade.
module.exports=async function(req,res){
 res.setHeader('Cache-Control','s-maxage=300');
 const checks={
  dts_tga:'implemented_unverified_current_deployment',
  treasury_auction_calendar:'implemented_unverified_current_deployment',
  tga_baseline_forecast:'implemented_unverified_current_deployment',
  historical_vintage_store:'missing',
  treasury_net_new_cash:'missing',
  tax_and_spending_forecast:'missing',
  forecast_surprise_zscore:'missing',
  reserve_rrp_sofr_iorb:'missing',
  gold_multi_timeframe_confirmation:'missing',
  cot_etf_volatility_confirmation:'missing',
  historical_point_in_time_backtest:'missing',
  alert_delivery:'missing'
 };
 const required=['historical_vintage_store','treasury_net_new_cash','tax_and_spending_forecast','forecast_surprise_zscore','reserve_rrp_sofr_iorb','gold_multi_timeframe_confirmation','historical_point_in_time_backtest','alert_delivery'];
 const ready=required.every(x=>checks[x]==='verified_live');
 res.status(200).json({status:ready?'ready':'research_only',trade_signals_enabled:ready,automatic_trade_alerts_enabled:false,checks,warning:'No A/A+/A++ grade should be used for live trading until data integrity and point-in-time validation pass.'});
};