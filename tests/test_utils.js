"use strict";

var assert = require("assert");
var Utils = require("../static/js/utils.js");

(function testParseDate() {
  var d = Utils.parseDate("2026-06-19");
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 19);
  assert.ok(Utils.parseDate("") === null);
  assert.ok(Utils.parseDate(null) === null);
  console.log("PASS parseDate");
})();

(function testStartOfDay() {
  var d = Utils.startOfDay(new Date(2026, 5, 19, 12, 30, 45));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  console.log("PASS startOfDay");
})();

(function testAddDays() {
  var d = Utils.addDays(new Date(2026, 5, 19), 5);
  assert.equal(d.getDate(), 24);
  var d2 = Utils.addDays(new Date(2026, 11, 30), 5);
  assert.equal(d2.getFullYear(), 2027);
  assert.equal(d2.getMonth(), 0);
  assert.equal(d2.getDate(), 4);
  console.log("PASS addDays");
})();

(function testDteFromExpiry() {
  assert.equal(Utils.dteFromExpiry("2026-06-24", new Date(2026, 5, 19)), 5);
  assert.equal(Utils.dteFromExpiry("", new Date(2026, 5, 19)), 0);
  assert.equal(Utils.dteFromExpiry("2026-06-19", null), 0);
  console.log("PASS dteFromExpiry");
})();

(function testNormalizeVolMode() {
  assert.equal(Utils.normalizeVolMode("parallel"), "parallel");
  assert.equal(Utils.normalizeVolMode("sticky_strike"), "sticky_strike");
  assert.equal(Utils.normalizeVolMode("sticky_delta"), "sticky_delta");
  assert.equal(Utils.normalizeVolMode("unknown"), "parallel");
  assert.equal(Utils.normalizeVolMode(""), "parallel");
  assert.equal(Utils.normalizeVolMode(null), "parallel");
  console.log("PASS normalizeVolMode");
})();

(function testRoundTo() {
  assert.equal(Utils.roundTo(123.45, 5), 125);
  assert.equal(Utils.roundTo(122.45, 5), 120);
  assert.equal(Utils.roundTo(3.14159, 0.01), 3.14);
  console.log("PASS roundTo");
})();

(function testNumberOr() {
  assert.equal(Utils.numberOr("42", 0), 42);
  assert.equal(Utils.numberOr("abc", -1), -1);
  assert.equal(Utils.numberOr(undefined, -1), -1);
  assert.equal(Utils.numberOr(null, -1), 0, "Number(null)=0 is finite");
  console.log("PASS numberOr");
})();

(function testFormats() {
  assert.ok(Utils.formatStrike(1000).indexOf("1") >= 0);
  assert.notEqual(Utils.formatStrike(99.5), "-");
  assert.ok(Utils.formatNumber(1234.5).indexOf("1") >= 0);
  assert.ok(Utils.formatMoney(-5000, "USD").indexOf("USD") >= 0);
  assert.ok(Utils.formatMoney(-5000, "USD").indexOf("-") >= 0);
  assert.equal(Utils.formatPrice(5.678), "5.68");
  assert.equal(Utils.formatPrice(150.5), "150.5");
  assert.equal(Utils.formatIv(0.185), "18.5%");
  assert.ok(Utils.formatGreek(0.4567).indexOf("0.46") >= 0);
  assert.ok(Utils.formatGreek(-0.4567, 3).indexOf("-") >= 0);
  assert.equal(Utils.formatAgeSeconds(0), "0s");
  assert.equal(Utils.formatAgeSeconds(45), "45s");
  assert.equal(Utils.formatAgeSeconds(120), "2m");
  assert.equal(Utils.formatAgeSeconds(3660), "1h 1m");
  assert.equal(Utils.formatAgeSeconds(7200), "2h");

  assert.equal(Utils.formatStrike(null), "-");
  assert.equal(Utils.formatNumber("abc"), "-");
  assert.equal(Utils.formatMoney(null, "EUR"), "-");
  assert.equal(Utils.formatPrice(null), "-");
  assert.equal(Utils.formatIv(null), "IV -");
  assert.equal(Utils.formatGreek(null), "-");
  console.log("PASS formats");
})();

(function testFormatTimestampLocal() {
  var ts = Utils.formatTimestampLocal("2026-06-03T10:00:00Z");
  assert.ok(typeof ts === "string" && ts.length > 0);
  assert.equal(Utils.formatTimestampLocal(""), "");
  assert.equal(Utils.formatTimestampLocal(null), "");
  console.log("PASS formatTimestampLocal");
})();

(function testDefaultNames() {
  var tn = Utils.defaultTradeName("SPX");
  assert.ok(tn.indexOf("SPX") === 0);
  var tpl = Utils.defaultTemplateName("SPX");
  assert.ok(tpl.indexOf("SPX") === 0);
  assert.ok(tpl.indexOf("template") > 0);
  console.log("PASS defaultNames");
})();

(function testExpiryForDte() {
  var exps = [
    { date: "2026-06-19", dte: 16 },
    { date: "2026-07-17", dte: 44 },
    { date: "2026-08-21", dte: 79 },
  ];
  assert.equal(Utils.expiryForDte(16, exps), "2026-06-19");
  assert.equal(Utils.expiryForDte(30, exps), "2026-06-19");
  assert.equal(Utils.expiryForDte(90, exps), "2026-08-21");
  assert.equal(Utils.expiryForDte(16, []), "");
  assert.equal(Utils.expiryForDte(16, null), "");
  console.log("PASS expiryForDte");
})();

(function testStickyDebugEnabled() {
  assert.equal(Utils.stickyDebugEnabled(), false);
  console.log("PASS stickyDebugEnabled (default false)");
})();

(function testParseUtcStamp() {
  var p = Utils.parseUtcStamp("2026-06-03T10:00:00Z");
  assert.ok(p instanceof Date);
  assert.ok(Utils.parseUtcStamp("") === null);
  assert.ok(Utils.parseUtcStamp(null) === null);
  console.log("PASS parseUtcStamp");
})();

(function testNormalizeQty() {
  assert.equal(Utils.normalizeQty("42", 1), 42);
  assert.equal(Utils.normalizeQty("abc", 10), 10, "invalid string uses fallback");
  assert.equal(Utils.normalizeQty(0, 1), 0, "zero returns 0");
  assert.equal(Utils.normalizeQty(-5, 1), 0, "negative returns 0");
  assert.equal(Utils.normalizeQty(3.7, 1), 3, "float floors to 3");
  assert.equal(Utils.normalizeQty("5", 1), 5);
  assert.equal(Utils.normalizeQty(1, undefined), 1, "default fallback is 1");
  console.log("PASS normalizeQty");
})();

(function testMaxAnalysisDte() {
  var today = new Date(2026, 5, 3);
  var legDays = 19;
  var legs = [
    { right: "C", expiry: "2026-06-22" },
  ];
  var selectedExpiry = "2026-06-22";
  var expiries = [{ date: "2026-06-22", dte: 19 }];
  var dte = Utils.maxAnalysisDte(legs, selectedExpiry, expiries, today);
  assert.ok(dte >= 18 && dte <= 20, "max DTE should be ~19, got " + dte);

  var dte2 = Utils.maxAnalysisDte([], selectedExpiry, expiries, today);
  assert.ok(dte2 >= 18 && dte2 <= 20, "empty legs uses selectedExpiry, got " + dte2);

  var dte3 = Utils.maxAnalysisDte([], "", [], today);
  assert.equal(dte3, 1, "no data returns minimum 1, got " + dte3);
  console.log("PASS maxAnalysisDte");
})();

console.log("ALL UTILS TESTS PASSED");
