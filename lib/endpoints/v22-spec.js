// Frozen V2.2 specification: this is a completeness gate, NOT a signal generator.
// Research endpoints must not silently substitute a single TGA direction for the multi-factor rules.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','s-maxage=300');
 const rules={
  fiscal:{required:['Treasury Bills/Coupons net-new-cash by settlement date','DTS tax/spend calendar seasonality','D+1/D+3/D+5 TGA forecast revisions','252-day historical revision z-score'],z_thresholds:{candidate:0.75,strong:1.0,extreme:1.5}},
  liquidity:{required:['bank reserves','ON RRP release buffer','Fed/SOMA liquidity contribution','SOFR-IORB','SRF'],regimes:['Cushioned','Neutral','Sensitive','Stressed']},
  macro:{required:['DXY','10Y TIPS real yield','10Y nominal yield and breakeven','Fed expectations'],classification:['monetary tightening','fiscal-credit repricing','liquidity squeeze','easing']},
  flow:{required:['gold ETF flows','COMEX open interest and volume','CFTC managed money COT'],supplemental:['GVZ','MOVE','VIX','AI credit stress','ENSO inflation shock']},
  price:{required:['weekly/daily Dow trend','4-hour closed candle','breakout >= 0.25 ATR','next 4-hour candle confirmation','execution strictly after confirmation'],optional:['15-minute entry optimization']},
  risk:{risk_per_trade_pct:{A:0.5,'A+':0.75,'A++':1},max_open_risk_pct:2,max_leverage:5,add_only_after_favorable_move_atr:0.5,required:['stop distance and contract sizing','transaction costs and slippage','no-lookahead event timestamps','portfolio drawdown and yearly holdout']}
 };
 const opportunityModes={
  anticipation:{interpretation:'Trade market revaluation of known FUTURE D+1/D+3/D+5 fiscal cash path before cash actually settles',
   z_score_mandatory:false,requires:['historically as-of verified future net cash expectations','market pre-event pricing and non-exhaustion confirmation','normal V2.2 liquidity macro gold flow and trend evidence']},
  revision:{interpretation:'Trade material change in expectation about same future settlement dates',
   z_score_mandatory:true,requires:['same-target point-in-time forecast revision','rolling past only Z-score','normal V2.2 liquidity macro gold flow and trend evidence']}
 };
 const ready={fiscal:false,liquidity:false,macro:false,flow:false,price:false,risk:false};
 res.status(200).json({status:'v2_2_spec_frozen_research_only',strategy:'US Treasury expected future net liquidity and/or forecast revisions -> dollar liquidity -> DXY and real yields -> gold flows -> Dow/4H price confirmation',rules,opportunity_modes:opportunityModes,implementation_verified:ready,full_v22_backtest_ready:false,live_trade_signals_enabled:false,excluded_as_v22:['TGA-only direction strategy','unconfirmed daily OHLC proxy as 4H execution','fitted results without point-in-time inputs'],next_required:'Complete real-publication-vintage Treasury future-net-cash plus gold positioning and CME contract information; then independently validate both anticipation and revision trade modes with official daily/weekly trends'});
};
