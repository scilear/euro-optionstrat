(function (root) {
  "use strict";

  const Pricing = {};

  function normCdf(value) {
    var sign = value < 0 ? -1 : 1;
    var x = Math.abs(value) / Math.sqrt(2);
    var t = 1 / (1 + 0.3275911 * x);
    var a1 = 0.254829592;
    var a2 = -0.284496736;
    var a3 = 1.421413741;
    var a4 = -1.453152027;
    var a5 = 1.061405429;
    var erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
  }
  Pricing.normCdf = normCdf;

  function normPdf(value) {
    return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
  }
  Pricing.normPdf = normPdf;

  function blackScholes(spot, strike, tYears, vol, right) {
    var rate = 0.03;
    if (tYears <= 0 || vol <= 0) {
      return right === "C" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    }
    var volSqrt = vol * Math.sqrt(tYears);
    var d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * tYears) / volSqrt;
    var d2 = d1 - volSqrt;
    var discount = Math.exp(-rate * tYears);
    if (right === "C") {
      return Math.max(0, spot * normCdf(d1) - strike * discount * normCdf(d2));
    }
    return Math.max(0, strike * discount * normCdf(-d2) - spot * normCdf(-d1));
  }
  Pricing.blackScholes = blackScholes;

  function bsDelta(spot, strike, tYears, vol, right) {
    if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) {
      return Number.NaN;
    }
    if (tYears <= 0 || vol <= 0) {
      if (right === "C") {
        return spot > strike ? 1 : 0;
      }
      return spot < strike ? -1 : 0;
    }
    var volSqrt = vol * Math.sqrt(tYears);
    if (volSqrt <= 0) {
      return Number.NaN;
    }
    var d1 = (Math.log(spot / strike) + (0.03 + 0.5 * vol * vol) * tYears) / volSqrt;
    return right === "C" ? normCdf(d1) : (normCdf(d1) - 1);
  }
  Pricing.bsDelta = bsDelta;

  function optionGreeks(spot, strike, tYears, vol, right) {
    if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) {
      return { delta: 0, gamma: 0, vega: 0, theta: 0 };
    }
    var rate = 0.03;
    if (tYears <= 0 || vol <= 0) {
      var intrinsicDelta = right === "C" ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0);
      return { delta: intrinsicDelta, gamma: 0, vega: 0, theta: 0 };
    }
    var sqrtT = Math.sqrt(tYears);
    var volSqrt = vol * sqrtT;
    if (volSqrt <= 0) {
      return { delta: 0, gamma: 0, vega: 0, theta: 0 };
    }
    var d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * tYears) / volSqrt;
    var d2 = d1 - volSqrt;
    var pdf = normPdf(d1);
    var discount = Math.exp(-rate * tYears);
    var delta = right === "C" ? normCdf(d1) : normCdf(d1) - 1;
    var gamma = pdf / (spot * volSqrt);
    var vega = spot * pdf * sqrtT;
    var theta;
    if (right === "C") {
      theta = -((spot * pdf * vol) / (2 * sqrtT)) - rate * strike * discount * normCdf(d2);
    } else {
      theta = -((spot * pdf * vol) / (2 * sqrtT)) + rate * strike * discount * normCdf(-d2);
    }
    return { delta: delta, gamma: gamma, vega: vega, theta: theta };
  }
  Pricing.optionGreeks = optionGreeks;

  function isStockLeg(leg) {
    return String((leg && leg.right) || "").toUpperCase() === "U";
  }
  Pricing.isStockLeg = isStockLeg;

  function quantileSorted(sortedValues, q) {
    if (!sortedValues.length) {
      return Number.NaN;
    }
    if (sortedValues.length === 1) {
      return sortedValues[0];
    }
    var pos = (sortedValues.length - 1) * q;
    var lower = Math.floor(pos);
    var upper = Math.ceil(pos);
    if (lower === upper) {
      return sortedValues[lower];
    }
    var ratio = pos - lower;
    return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * ratio;
  }
  Pricing.quantileSorted = quantileSorted;

  function collapseStickyBucket(bucket) {
    var delta = bucket.reduce(function (sum, item) { return sum + item.delta; }, 0) / bucket.length;
    var sortedIvs = bucket.map(function (item) { return item.iv; }).sort(function (a, b) { return a - b; });
    var midIdx = Math.floor(sortedIvs.length / 2);
    var iv = sortedIvs.length % 2
      ? sortedIvs[midIdx]
      : (sortedIvs[midIdx - 1] + sortedIvs[midIdx]) / 2;
    return { delta: delta, iv: iv };
  }
  Pricing.collapseStickyBucket = collapseStickyBucket;

  function mapIvFromDelta(smileSamples, targetDelta, fallbackIv) {
    if (!smileSamples.length || !Number.isFinite(targetDelta)) {
      return Number.isFinite(fallbackIv) ? fallbackIv : 0.2;
    }
    if (targetDelta <= smileSamples[0].delta) {
      return smileSamples[0].iv;
    }
    if (targetDelta >= smileSamples[smileSamples.length - 1].delta) {
      return smileSamples[smileSamples.length - 1].iv;
    }
    for (var i = 1; i < smileSamples.length; i += 1) {
      var prev = smileSamples[i - 1];
      var curr = smileSamples[i];
      if (targetDelta < prev.delta || targetDelta > curr.delta) {
        continue;
      }
      var width = curr.delta - prev.delta;
      if (!Number.isFinite(width) || Math.abs(width) < 1e-9) {
        return curr.iv;
      }
      var ratio = (targetDelta - prev.delta) / width;
      return prev.iv + (curr.iv - prev.iv) * ratio;
    }
    return Number.isFinite(fallbackIv) ? fallbackIv : smileSamples[0].iv;
  }
  Pricing.mapIvFromDelta = mapIvFromDelta;

  function buildStickyDeltaSamples(rows, scenarioSpot, tYears, right) {
    var raw = rows
      .map(function (row) {
        var iv = Number(row.iv);
        var strike = Number(row.strike);
        if (!Number.isFinite(iv) || iv <= 0 || !Number.isFinite(strike) || strike <= 0) {
          return null;
        }
        var delta = bsDelta(scenarioSpot, strike, tYears, iv, right);
        if (!Number.isFinite(delta)) {
          return null;
        }
        return { delta: delta, iv: iv };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.delta - b.delta; });

    if (raw.length < 3) {
      return raw;
    }

    var bucketTolerance = 0.0025;
    var bucketed = [];
    var bucket = [raw[0]];
    for (var si = 1; si < raw.length; si += 1) {
      var sample = raw[si];
      var center = bucket.reduce(function (sum, item) { return sum + item.delta; }, 0) / bucket.length;
      if (Math.abs(sample.delta - center) <= bucketTolerance) {
        bucket.push(sample);
        continue;
      }
      bucketed.push(collapseStickyBucket(bucket));
      bucket = [sample];
    }
    bucketed.push(collapseStickyBucket(bucket));

    if (bucketed.length < 3) {
      return bucketed;
    }

    var ivs = bucketed.map(function (item) { return item.iv; }).sort(function (a, b) { return a - b; });
    var ivLo = quantileSorted(ivs, 0.05);
    var ivHi = quantileSorted(ivs, 0.95);
    var winsorized = bucketed.map(function (item) {
      return { delta: item.delta, iv: Math.max(ivLo, Math.min(ivHi, item.iv)) };
    });

    var smoothed = winsorized.map(function (item, index) {
      var start = Math.max(0, index - 2);
      var end = Math.min(winsorized.length - 1, index + 2);
      var weightedSum = 0;
      var weightTotal = 0;
      for (var wi = start; wi <= end; wi += 1) {
        var distance = Math.abs(wi - index);
        var weight = distance === 0 ? 3 : distance === 1 ? 2 : 1;
        weightedSum += winsorized[wi].iv * weight;
        weightTotal += weight;
      }
      return {
        delta: item.delta,
        iv: weightTotal ? weightedSum / weightTotal : item.iv,
      };
    });

    return smoothed;
  }
  Pricing.buildStickyDeltaSamples = buildStickyDeltaSamples;

  function breakevens(points) {
    var result = [];
    for (var index = 1; index < points.length; index += 1) {
      var prev = points[index - 1];
      var curr = points[index];
      if (prev.y === 0) {
        result.push(prev.x);
      }
      if ((prev.y < 0 && curr.y > 0) || (prev.y > 0 && curr.y < 0)) {
        var ratio = Math.abs(prev.y) / (Math.abs(prev.y) + Math.abs(curr.y));
        result.push(prev.x + (curr.x - prev.x) * ratio);
      }
    }
    return result;
  }
  Pricing.breakevens = breakevens;

  function groupRowsByStrike(rows) {
    var grouped = new Map();
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (!grouped.has(row.strike)) {
        grouped.set(row.strike, { strike: row.strike, call: null, put: null });
      }
      var item = grouped.get(row.strike);
      if (row.right === "C") {
        item.call = row;
      } else {
        item.put = row;
      }
    }
    var result = [];
    grouped.forEach(function (v) { result.push(v); });
    return result.sort(function (a, b) { return a.strike - b.strike; });
  }
  Pricing.groupRowsByStrike = groupRowsByStrike;

  function netCost(legs, multiplier) {
    return legs.reduce(function (sum, leg) {
      if (leg.excluded) {
        return sum;
      }
      var sign = leg.side === "buy" ? 1 : -1;
      return sum + sign * leg.entry * leg.qty * multiplier;
    }, 0);
  }
  Pricing.netCost = netCost;

  function targetDeltaForLeg(leg, tYears, referenceSpot, currentSpotFn, bsDeltaFn, strikeIvForLegFn, rowsForLegFn) {
    if (isStockLeg(leg)) {
      return leg.side === "sell" ? -1 : 1;
    }
    var scenarioSpot = Number.isFinite(referenceSpot) && referenceSpot > 0
      ? referenceSpot
      : (typeof currentSpotFn === "function" ? currentSpotFn() : 0);
    var strikeIv = typeof strikeIvForLegFn === "function" ? strikeIvForLegFn(leg) : (leg.iv || 0.2);
    var anchorIv = Number.isFinite(leg.iv) && leg.iv > 0
      ? leg.iv
      : (Number.isFinite(strikeIv) && strikeIv > 0 ? strikeIv : 0.2);
    var bsD = typeof bsDeltaFn === "function" ? bsDeltaFn : bsDelta;

    if (Number.isFinite(scenarioSpot) && scenarioSpot > 0) {
      var scenarioDelta = bsD(scenarioSpot, leg.strike, tYears, anchorIv, leg.right);
      if (Number.isFinite(scenarioDelta)) {
        var minAbs = 0.03;
        if (leg.right === "C") {
          return Math.max(minAbs, Math.min(0.99, scenarioDelta));
        }
        return Math.max(-0.99, Math.min(-minAbs, scenarioDelta));
      }
    }

    if (Number.isFinite(leg.delta)) {
      return leg.delta;
    }
    if (typeof rowsForLegFn === "function") {
      var rows = rowsForLegFn(leg);
      var nearestRowFn = rows && rows.length ? function() {
        var best = null;
        var bestDist = Infinity;
        for (var ri = 0; ri < rows.length; ri += 1) {
          var dist = Math.abs(rows[ri].strike - leg.strike);
          if (dist < bestDist) { bestDist = dist; best = rows[ri]; }
        }
        return best;
      } : null;
      if (nearestRowFn) {
        var nearest = nearestRowFn();
        if (nearest && Number.isFinite(nearest.delta)) {
          return nearest.delta;
        }
      }
    }
    return leg.right === "C" ? 0.25 : -0.25;
  }
  Pricing.targetDeltaForLeg = targetDeltaForLeg;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Pricing;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Pricing = Pricing;
  }
})(this);
