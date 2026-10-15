// Direct official source multi-factor HISTORICAL COVERAGE review. Not a V2.2 strategy trade backtest.
const fs=require('node:fs'),handler=require('../lib/endpoints/v22-asof-join');
async function main(){
 let status=200,data;
 const res={setHeader(){return this},status(n){status=n;return this},json(j){data=j;return this}};
 try{await handler({query:{}},res)}catch(e){data={status:'v22_asof_direct_source_exception',error:String(e)}}
 const report={at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA||null,http_status:status,
  status:data?.status,complete_asof_history:data?.joined_feature_audit?.complete,closed_4h_candles:data?.joined_feature_audit?.candle_count,
  macro_source_errors:data?.source_errors,required_source_coverage:data?.source_coverage,
  candidate_macro_crosscheck:data?.technical_price_only_cross_market_asof_descriptive,
  full_v22_strategy_backtested:false,trade_signals_enabled:false,
  caution:'Descriptive coincidence only. No fiscal surprise trade signal or stable time-of-release vintage, multi-timeframe Dow confirmation, COMEX contract roll or PnL.'};
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/v22-cross-market-latest.json',JSON.stringify(report,null,2));
 console.log(report.status,'4H candidates',report.candidate_macro_crosscheck?.counts?.candidates,'fully available',report.candidate_macro_crosscheck?.counts?.complete_asof_12_of_12,report.macro_source_errors);
}
main().catch(e=>{console.error(e);process.exitCode=1});
