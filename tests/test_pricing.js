"use strict";

var assert = require("assert");
var Pricing = require("../static/js/pricing.js");

function approx(a, b, tol) {
  if (tol === undefined) { tol = 1e-8; }
  return Math.abs(a - b) < tol;
}

// === normCdf ===
(function testNormCdf() {
  assert.ok(approx(Pricing.normCdf(0), 0.5));
  assert.ok(Pricing.normCdf(3) > 0.998);
  assert.ok(Pricing.normCdf(-3) < 0.002);
  assert.ok(approx(Pricing.normCdf(1), 0.841344746, 1e-5));
  console.log("PASS normCdf");
})();

// === normPdf ===
(function testNormPdf() {
  assert.ok(approx(Pricing.normPdf(0), 0.39894228, 1e-5));
  assert.ok(approx(Pricing.normPdf(1), 0.241970725, 1e-5));
  console.log("PASS normPdf");
})();

// === blackScholes ===
(function testBlackScholes() {
  // ATM call, 30dte, 20% vol
  var bs = Pricing.blackScholes(100, 100, 30 / 365, 0.2, "C");
  assert.ok(bs > 0, "ATM call should have positive value");
  assert.ok(bs < 10, "ATM call 30dte 20%iv should be under 10");

  // ITM call (deep)
  var deepItm = Pricing.blackScholes(150, 100, 30 / 365, 0.2, "C");
  assert.ok(deepItm > 49, "Deep ITM call should be near intrinsic ~50");

  // OTM call
  var otm = Pricing.blackScholes(100, 150, 30 / 365, 0.2, "C");
  assert.ok(otm < 1, "Deep OTM call should be near 0");

  // Put (OTM = strike above spot)
  var putVal = Pricing.blackScholes(100, 110, 30 / 365, 0.2, "P");
  assert.ok(putVal > 0, "OTM put should have positive value");

  // Zero time -> intrinsic
  var zeroT = Pricing.blackScholes(100, 90, 0, 0.2, "C");
  assert.ok(approx(zeroT, 10));
  var zeroPut = Pricing.blackScholes(90, 100, 0, 0.2, "P");
  assert.ok(approx(zeroPut, 10));

  console.log("PASS blackScholes");
})();

// === bsDelta ===
(function testBsDelta() {
  // ATM call delta ~0.5
  var d = Pricing.bsDelta(100, 100, 30 / 365, 0.2, "C");
  assert.ok(approx(d, 0.5, 0.1), "ATM call delta ~0.5 got " + d);

  // ITM call delta > 0.5
  var dItm = Pricing.bsDelta(110, 100, 30 / 365, 0.2, "C");
  assert.ok(dItm > 0.5, "ITM call delta > 0.5");

  // OTM call delta < 0.5
  var dOtm = Pricing.bsDelta(100, 110, 30 / 365, 0.2, "C");
  assert.ok(dOtm < 0.5, "OTM call delta < 0.5");

  // Put delta is negative
  var dPut = Pricing.bsDelta(100, 100, 30 / 365, 0.2, "P");
  assert.ok(dPut < 0, "ATM put delta negative");

  // Deep ITM zero time
  var dZero = Pricing.bsDelta(150, 100, 0, 0.2, "C");
  assert.ok(approx(dZero, 1), "Deep ITM zero-time call delta ~1");

  console.log("PASS bsDelta");
})();

// === optionGreeks ===
(function testOptionGreeks() {
  var g = Pricing.optionGreeks(100, 100, 30 / 365, 0.2, "C");
  assert.ok(approx(g.delta, 0.5, 0.1), "greeks delta ~0.5");
  assert.ok(g.gamma > 0, "gamma > 0");
  assert.ok(g.vega > 0, "vega > 0");
  assert.ok(g.theta < 0, "theta < 0 for calls");

  // Zero time = intrinsic
  var g0 = Pricing.optionGreeks(100, 90, 0, 0.2, "C");
  assert.ok(approx(g0.delta, 1), "zero-time ITM call delta ~1");
  assert.ok(approx(g0.gamma, 0), "zero-time gamma ~0");

  // Invalid inputs
  var gBad = Pricing.optionGreeks(0, 100, 30 / 365, 0.2, "C");
  assert.ok(approx(gBad.delta, 0));
  assert.ok(approx(gBad.vega, 0));

  console.log("PASS optionGreeks");
})();

// === isStockLeg ===
(function testIsStockLeg() {
  assert.ok(Pricing.isStockLeg({ right: "U" }) === true);
  assert.ok(Pricing.isStockLeg({ right: "C" }) === false);
  assert.ok(Pricing.isStockLeg({ right: "P" }) === false);
  assert.ok(Pricing.isStockLeg(null) === false);
  assert.ok(Pricing.isStockLeg(undefined) === false);
  assert.ok(Pricing.isStockLeg({}) === false);
  console.log("PASS isStockLeg");
})();

