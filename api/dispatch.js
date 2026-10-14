// Single serverless function: preserve legacy /api/<name> routes on Vercel Hobby.
const handlers = Object.freeze({
  "backtest": require('../lib/endpoints/backtest.js'),
  "calendar-backtest": require('../lib/endpoints/calendar-backtest.js'),
  "cashflow-taxonomy": require('../lib/endpoints/cashflow-taxonomy.js'),
  "debt-reconciliation": require('../lib/endpoints/debt-reconciliation.js'),
  "debt-taxonomy": require('../lib/endpoints/debt-taxonomy.js'),
  "fiscal-flows": require('../lib/endpoints/fiscal-flows.js'),
  "forecast": require('../lib/endpoints/forecast.js'),
  "full-history-backtest": require('../lib/endpoints/full-history-backtest.js'),
  "historical-coverage": require('../lib/endpoints/historical-coverage.js'),
  "holdout-backtest": require('../lib/endpoints/holdout-backtest.js'),
  "horizon-backtest": require('../lib/endpoints/horizon-backtest.js'),
  "model-compare": require('../lib/endpoints/model-compare.js'),
  "readiness": require('../lib/endpoints/readiness.js'),
  "robustness-backtest": require('../lib/endpoints/robustness-backtest.js'),
  "settlements": require('../lib/endpoints/settlements.js'),
  "source-coverage": require('../lib/endpoints/source-coverage.js'),
  "tga-identity": require('../lib/endpoints/tga-identity.js'),
  "treasury": require('../lib/endpoints/treasury.js'),
  "yearly-backtest": require('../lib/endpoints/yearly-backtest.js')
});
module.exports = async (req,res) => {
 const name = String(req.query?.endpoint || '').trim();
 if(!Object.prototype.hasOwnProperty.call(handlers,name))return res.status(404).json({error:'Unknown endpoint'});
 return handlers[name](req,res);
};
