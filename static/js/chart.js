(function (root) {
  "use strict";

  var Chart = {};

  var S = function () { return root.Euro && root.Euro.State; };
  var state = function () { return S() ? S().data : null; };
  var els = function () { return S() ? S().els : null; };
  var P = function () { return root.Euro && root.Euro.Pricing; };
  var A = function () { return root.Euro && root.Euro.Api; };
  var V = function () { return root.Euro && root.Euro.VolModels; };
  var U = function () { return root.Euro && root.Euro.Utils; };

  function computeSeries() {
    var st = state();
    if (!st || !st.ticker) {
      return { active: [], dash: [], final: [] };
    }
    var a = A();
    var liveSpot = a ? a.currentSpot() : null;
    var scenario = a ? a.scenarioSpot() : null;
    var rangeSpot = Number.isFinite(liveSpot) && liveSpot > 0 ? liveSpot : scenario;

    if (!rangeSpot || !st.legs.length) {
      return { active: [], dash: [], final: [] };
    }
    var minMax = visibleStrikeRange(rangeSpot);
    var minStrike = minMax[0];
    var maxStrike = minMax[1];
    var u = U();
    var st2 = state();
    var minExpiryDateValue = minExpiryDate();
    var analysisDate = st2 ? u.addBusinessDays(S().today, st2.dateOffset) : u.addBusinessDays(S().today, 0);
    analysisDate = u.startOfDay(analysisDate);
    if (u && analysisDate > minExpiryDateValue) {
      analysisDate = minExpiryDateValue;
    }
    var finalDate = u.startOfDay(finalExpiryDate());
    var dashDate = minExpiryDateValue;
    var active = [];
    var dash = [];
    var finalLocal = [];
    var steps = 180;
    for (var index = 0; index <= steps; index += 1) {
      var underlying = minStrike + ((maxStrike - minStrike) * index) / steps;
      active.push({ x: underlying, y: strategyPnl(underlying, analysisDate, scenario) });
      dash.push({ x: underlying, y: strategyPnl(underlying, dashDate, scenario) });
      finalLocal.push({ x: underlying, y: strategyPnl(underlying, finalDate, scenario) });
    }
    return { active: active, dash: dash, final: finalLocal };
  }

  function minExpiryDate() {
    var st = state();
    if (!st) { return S().today; }
    var u = U();
    var optionLegs = st.legs.filter(function (leg) { return (leg.right || "").toUpperCase() !== "U"; });
    if (!optionLegs.length) {
      return u.startOfDay(u.parseDate(st.selectedExpiry || (st.expiries[0] && st.expiries[0].date))) || S().today;
    }
    return new Date(Math.min.apply(null, optionLegs.map(function (leg) {
      return u.startOfDay(u.parseDate(leg.expiry)).getTime();
    })));
  }

  function finalExpiryDate() {
    var st = state();
    if (!st) { return S().today; }
    var u = U();
    var optionLegs = st.legs.filter(function (leg) { return (leg.right || "").toUpperCase() !== "U"; });
    if (!optionLegs.length) {
      return u.startOfDay(u.parseDate(st.selectedExpiry || (st.expiries[0] && st.expiries[0].date))) || S().today;
    }
    return new Date(Math.max.apply(null, optionLegs.map(function (leg) {
      return u.startOfDay(u.parseDate(leg.expiry)).getTime();
    })));
  }

  function strategyPnl(underlying, analysisDate, referenceSpot) {
    var st = state();
    if (!st) { return 0; }
    return st.legs.reduce(function (sum, leg) {
      if (leg.excluded) { return sum; }
      var sign = leg.side === "buy" ? 1 : -1;
      var current = optionValue(leg, underlying, analysisDate, referenceSpot);
      return sum + sign * (current - leg.entry) * leg.qty * st.multiplier;
    }, 0);
  }

  function optionValue(leg, underlying, analysisDate, referenceSpot) {
    if ((leg.right || "").toUpperCase() === "U") { return underlying; }
    var u = U();
    var expiryDate = u.startOfDay(u.parseDate(leg.expiry));
    var analysis = u.startOfDay(analysisDate);
    var days = Math.max(0, u.businessDaysBetween(analysis, expiryDate));
    var intrinsic = leg.right === "C"
      ? Math.max(0, underlying - leg.strike)
      : Math.max(0, leg.strike - underlying);
    if (days <= 0) { return intrinsic; }
    var v = V();
    var iv = v ? v.modeledVol(leg, underlying, days, analysis, referenceSpot) : 0.2;
    var p = P();
    return p ? p.blackScholes(underlying, leg.strike, days / 365, iv, leg.right) : intrinsic;
  }

  function visibleStrikeRange(spot) {
    var st = state();
    var pct = Math.max(0.01, (st ? st.rangePct : 12) / 100);
    return [spot * (1 - pct), spot * (1 + pct)];
  }

  function computeComboGreeks() {
    var a = A();
    var spot = a ? a.scenarioSpot() : null;
    var st = state();
    var u = U();
    if (!Number.isFinite(spot) || spot <= 0) {
      return { delta: 0, gamma: 0, vegaPerVolPt: 0, thetaPerDay: 0 };
    }
    var analysisDate = u.startOfDay(u.addBusinessDays(S().today, st ? st.dateOffset : 0));
    var delta = 0;
    var gamma = 0;
    var vega = 0;
    var theta = 0;
    for (var i = 0; i < st.legs.length; i += 1) {
      var leg = st.legs[i];
      if (leg.excluded) { continue; }
      if ((leg.right || "").toUpperCase() === "U") {
        var stockSign = leg.side === "buy" ? 1 : -1;
        delta += stockSign * leg.qty * st.multiplier;
        continue;
      }
      var expiryDate = u.startOfDay(u.parseDate(leg.expiry));
      var days = Math.max(0, u.businessDaysBetween(analysisDate, expiryDate));
      var tYears = Math.max(0, days / 365);
      if (tYears <= 0) { continue; }
      var v = V();
      var iv = v ? v.modeledVol(leg, spot, days, analysisDate, spot) : 0.2;
      var p = P();
      var greeks = p ? p.optionGreeks(spot, leg.strike, tYears, iv, leg.right) : { delta: 0, gamma: 0, vega: 0, theta: 0 };
      var sign = leg.side === "buy" ? 1 : -1;
      var size = sign * leg.qty * st.multiplier;
      delta += greeks.delta * size;
      gamma += greeks.gamma * size;
      vega += greeks.vega * size;
      theta += greeks.theta * size;
    }
    return {
      delta: delta,
      gamma: gamma,
      vegaPerVolPt: vega * 0.01,
      thetaPerDay: theta / 365,
    };
  }

  function makeTicks(minValue, maxValue, count) {
    var rawStep = (maxValue - minValue) / count;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var normalized = rawStep / magnitude;
    var step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;
    var ticks = [];
    var value = Math.ceil(minValue / step) * step;
    while (value <= maxValue) {
      ticks.push(value);
      value += step;
    }
    return ticks;
  }

  function drawChart() {
    var e = els();
    var st = state();
    if (!e || !e.plChart || !st) { return; }
    var canvas = e.plChart;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var width = rect.width;
    var height = rect.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#080613";
    ctx.fillRect(0, 0, width, height);
    var series = computeSeries();
    if (!series.active.length) {
      drawEmptyChart(ctx, width, height);
      return;
    }
    var margin = { top: 24, right: 28, bottom: 34, left: 68 };
    var plotW = width - margin.left - margin.right;
    var plotH = height - margin.top - margin.bottom;
    var yValues = [];
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _i = 0, _arr = [series.active, series.dash, series.final]; _i < _arr.length; _i += 1) {
        var pts = _arr[_i];
        for (var _i2 = 0; _i2 < pts.length; _i2 += 1) {
          yValues.push(pts[_i2].y);
        }
      }
    } finally {}
    var yMin = Math.min.apply(null, yValues.concat([0]));
    var yMax = Math.max.apply(null, yValues.concat([0]));
    if (yMax - yMin < 1) {
      yMax += 1;
      yMin -= 1;
    }
    var pad = (yMax - yMin) * 0.12;
    yMax += pad;
    yMin -= pad;
    var xMin = series.active[0].x;
    var xMax = series.active[series.active.length - 1].x;
    var xMap = function (x) { return margin.left + ((x - xMin) / (xMax - xMin)) * plotW; };
    var yMap = function (y) { return margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotH; };
    var zeroY = yMap(0);
    var activeValues = series.active.map(function (point) { return point.y; });
    var activeMin = Math.min.apply(null, activeValues);
    var activeMax = Math.max.apply(null, activeValues);
    ctx.fillStyle = "rgba(0, 160, 92, 0.13)";
    ctx.fillRect(margin.left, margin.top, plotW, Math.max(0, zeroY - margin.top));
    ctx.fillStyle = "rgba(205, 0, 40, 0.24)";
    ctx.fillRect(margin.left, zeroY, plotW, Math.max(0, margin.top + plotH - zeroY));
    drawGrid(ctx, margin, plotW, plotH, xMin, xMax, yMin, yMax, xMap, yMap);
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#c7c1dc";
    ctx.fillText("Displayed curve", margin.left, 12);
    ctx.fillStyle = "#16d36f";
    ctx.fillText("Max " + formatMoney(activeMax), margin.left + 100, 12);
    ctx.fillStyle = "#ff6666";
    ctx.fillText("Min " + formatMoney(activeMin), margin.left + 235, 12);
    drawSeries(ctx, series.final, xMap, yMap, "#8b839e", false);
    drawSeries(ctx, series.dash, xMap, yMap, "#4f6af9", true);
    drawSegmentedSeries(ctx, series.active, xMap, yMap);
    var tradeHistoryPoints = (Array.isArray(st.tradePnlHistory) ? st.tradePnlHistory : [])
      .map(tradeHistoryPointFromSnapshot)
      .filter(Boolean)
      .sort(function (a, b) { return a.x - b.x; });
    if (tradeHistoryPoints.length > 0) {
      var xMinTs = tradeHistoryPoints[0].x.getTime();
      var xMaxTs = tradeHistoryPoints[tradeHistoryPoints.length - 1].x.getTime();
      var span = Math.max(1, xMaxTs - xMinTs);
      for (var _i3 = 0; _i3 < tradeHistoryPoints.length; _i3 += 1) {
        var point = tradeHistoryPoints[_i3];
        var px = margin.left + ((point.x.getTime() - xMinTs) / span) * plotW;
        var py = yMap(point.y);
        point.px = px;
        point.py = py;
        ctx.fillStyle = "#ffd84d";
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#080613";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    var a = A();
    var scenSpot = a ? a.scenarioSpot() : null;
    if (scenSpot) {
      var spotX = xMap(scenSpot);
      ctx.strokeStyle = "#f4f1ff";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(spotX, margin.top);
      ctx.lineTo(spotX, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f4f1ff";
      var baseSpot = a ? a.currentSpot() : null;
      var label = st.spotShiftPct
        ? (st.ticker + " " + formatStrike(scenSpot) + " (shifted)")
        : (st.ticker + " " + formatStrike(baseSpot || scenSpot));
      ctx.fillText(label, spotX + 6, margin.top + 14);
    }
    ctx.strokeStyle = "#f4f1ff";
    ctx.beginPath();
    ctx.moveTo(margin.left, zeroY);
    ctx.lineTo(margin.left + plotW, zeroY);
    ctx.stroke();
    if (st.chartHoverPx !== null) {
      drawChartHover(ctx, margin, plotW, plotH, xMap, yMap, series, tradeHistoryPoints, scenSpot);
    }
    if (root.Euro && root.Euro.UI) {
      root.Euro.UI.renderLegsOverlay();
    }
  }

  function drawChartHover(ctx, margin, plotW, plotH, xMap, yMap, series, tradeHistoryPoints, scenSpot) {
    var st = state();
    if (!st) { return; }
    var hoverX = Math.max(margin.left, Math.min(margin.left + plotW, st.chartHoverPx));
    var hoverY = Number.isFinite(st.chartHoverPy)
      ? Math.max(margin.top, Math.min(margin.top + plotH, st.chartHoverPy))
      : null;
    var selectedHistoryPoint = null;
    if (tradeHistoryPoints.length) {
      var nearest = null;
      var nearestDist = Number.POSITIVE_INFINITY;
      for (var _i4 = 0; _i4 < tradeHistoryPoints.length; _i4 += 1) {
        var pt = tradeHistoryPoints[_i4];
        var dx = (pt.px || 0) - hoverX;
        var dy = hoverY === null ? 0 : (pt.py || 0) - hoverY;
        var dist = Math.hypot(dx, dy);
        if (dist < nearestDist) {
          nearest = pt;
          nearestDist = dist;
        }
      }
      if (nearest && nearestDist <= 14) {
        selectedHistoryPoint = nearest;
      }
    }
    var pointX;
    var pointY;
    var lines;
    var u = U();
    if (selectedHistoryPoint) {
      pointX = selectedHistoryPoint.px;
      pointY = selectedHistoryPoint.py;
      lines = [
        "Saved P/L " + formatMoney(selectedHistoryPoint.y),
        u ? u.formatTimestampLocal(selectedHistoryPoint.label) : selectedHistoryPoint.label,
      ];
    } else {
      var ratio = (hoverX - margin.left) / plotW;
      var index = Math.max(0, Math.min(series.active.length - 1, Math.round(ratio * (series.active.length - 1))));
      var point = series.active[index];
      pointX = xMap(point.x);
      pointY = yMap(point.y);
      var pctMove = scenSpot ? ((point.x / scenSpot) - 1) * 100 : 0;
      var pctText = scenSpot ? " (" + (pctMove >= 0 ? "+" : "") + pctMove.toFixed(2) + "%)" : "";
      lines = ["Price " + formatStrike(point.x) + pctText, "P/L " + formatMoney(point.y)];
    }
    ctx.save();
    ctx.strokeStyle = "rgba(244, 241, 255, 0.45)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pointX, margin.top);
    ctx.lineTo(pointX, margin.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, pointY);
    ctx.lineTo(margin.left + plotW, pointY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = (selectedHistoryPoint ? selectedHistoryPoint.y : (point ? point.y : 0)) >= 0 ? "#16d36f" : "#ff4242";
    ctx.beginPath();
    ctx.arc(pointX, pointY, 4, 0, Math.PI * 2);
    ctx.fill();
    var lineHeight = 14;
    var textWidth = Math.max.apply(null, lines.map(function (line) { return ctx.measureText(line).width; }));
    var boxWidth = textWidth + 14;
    var boxHeight = lines.length * lineHeight + 10;
    var boxX = pointX + 10;
    var boxY = pointY - boxHeight - 10;
    if (boxX + boxWidth > margin.left + plotW) {
      boxX = pointX - boxWidth - 10;
    }
    if (boxY < margin.top + 4) {
      boxY = pointY + 10;
    }
    ctx.fillStyle = "rgba(8, 6, 19, 0.95)";
    ctx.strokeStyle = "rgba(244, 241, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = "#f4f1ff";
    ctx.font = "12px Inter, sans-serif";
    for (var _i5 = 0; _i5 < lines.length; _i5 += 1) {
      ctx.fillText(lines[_i5], boxX + 7, boxY + 16 + _i5 * lineHeight);
    }
    ctx.restore();
  }

  function drawEmptyChart(ctx, width, height) {
    ctx.fillStyle = "#a7a0bc";
    ctx.textAlign = "center";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("Add buy/sell contracts from the chain to plot P/L.", width / 2, height / 2);
  }

  function drawGrid(ctx, margin, plotW, plotH, xMin, xMax, yMin, yMax, xMap, yMap) {
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "#a7a0bc";
    ctx.strokeStyle = "rgba(88, 81, 109, 0.28)";
    ctx.lineWidth = 1;
    for (var i = 0; i <= 5; i += 1) {
      var y = yMin + ((yMax - yMin) * i) / 5;
      var py = yMap(y);
      ctx.beginPath();
      ctx.moveTo(margin.left, py);
      ctx.lineTo(margin.left + plotW, py);
      ctx.stroke();
      ctx.fillText(formatMoney(y), margin.left - 8, py + 4);
    }
    ctx.textAlign = "center";
    for (var _i6 = 0; _i6 <= 8; _i6 += 1) {
      var x = xMin + ((xMax - xMin) * _i6) / 8;
      var px = xMap(x);
      ctx.beginPath();
      ctx.moveTo(px, margin.top);
      ctx.lineTo(px, margin.top + plotH);
      ctx.stroke();
      ctx.fillText(formatStrike(x), px, margin.top + plotH + 20);
    }
  }

  function drawSeries(ctx, points, xMap, yMap, color, dashed) {
    if (points.length < 2) { return; }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dashed ? [2, 5] : []);
    ctx.beginPath();
    ctx.moveTo(xMap(points[0].x), yMap(points[0].y));
    for (var i = 1; i < points.length; i += 1) {
      ctx.lineTo(xMap(points[i].x), yMap(points[i].y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSegmentedSeries(ctx, points, xMap, yMap) {
    for (var i = 1; i < points.length; i += 1) {
      var prev = points[i - 1];
      var curr = points[i];
      ctx.strokeStyle = curr.y >= 0 ? "#16d36f" : "#ff4242";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xMap(prev.x), yMap(prev.y));
      ctx.lineTo(xMap(curr.x), yMap(curr.y));
      ctx.stroke();
    }
  }

  function tradeHistoryPointFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") { return null; }
    var pnl = Number(snapshot.pnl_mark_to_close);
    if (!Number.isFinite(pnl)) { return null; }
    var stamp = String(snapshot.timestamp_utc || "").trim();
    var u = U();
    var date = u ? u.parseUtcStamp(stamp) : null;
    if (!date) { return null; }
    return { x: date, y: pnl, label: stamp };
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) { return "-"; }
    var st = state();
    var abs = Math.abs(value);
    var formatted = abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return (value < 0 ? "-" : "") + (st ? st.currency : "USD") + " " + formatted;
  }

  function formatStrike(value) {
    if (!Number.isFinite(value)) { return "-"; }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: value % 1 === 0 ? 0 : (value < 10 ? 2 : 1),
    });
  }

  Chart.computeSeries = computeSeries;
  Chart.minExpiryDate = minExpiryDate;
  Chart.finalExpiryDate = finalExpiryDate;
  Chart.strategyPnl = strategyPnl;
  Chart.optionValue = optionValue;
  Chart.visibleStrikeRange = visibleStrikeRange;
  Chart.computeComboGreeks = computeComboGreeks;
  Chart.makeTicks = makeTicks;
  Chart.drawChart = drawChart;
  Chart.drawEmptyChart = drawEmptyChart;
  Chart.drawGrid = drawGrid;
  Chart.drawSeries = drawSeries;
  Chart.drawSegmentedSeries = drawSegmentedSeries;
  Chart.tradeHistoryPointFromSnapshot = tradeHistoryPointFromSnapshot;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Chart;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Chart = Chart;
  }
})(this);