// === quantileSorted ===
(function testQuantileSorted() {
  assert.ok(isNaN(Pricing.quantileSorted([], 0.5)));
  assert.ok(approx(Pricing.quantileSorted([1], 0.5), 1));
  assert.ok(approx(Pricing.quantileSorted([1, 2, 3, 4, 5], 0.5), 3));
  assert.ok(approx(Pricing.quantileSorted([1, 2, 3, 4, 5], 0), 1));
  assert.ok(approx(Pricing.quantileSorted([1, 2, 3, 4, 5], 1), 5));
  assert.ok(approx(Pricing.quantileSorted([1, 2, 3, 4], 0.5), 2.5));
  console.log("PASS quantileSorted");
})();

// === collapseStickyBucket ===
(function testCollapseStickyBucket() {
  var bucket = [
    { delta: 0.3, iv: 0.20 },
    { delta: 0.301, iv: 0.21 },
    { delta: 0.299, iv: 0.22 },
  ];
  var result = Pricing.collapseStickyBucket(bucket);
  assert.ok(approx(result.delta, 0.3, 0.005));
  assert.ok(approx(result.iv, 0.21));
  console.log("PASS collapseStickyBucket");
})();

// === mapIvFromDelta ===
(function testMapIvFromDelta() {
  var smile = [
    { delta: 0.1, iv: 0.25 },
    { delta: 0.3, iv: 0.20 },
    { delta: 0.5, iv: 0.18 },
    { delta: 0.7, iv: 0.19 },
    { delta: 0.9, iv: 0.22 },
  ];
  var iv25 = Pricing.mapIvFromDelta(smile, 0.25, 0.2);
  assert.ok(iv25 > 0.20 && iv25 < 0.25, "delta=0.25 maps between 0.2-0.25 got " + iv25);
  var iv01 = Pricing.mapIvFromDelta(smile, 0.01, 0.2);
  assert.ok(approx(iv01, 0.25), "below min delta maps to first");
  var iv95 = Pricing.mapIvFromDelta(smile, 0.95, 0.2);
  assert.ok(approx(iv95, 0.22), "above max delta maps to last");
  var fallback = Pricing.mapIvFromDelta([], 0.5, 0.15);
  assert.ok(approx(fallback, 0.15), "empty smile uses fallback");
  var noFallback = Pricing.mapIvFromDelta([], 0.5, null);
  assert.ok(approx(noFallback, 0.2), "empty smile no fallback uses 0.2");
  console.log("PASS mapIvFromDelta");
})();

// === buildStickyDeltaSamples ===
(function testBuildStickyDeltaSamples() {
  var rows = [
    { strike: 90, iv: 0.25, right: "C" },
    { strike: 95, iv: 0.22, right: "C" },
    { strike: 100, iv: 0.20, right: "C" },
    { strike: 105, iv: 0.19, right: "C" },
    { strike: 110, iv: 0.21, right: "C" },
  ];
  var samples = Pricing.buildStickyDeltaSamples(rows, 100, 30 / 365, "C");
  assert.ok(samples.length >= 3, "sticky delta samples should have at least 3 points");
  // Sorted ascending: first sample lowest delta (OTM), last highest (ITM)
  assert.ok(samples[0].delta < samples[samples.length - 1].delta);
  console.log("PASS buildStickyDeltaSamples (" + samples.length + " samples)");
})();

// === breakevens ===
(function testBreakevens() {
  var pts = [
    { x: 80, y: -100 },
    { x: 90, y: -50 },
    { x: 100, y: 0 },
    { x: 110, y: 50 },
    { x: 120, y: 100 },
  ];
  var b = Pricing.breakevens(pts);
  assert.ok(b.length >= 1);
  assert.ok(approx(b[0], 100), "breakeven at x=100");
  console.log("PASS breakevens");
})();

// === groupRowsByStrike ===
(function testGroupRowsByStrike() {
  var rows = [
    { strike: 100, right: "C" },
    { strike: 100, right: "P" },
    { strike: 105, right: "C" },
    { strike: 95, right: "P" },
  ];
  var grouped = Pricing.groupRowsByStrike(rows);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].strike, 95);
  assert.equal(grouped[1].strike, 100);
  assert.equal(grouped[2].strike, 105);
  console.log("PASS groupRowsByStrike");
})();

// === netCost ===
(function testNetCost() {
  var legs = [
    { side: "buy", qty: 2, entry: 5.0 },
    { side: "sell", qty: 1, entry: 3.0 },
  ];
  var cost = Pricing.netCost(legs, 100);
  assert.ok(approx(cost, 700), "net cost = (2*5 - 1*3) * 100 = 700, got " + cost);

  // With excluded leg
  var legs2 = [
    { side: "buy", qty: 2, entry: 5.0, excluded: true },
    { side: "sell", qty: 1, entry: 3.0 },
  ];
  var cost2 = Pricing.netCost(legs2, 100);
  assert.ok(approx(cost2, -300), "excluded leg ignored: -1*3*100 = -300, got " + cost2);
  console.log("PASS netCost");
})();

console.log("ALL TESTS PASSED");
