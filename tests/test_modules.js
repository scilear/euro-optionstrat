"use strict";

/**
 * Integration test: verify module boundaries and cross-module contracts.
 * Tests pure modules under Node.js, and verifies all files exist and parse.
 */

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var JS_DIR = path.resolve(__dirname, "..", "static", "js");

// === 1. Verify all module files exist and are non-empty ===
var expectedModules = [
  "state.js", "utils.js", "pricing.js", "api.js",
  "vol-models.js", "chart.js", "ui-controls.js", "templates-trades.js",
];
(function testFilesExist() {
  expectedModules.forEach(function (fname) {
    var fpath = path.join(JS_DIR, fname);
    assert.ok(fs.existsSync(fpath), "missing module: " + fname);
    var stat = fs.statSync(fpath);
    assert.ok(stat.size > 50, fname + " is too small (" + stat.size + " bytes)");
  });
  // app.js in static root
  var appPath = path.resolve(__dirname, "..", "static", "app.js");
  assert.ok(fs.existsSync(appPath), "missing app.js");
  assert.ok(fs.statSync(appPath).size > 100, "app.js too small");
  console.log("PASS all module files exist");
})();

// === 2. Verify JavaScript syntax (parse-check all modules) ===
(function testSyntax() {
  var allFiles = expectedModules.map(function (f) { return path.join(JS_DIR, f); });
  allFiles.push(path.resolve(__dirname, "..", "static", "app.js"));
  allFiles.forEach(function (fpath) {
    assert.doesNotThrow(function () {
      new Function(fs.readFileSync(fpath, "utf-8"));
    }, "Syntax error in " + path.basename(fpath));
  });
  console.log("PASS all modules parse as valid JS");
})();

// === 3. Load pure modules and verify exports ===
(function testPureModuleExports() {
  // State module requires DOM, skip require test
  // Utils module - pure
  var Utils = require("../static/js/utils.js");
  assert.equal(typeof Utils.parseDate, "function", "utils.parseDate");
  assert.equal(typeof Utils.normalizeQty, "function", "utils.normalizeQty");
  assert.equal(typeof Utils.maxAnalysisDte, "function", "utils.maxAnalysisDte");
  assert.equal(typeof Utils.numberOr, "function", "utils.numberOr");

  // Pricing module - pure
  var Pricing = require("../static/js/pricing.js");
  assert.equal(typeof Pricing.blackScholes, "function", "pricing.blackScholes");
  assert.equal(typeof Pricing.bsDelta, "function", "pricing.bsDelta");
  assert.equal(typeof Pricing.netCost, "function", "pricing.netCost");

  // Verify cross-module consistency: Utils functions used by Pricing
  assert.equal(typeof Utils.numberOr, "function");
  console.log("PASS pure module exports");
})();

// === 4. Verify module dependency chain ===
(function testDependencyOrder() {
  var scriptOrder = [
    "state.js",
    "utils.js",
    "pricing.js",
    "api.js",
    "vol-models.js",
    "chart.js",
    "ui-controls.js",
    "templates-trades.js",
    "../app.js",
  ];
  // Verify all script tags in index.html follow this order
  var indexHtml = fs.readFileSync(
    path.resolve(__dirname, "..", "static", "index.html"), "utf-8"
  );
  var scriptTags = [];
  var re = /<script src="([^"]+)"><\/script>/g;
  var match;
  while ((match = re.exec(indexHtml)) !== null) {
    scriptTags.push(match[1]);
  }
  var expectedPaths = scriptOrder.map(function (f) {
    return f.indexOf("../") === 0 ? "/" + f.replace("../", "") : "/js/" + f;
  });
  assert.deepEqual(scriptTags, expectedPaths, "Script tag order mismatch");
  console.log("PASS script dependency order in index.html");
})();

// === 5. Verify IIFE pattern consistency ===
(function testIIFEPattern() {
  var allFiles = expectedModules.map(function (f) { return path.join(JS_DIR, f); });
  allFiles.push(path.resolve(__dirname, "..", "static", "app.js"));
  allFiles.forEach(function (fpath) {
    var content = fs.readFileSync(fpath, "utf-8");
    if (fpath.indexOf("app.js") >= 0) {
      // app.js is a bare script (no IIFE), just check Euro assignment
      assert.ok(
        content.indexOf("Euro") >= 0,
        "app.js should reference Euro"
      );
    } else {
      // All other modules should be IIFE-wrapped
      assert.ok(
        content.indexOf("(function") >= 0 || content.indexOf("(function ") >= 0,
        path.basename(fpath) + " should be IIFE-wrapped"
      );
      // And should export to either module.exports or window.Euro
      assert.ok(
        content.indexOf("module.exports") >= 0 || content.indexOf("Euro.") >= 0,
        path.basename(fpath) + " should export"
      );
    }
  });
  console.log("PASS IIFE pattern consistency");
})();

// === 6. Verify no duplicate exports across modules ===
(function testNoDuplicateExports() {
  // Load both pure modules and verify no overlapping top-level exports
  var Utils = require("../static/js/utils.js");
  var Pricing = require("../static/js/pricing.js");
  var utilsKeys = Object.keys(Utils).sort();
  var pricingKeys = Object.keys(Pricing).sort();
  // These modules should have distinct functions (no overlap expected)
  var overlap = utilsKeys.filter(function (k) { return pricingKeys.indexOf(k) >= 0; });
  // 'formatGreek' could be shared conceptually but should not be in both
  assert.equal(overlap.length, 0, "Overlapping exports: " + overlap.join(", "));
  console.log("PASS no duplicate exports across pure modules");
})();

console.log("ALL MODULE INTEGRATION TESTS PASSED");
