(function (root) {
  "use strict";

  var Utils = {};

  function parseDate(value) {
    if (!value) {
      return null;
    }
    var parts = value.split("-").map(function (s) { return Number(s); });
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  Utils.parseDate = parseDate;

  function startOfDay(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  Utils.startOfDay = startOfDay;

  function addDays(value, days) {
    var next = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }
  Utils.addDays = addDays;

  function isBusinessDay(date) {
    var day = date.getDay();
    return day !== 0 && day !== 6;
  }
  Utils.isBusinessDay = isBusinessDay;

  function nextBusinessDay(date) {
    var d = new Date(date);
    while (!isBusinessDay(d)) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }
  Utils.nextBusinessDay = nextBusinessDay;

  function addBusinessDays(date, n) {
    var result = new Date(date);
    var direction = n >= 0 ? 1 : -1;
    var remaining = Math.abs(n);
    while (remaining > 0) {
      result.setDate(result.getDate() + direction);
      if (isBusinessDay(result)) {
        remaining -= 1;
      }
    }
    return result;
  }
  Utils.addBusinessDays = addBusinessDays;

  function businessDaysBetween(d1, d2) {
    var start = new Date(Math.min(d1.getTime(), d2.getTime()));
    var end = new Date(Math.max(d1.getTime(), d2.getTime()));
    var count = 0;
    while (start < end) {
      if (isBusinessDay(start)) {
        count += 1;
      }
      start.setDate(start.getDate() + 1);
    }
    return d1 <= d2 ? count : -count;
  }
  Utils.businessDaysBetween = businessDaysBetween;

  function dteFromExpiry(expiryStr, today) {
    var expDate = parseDate(expiryStr);
    if (!expDate || !today) {
      return 0;
    }
    return Math.max(0, Math.round((startOfDay(expDate) - startOfDay(today)) / 86400000));
  }
  Utils.dteFromExpiry = dteFromExpiry;

  function normalizeVolMode(value) {
    var mode = String(value || "parallel").trim().toLowerCase();
    if (mode === "sticky_strike" || mode === "sticky_delta") {
      return mode;
    }
    return "parallel";
  }
  Utils.normalizeVolMode = normalizeVolMode;

  function roundTo(value, decimals) {
    return Math.round(value / decimals) * decimals;
  }
  Utils.roundTo = roundTo;

  function numberOr(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  Utils.numberOr = numberOr;

  function formatShortDate(value) {
    return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  Utils.formatShortDate = formatShortDate;

  function formatStrike(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: value % 1 === 0 ? 0 : (value < 10 ? 2 : 1),
    });
  }
  Utils.formatStrike = formatStrike;

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  Utils.formatNumber = formatNumber;

  function formatMoney(value, currency) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    var abs = Math.abs(value);
    var formatted = abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return (value < 0 ? "-" : "") + (currency || "USD") + " " + formatted;
  }
  Utils.formatMoney = formatMoney;

  function formatPrice(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return value.toFixed(value < 10 ? 2 : 1);
  }
  Utils.formatPrice = formatPrice;

  function formatIv(value) {
    if (!Number.isFinite(value)) {
      return "IV -";
    }
    return (value * 100).toFixed(1) + "%";
  }
  Utils.formatIv = formatIv;

  function formatGreek(value, decimals) {
    if (decimals === undefined) { decimals = 2; }
    if (!Number.isFinite(value)) {
      return "-";
    }
    var abs = Math.abs(value);
    var fixed = abs.toFixed(decimals);
    return (value < 0 ? "-" : "") + fixed;
  }
  Utils.formatGreek = formatGreek;

  function formatAgeSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "0s";
    }
    var minutes = Math.floor(value / 60);
    if (minutes < 1) {
      return Math.floor(value) + "s";
    }
    if (minutes < 60) {
      return minutes + "m";
    }
    var hours = Math.floor(minutes / 60);
    var rem = minutes % 60;
    return rem ? hours + "h " + rem + "m" : hours + "h";
  }
  Utils.formatAgeSeconds = formatAgeSeconds;

  function formatTimestampLocal(utcStamp) {
    try {
      var parsed = new Date(
        (utcStamp || "").endsWith("Z")
          ? utcStamp
          : utcStamp + (utcStamp && utcStamp.indexOf("+") === -1 ? "Z" : "")
      );
      if (isNaN(parsed.getTime())) {
        return utcStamp || "";
      }
      return parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_e) {
      return utcStamp || "";
    }
  }
  Utils.formatTimestampLocal = formatTimestampLocal;

  function defaultTradeName(ticker) {
    var stamp = new Date();
    var y = stamp.getFullYear();
    var m = String(stamp.getMonth() + 1).padStart(2, "0");
    var d = String(stamp.getDate()).padStart(2, "0");
    var hh = String(stamp.getHours()).padStart(2, "0");
    var mm = String(stamp.getMinutes()).padStart(2, "0");
    return (ticker || "") + "-" + y + m + d + "-" + hh + mm;
  }
  Utils.defaultTradeName = defaultTradeName;

  function defaultTemplateName(ticker) {
    var stamp = new Date();
    var y = stamp.getFullYear();
    var m = String(stamp.getMonth() + 1).padStart(2, "0");
    var d = String(stamp.getDate()).padStart(2, "0");
    var hh = String(stamp.getHours()).padStart(2, "0");
    var mm = String(stamp.getMinutes()).padStart(2, "0");
    return (ticker || "") + "-template-" + y + m + d + "-" + hh + mm;
  }
  Utils.defaultTemplateName = defaultTemplateName;

  function expiryForDte(dte, expiries) {
    if (!Array.isArray(expiries) || !expiries.length) {
      return "";
    }
    var target = Math.max(0, dte);
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < expiries.length; i += 1) {
      var expDte = Number(expiries[i].dte);
      var dist = Math.abs(expDte - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = expiries[i];
      }
    }
    return (best && best.date) || (expiries[0] && expiries[0].date) || "";
  }
  Utils.expiryForDte = expiryForDte;

  function stickyDebugEnabled() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      var params = new URLSearchParams(window.location.search || "");
      return params.get("stickyDebug") === "1";
    } catch (_error) {
      return false;
    }
  }
  Utils.stickyDebugEnabled = stickyDebugEnabled;

  function parseUtcStamp(value) {
    if (!value) {
      return null;
    }
    try {
      var parsed = new Date(
        (value || "").endsWith("Z") ? value : value + "Z"
      );
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (_e) {
      return null;
    }
  }
  Utils.parseUtcStamp = parseUtcStamp;

  function normalizeQty(value, fallback) {
    if (fallback === undefined) { fallback = 1; }
    var qty = Math.floor(numberOr(value, fallback));
    if (!Number.isFinite(qty) || qty < 1) { return 0; }
    return qty;
  }
  Utils.normalizeQty = normalizeQty;

  function maxAnalysisDte(legs, selectedExpiry, expiries, today) {
    var optionLegs = legs.filter(function (leg) { return (leg.right || "").toUpperCase() !== "U"; });
    var expDate = parseDate(selectedExpiry || (expiries[0] && expiries[0].date));
    var dates = optionLegs.length
      ? optionLegs.map(function (leg) { return startOfDay(parseDate(leg.expiry)); })
      : (expDate ? [startOfDay(expDate)] : []);
    var validDates = dates.filter(Boolean);
    if (!validDates.length) { return 1; }
    var minDate = new Date(Math.min.apply(null, validDates.map(function (item) { return item.getTime(); })));
    return Math.max(1, businessDaysBetween(today, minDate));
  }
  Utils.maxAnalysisDte = maxAnalysisDte;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Utils;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Utils = Utils;
  }
})(this);
