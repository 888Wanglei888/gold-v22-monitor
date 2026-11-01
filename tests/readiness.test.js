const assert = require('node:assert/strict');
const readiness = require('../lib/endpoints/readiness.js');

const production = 'https://gold-v22-real-data-v1.vercel.app';
const fixtures = {
  treasury: { latest: { record_date: '2026-10-29' } },
  forecast: { horizons: [{}, {}, {}] },
  'tga-identity': { latest: { verified: true } },
  'holdout-backtest': { results: { 'D+5': { samples: 200 } } },
  'robustness-backtest': { results: { 'D+5': { paired_improvement_95pct_moving_block_interval: [0, 1] } } },
  'v22-source-audit': { fred: Array.from({ length: 7 }, () => ({ status: 'source_access_ok' })) },
  'v22-dxy-audit': { status: 'dxy_daily_source_access_ok', usable_unique_trading_days: 600 },
  'v22-cot-audit': { status: 'cot_source_access_ok', observations: 148 },
  'v22-ohlc-integrity': { status: 'research_cme_session_hour_integrity_audited', counts: { closed_session_aligned_4h: 2167 } }
};

async function inspect(mode = 'valid') {
  const requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    const name = url.split('/').at(-1);
    if (mode === 'html' && name === 'v22-ohlc-integrity')
      return { ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' },
        json: () => { throw Error('HTML must not be parsed as JSON'); } };
    const payload = mode === 'source_blocked' && name === 'v22-ohlc-integrity'
      ? { status: 'v22_ohlc_integrity_blocked', error: 'upstream source unavailable' }
      : fixtures[name];
    return { ok: true, status: 200, headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => payload };
  };
  let output;
  const res = { setHeader() {}, status(code) { assert.equal(code, 200); return this; }, json(body) { output = body; return this; } };
  await readiness({}, res);
  assert.equal(requested.length, 9);
  assert(requested.every(url => url.startsWith(production + '/api/')),
    'A preview deployment URL must never be used to audit production');
  assert.equal(output.trade_signals_enabled, false);
  assert.equal(output.automatic_trade_alerts_enabled, false);
  return output;
}

(async () => {
  const oldFetch = global.fetch;
  const oldUrl = process.env.VERCEL_URL;
  const oldProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  try {
    process.env.VERCEL_URL = 'private-deployment-url.vercel.app';
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    let result = await inspect();
    assert.equal(result.research_source_coverage_passed, true);
    assert.equal(result.baseline_data_checks_passed, true);
    assert.equal(result.checks['v22-ohlc-integrity'].valid, true);

    result = await inspect('html');
    assert.equal(result.research_source_coverage_passed, false);
    assert.equal(result.checks['v22-ohlc-integrity'].failure_type, 'non_json_response');
    assert.match(result.checks['v22-ohlc-integrity'].error, /instead of JSON/);

    result = await inspect('source_blocked');
    assert.equal(result.checks['v22-ohlc-integrity'].failure_type, 'source_validation_failed');
    assert.match(result.checks['v22-ohlc-integrity'].error, /upstream source unavailable/);

    console.log('Readiness tests passed: production origin, HTML routing, source-quality gate');
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = oldUrl;
    if (oldProduction === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = oldProduction;
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
