(function (root) {
  "use strict";

  var VolModels = {};

  var S = function () { return root.Euro && root.Euro.State; };
  var state = function () { return S() ? S().data : null; };
  var P = function () { return root.Euro && root.Euro.Pricing; };
  var A = function () { return root.Euro && root.Euro.Api; };

  function modeledVol(leg, underlying, days, analysisDate, referenceSpot) {
    if ((leg.right || "").toUpperCase() === "U") { return 0; }
    var tYears = Math.max(0, days / 365);
    var shift = (state() ? state().ivShiftPct : 0) / 100;
    var u = U();
    var mode = u ? u.normalizeVolMode(state() ? state().volMode : "parallel") : "parallel";
    var baseIv;
    if (mode === "parallel") {
      baseIv = leg.iv || (A() ? A().averageIv() : 0.2) || 0.2;
    } else if (mode === "sticky_delta") {
      baseIv = stickyDeltaIvForLeg(leg, underlying, tYears, analysisDate, referenceSpot);
    } else {
      baseIv = strikeIvForLeg(leg);
    }
    var iv = Math.max(0.01, (baseIv || 0.2) + shift);

    return iv;
  }

  function strikeIvForLeg(leg) {
    if ((leg.right || "").toUpperCase() === "U") { return 0; }
    var a = A();
    var row = a ? a.nearestRow(a.rowsForLeg(leg), leg.strike, leg.right) : null;
    return Number.isFinite(row && row.iv) ? row.iv : (leg.iv || (a ? a.averageIv() : 0.2) || 0.2);
  }

  function stickyDeltaIvForLeg(leg, underlying, tYears, analysisDate, referenceSpot) {
    if ((leg.right || "").toUpperCase() === "U") { return 0; }
    var a = A();
    var rows = a ? a.rowsForLeg(leg).filter(function (row) {
      return row.right === leg.right && Number.isFinite(row.iv) && Number.isFinite(row.strike);
    }) : [];
    if (!rows.length) {
      if (typeof console !== "undefined") { console.warn("[stickyDelta] no rows for leg " + leg.strike + leg.right + " expiry=" + leg.expiry + " — fallback to strikeIv"); }
      return strikeIvForLeg(leg);
    }
    var targetDelta = targetDeltaForLeg(leg, tYears, analysisDate, referenceSpot);
    if (!Number.isFinite(targetDelta)) {
      if (typeof console !== "undefined") { console.warn("[stickyDelta] invalid targetDelta — fallback to strikeIv"); }
      return strikeIvForLeg(leg);
    }
    var p = P();
    var smileSpot = Number.isFinite(referenceSpot) && referenceSpot > 0 ? referenceSpot : underlying;
    var samples = p ? p.buildStickyDeltaSamples(rows, smileSpot, tYears, leg.right) : [];
    if (!samples.length) {
      if (typeof console !== "undefined") { console.warn("[stickyDelta] no samples from buildStickyDeltaSamples — fallback to strikeIv"); }
      return strikeIvForLeg(leg);
    }
    var fallbackIv = strikeIvForLeg(leg);
    var mappedIv = p ? p.mapIvFromDelta(samples, targetDelta, fallbackIv) : fallbackIv;

    return mappedIv;
  }

  function stickySmileByScenario(leg, scenarioSpot, tYears) {
    if ((leg.right || "").toUpperCase() === "U") { return []; }
    var a = A();
    var rows = a ? a.rowsForLeg(leg).filter(function (row) {
      return row.right === leg.right && Number.isFinite(row.iv) && Number.isFinite(row.strike);
    }) : [];
    if (!rows.length || !Number.isFinite(scenarioSpot) || scenarioSpot <= 0) { return []; }
    var p = P();
    return p ? p.buildStickyDeltaSamples(rows, scenarioSpot, tYears, leg.right) : [];
  }

  function stickyDeltaDebugInfo(leg, underlying, tYears, analysisDate, referenceSpot) {
    if ((leg.right || "").toUpperCase() === "U") { return null; }
    var samples = stickySmileByScenario(leg, underlying, tYears);
    if (!samples.length) { return null; }
    var targetDelta = targetDeltaForLeg(leg, tYears, analysisDate, referenceSpot);
    if (!Number.isFinite(targetDelta)) { return null; }
    var p = P();
    var mappedIv = p ? p.mapIvFromDelta(samples, targetDelta, strikeIvForLeg(leg)) : strikeIvForLeg(leg);
    var nearestDelta = samples[0].delta;
    var bestDistance = Math.abs(samples[0].delta - targetDelta);
    for (var i = 1; i < samples.length; i += 1) {
      var dist = Math.abs(samples[i].delta - targetDelta);
      if (dist < bestDistance) {
        bestDistance = dist;
        nearestDelta = samples[i].delta;
      }
    }
    return { targetDelta: targetDelta, nearestDelta: nearestDelta, mappedIv: mappedIv };
  }

  function targetDeltaForLeg(leg, tYears, analysisDate, referenceSpot) {
    if ((leg.right || "").toUpperCase() === "U") {
      return leg.side === "sell" ? -1 : 1;
    }
    var a = A();
    var u = U();
    var scenarioSpot = Number.isFinite(referenceSpot) && referenceSpot > 0
      ? referenceSpot
      : (a ? a.currentSpot() : null);
    var strikeIv = strikeIvForLeg(leg);
    var anchorIv = Number.isFinite(leg.iv) && leg.iv > 0
      ? leg.iv
      : (Number.isFinite(strikeIv) && strikeIv > 0 ? strikeIv : 0.2);
    if (Number.isFinite(scenarioSpot) && scenarioSpot > 0) {
      var p = P();
      var bsD = p ? p.bsDelta : null;
      if (bsD) {
        var scenarioDelta = bsD(scenarioSpot, leg.strike, tYears, anchorIv, leg.right);
        if (Number.isFinite(scenarioDelta)) {
          var minAbs = 0.03;
          if (leg.right === "C") {
            return Math.max(minAbs, Math.min(0.99, scenarioDelta));
          }
          return Math.max(-0.99, Math.min(-minAbs, scenarioDelta));
        }
      }
    }
    if (Number.isFinite(leg.delta)) { return leg.delta; }
    var row = a ? a.nearestRow(a.rowsForLeg(leg), leg.strike, leg.right) : null;
    if (row && Number.isFinite(row.delta)) { return row.delta; }
    return leg.right === "C" ? 0.25 : -0.25;
  }

  function U() {
    return root.Euro && root.Euro.Utils;
  }

  VolModels.modeledVol = modeledVol;
  VolModels.strikeIvForLeg = strikeIvForLeg;
  VolModels.stickyDeltaIvForLeg = stickyDeltaIvForLeg;
  VolModels.stickySmileByScenario = stickySmileByScenario;
  VolModels.stickyDeltaDebugInfo = stickyDeltaDebugInfo;
  VolModels.targetDeltaForLeg = targetDeltaForLeg;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = VolModels;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.VolModels = VolModels;
  }
})(this);
