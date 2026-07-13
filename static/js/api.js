(function (root) {
  "use strict";

  var Api = {};
  var S = function () { return root.Euro && root.Euro.State; };
  var state = function () { return S() ? S().data : null; };
  var els = function () { return S() ? S().els : null; };
  var U = function () { return root.Euro && root.Euro.Utils; };

  function showToastFallback(message) {
    if (root.Euro && root.Euro.UI && root.Euro.UI.showToast) {
      root.Euro.UI.showToast(message);
    }
  }

  function beginLoading(message) {
    var st = state();
    if (!st) { return; }
    st.loadingCount = Math.max(0, Number(st.loadingCount) || 0) + 1;
    st.loading = true;
    if (message) {
      st.loadingMessage = String(message);
    }
    renderStatus();
  }

  function cancelInFlightLoads() {
    var st = state();
    if (!st) { return; }
    if (!(st.activeChainControllers instanceof Set) || st.activeChainControllers.size === 0) {
      return;
    }
    for (var _i = 0, _arr = [...st.activeChainControllers]; _i < _arr.length; _i += 1) {
      try {
        _arr[_i].abort();
      } catch (_error) {
        continue;
      }
    }
    st.activeChainControllers.clear();
    st.loadingCount = 0;
    st.loading = false;
    st.loadingMessage = "";
    renderStatus();
  }

  function endLoading() {
    var st = state();
    if (!st) { return; }
    st.loadingCount = Math.max(0, (Number(st.loadingCount) || 0) - 1);
    if (st.loadingCount === 0) {
      st.loading = false;
      st.loadingMessage = "";
    }
    renderStatus();
  }

  function syncLoadingUi() {
    var st = state();
    if (!st || !els()) { return; }
    var locked = Boolean(st.loading);
    setControlsLockState(locked);
    renderChartLoadingOverlay(locked);
  }

  function setControlsLockState(locked) {
    var st = state();
    var e = els();
    if (!st || !e) { return; }
    for (var _i2 = 0, _arr2 = S().LOADING_LOCK_CONTROL_IDS; _i2 < _arr2.length; _i2 += 1) {
      var controlId = _arr2[_i2];
      var element = e[controlId];
      if (!element || !("disabled" in element)) {
        continue;
      }
      if (locked) {
        if (!Object.prototype.hasOwnProperty.call(element.dataset, "lockPrevDisabled")) {
          element.dataset.lockPrevDisabled = element.disabled ? "1" : "0";
        }
        element.disabled = true;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(element.dataset, "lockPrevDisabled")) {
        element.disabled = element.dataset.lockPrevDisabled === "1";
        delete element.dataset.lockPrevDisabled;
      }
    }
    if (e.strikeRail) {
      e.strikeRail.classList.toggle("loading-locked", locked);
    }
    if (locked && root.Euro && root.Euro.UI) {
      root.Euro.UI.hideContextMenu();
    }
  }

  function renderChartLoadingOverlay(locked) {
    var e = els();
    if (!e || !e.chartLoadingOverlay) { return; }
    var st = state();
    var text = (st && st.loadingMessage) || "Loading pricing data...";
    if (e.chartLoadingText) {
      e.chartLoadingText.textContent = text;
    }
    e.chartLoadingOverlay.classList.toggle("hidden", !locked);
    e.chartLoadingOverlay.setAttribute("aria-hidden", locked ? "false" : "true");
  }

  function renderStatus() {
    var e = els();
    var st = state();
    if (!e || !st) { return; }
    syncLoadingUi();
    var chain = currentChain();
    var fallbackMock = Boolean(chain && chain.fallback_mock);
    var fromCache = Boolean(chain && chain.from_cache);
    var cacheFresh = chain ? chain.cache_fresh !== false : true;
    var cacheAgeSeconds = chain && Number.isFinite(Number(chain.cache_age_seconds))
      ? Number(chain.cache_age_seconds)
      : 0;
    if (st.loading) {
      e.chainStatus.textContent = "Loading...";
      e.expiryStatus.textContent = "Fetching chain";
      setDataBadge("loading", "Loading");
      return;
    }
    if (!chain) {
      e.chainStatus.textContent = st.ticker ? "No chain" : "No ticker loaded";
      e.expiryStatus.textContent = "";
      setDataBadge("unknown", "No Data");
      return;
    }
    var timing = st.chainLoadTime ? " (" + st.chainLoadTime + "s)" : "";
    e.chainStatus.textContent = chain.count + " contracts" + timing;
    if (fallbackMock) {
      e.chainStatus.textContent = chain.count + " contracts (sample fallback)";
      e.expiryStatus.textContent = "Live chain failed; using sample (" + chain.expiry + ")";
      setDataBadge("sample", "Sample");
      return;
    }
    if (fromCache) {
      var ageText = U() ? U().formatAgeSeconds(cacheAgeSeconds) : String(cacheAgeSeconds);
      var freshness = cacheFresh ? "cache fresh" : "cache stale";
      e.expiryStatus.textContent = chain.source + " cached - " + freshness + " (" + ageText + ") - " + chain.expiry;
      setDataBadge(cacheFresh ? "cache-fresh" : "cache-stale", cacheFresh ? "Cache Fresh" : "Cache Stale");
      return;
    }
    e.expiryStatus.textContent = chain.source + " - " + chain.expiry;
    setDataBadge("live", "Live");
  }

  function setDataBadge(kind, label) {
    var e = els();
    if (!e || !e.dataBadge) { return; }
    e.dataBadge.className = "data-badge " + kind;
    e.dataBadge.textContent = label;
  }

  function handleRequestAbort(error) {
    if (error && error.name === "AbortError") { return true; }
    return /aborted|abort/i.test(String(error || ""));
  }

  function chainKey(expiry) {
    var st = state();
    if (!st) { return expiry; }
    return [st.ticker, expiry, "yf", st.mock ? "mock" : "live"].join("|");
  }

  function currentSpot() {
    var st = state();
    if (!st) { return null; }
    var chain = currentChain();
    if (chain && Number.isFinite(chain.spot)) {
      return chain.spot;
    }
    if (st.legs.length) {
      return st.legs.reduce(function (sum, leg) { return sum + leg.strike; }, 0) / st.legs.length;
    }
    return null;
  }

  function currentChain() {
    var st = state();
    if (!st) { return null; }
    var selected = st.chains.get(chainKey(st.selectedExpiry));
    if (selected) { return selected; }
    for (var _i3 = 0, _arr3 = st.chains.values(); _i3 < _arr3.length; _i3 += 1) {
      var chain = _arr3[_i3];
      if (chain.requested_expiry === st.selectedExpiry || chain.expiry === st.selectedExpiry) {
        return chain;
      }
    }
    return null;
  }

  function scenarioSpot() {
    var st = state();
    if (!st) { return null; }
    var liveSpot = currentSpot();
    if (!Number.isFinite(liveSpot) || liveSpot <= 0) { return liveSpot; }
    return Math.max(0.01, liveSpot * (1 + st.spotShiftPct / 100));
  }

  function rowsForLeg(leg) {
    if (!leg || (leg.right || "").toUpperCase() === "U") { return []; }
    var st = state();
    if (!st) { return []; }
    var chain = st.chains.get(chainKey(leg.expiry));
    return chain ? chain.rows : [];
  }

  function optionAtStrike(expiry, right, targetStrike) {
    var st = state();
    if (!st) { return null; }
    var chain = st.chains.get(chainKey(expiry));
    if (!chain) { return null; }
    return nearestRow(chain.rows, targetStrike, right);
  }

  function nearestRow(rows, targetStrike, right) {
    if (right === "U") { return null; }
    var candidates = rows.filter(function (row) { return row.right === right; });
    if (!candidates.length) { return null; }
    return candidates.reduce(function (best, row) {
      return Math.abs(row.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? row : best;
    });
  }

  function optionAtDelta(expiry, right, targetDelta) {
    if (right === "U" || !Number.isFinite(targetDelta)) { return null; }
    var chain = (state()).chains.get(chainKey(expiry));
    if (!chain) { return null; }
    var candidates = chain.rows.filter(function (row) {
      return row.right === right && Number.isFinite(row.delta);
    });
    if (!candidates.length) { return null; }
    return candidates.reduce(function (best, row) {
      return Math.abs(row.delta - targetDelta) < Math.abs(best.delta - targetDelta) ? row : best;
    });
  }

  function averageIv() {
    var chain = currentChain();
    var ivs = chain ? chain.rows.map(function (row) { return row.iv; }).filter(Number.isFinite) : [];
    if (!ivs.length) { return 0.2; }
    return ivs.reduce(function (sum, value) { return sum + value; }, 0) / ivs.length;
  }

  async function loadIndices(refresh) {
    var st = state();
    if (!st) { return; }
    if (refresh === undefined) { refresh = false; }
    var query = refresh ? "?refresh=1" : "";
    try {
      var payload = await getJson("/api/indices" + query);
      st.indices = payload.indices || [];
    } catch (_error) {
      st.indices = [];
    }
    if (!st.indices.length) {
      var si = S();
      st.indices = (si ? si.FALLBACK_INDICES : []).map(function (item) { return ({ ...item }); });
    }
  }

  async function loadExpiries(ticker) {
    var st = state();
    if (!st) { return; }
    try {
      var params = ticker ? "?ticker=" + encodeURIComponent(ticker) : "";
      var payload = await getJson("/api/expiries" + params);
      st.expiries = payload.expiries || [];
    } catch (_error) {
      st.expiries = [];
    }
  }

  async function loadSavedTrades() {
    var st = state();
    if (!st) { return; }
    try {
      var payload = await getJson("/api/trades");
      st.savedTrades = payload.trades || [];
    } catch (_error) {
      st.savedTrades = [];
    }
  }

  async function loadSavedTemplates() {
    var st = state();
    if (!st) { return; }
    try {
      var payload = await getJson("/api/templates");
      st.savedTemplates = payload.templates || [];
    } catch (_error) {
      st.savedTemplates = [];
    }
  }

  async function loadSelectedChain() {
    var st = state();
    if (!st || !st.ticker) { return null; }
    if (!st.selectedExpiry) {
      if (st.expiries && st.expiries.length > 0) {
        st.selectedExpiry = st.expiries[0].date;
      } else {
        return null;
      }
    }
    return loadChain(st.selectedExpiry, "Loading " + st.ticker + " " + st.selectedExpiry + " chain...");
  }

  async function loadChain(expiry, loadingMessage) {
    var st = state();
    if (!st) { return null; }
    var key = chainKey(expiry);
    if (st.chains.has(key)) { return st.chains.get(key); }
    var message = loadingMessage || "Loading " + st.ticker + " " + expiry + " chain...";
    beginLoading(message);
    var controller = new AbortController();
    st.activeChainControllers.add(controller);
    var params = new URLSearchParams({
      ticker: st.ticker,
      expiry: expiry,
      no_ib: "1",
      mock: st.mock ? "1" : "0",
      fallback_mock: "1",
    });
    try {
      var t0 = performance.now();
      var chain = await getJson("/api/chain?" + params.toString(), { signal: controller.signal });
      var elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      st.chainLoadTime = elapsed;
      st.fallbackMock = Boolean(chain.fallback_mock);
      st.liveError = chain.live_error || "";
      st.fromCache = Boolean(chain.from_cache);
      st.cacheFresh = chain.cache_fresh !== false;
      st.cacheAgeSeconds = Number.isFinite(Number(chain.cache_age_seconds))
        ? Number(chain.cache_age_seconds)
        : 0;
      st.chains.set(key, chain);
      if (chain.expiry && chain.expiry !== expiry) {
        st.chains.set(chainKey(chain.expiry), chain);
      }
      st.centerChainOnNextRender = true;
      if (!st.noIb && st.legs.length) {
        autoIbPrices().catch(function () {});
      }
      return chain;
    } catch (error) {
      st.fallbackMock = false;
      st.liveError = "";
      st.fromCache = false;
      st.cacheFresh = true;
      st.cacheAgeSeconds = 0;
      if (!handleRequestAbort(error)) {
        showToastFallback(error.message || String(error));
      }
      return null;
    } finally {
      st.activeChainControllers.delete(controller);
      endLoading();
    }
  }

  async function getJson(path, options) {
    if (options === undefined) { options = {}; }
    var response = await fetch(path, options);
    var payload = await response.json().catch(function () { return ({}); });
    if (!response.ok) {
      throw new Error(payload.error || "Request failed: " + response.status);
    }
    return payload;
  }

  async function postJson(path, payload) {
    var response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    var responsePayload = await response.json().catch(function () { return ({}); });
    if (!response.ok) {
      throw new Error(responsePayload.error || "Request failed: " + response.status);
    }
    return responsePayload;
  }

  async function getIbPrices(ticker, legs) {
    return postJson("/api/ib-prices", { ticker: ticker, legs: legs });
  }

  async function autoIbPrices() {
    var st = state();
    if (!st || !st.ticker) { return; }
    var optionLegs = st.legs.filter(function (l) { return l.right !== "U"; });
    if (!optionLegs.length) { return; }
    try {
      var result = await getIbPrices(st.ticker, optionLegs.map(function (l) {
        return { strike: l.strike, right: l.right, expiry: l.expiry };
      }));
      var matched = 0;
      result.prices.forEach(function (p) {
        var leg = st.legs.find(function (l) {
          return l.strike === p.strike && l.right === p.right && l.expiry === p.expiry;
        });
        if (leg) {
          leg.ibBid = p.bid;
          leg.ibAsk = p.ask;
          leg.ibMid = p.mid;
          leg.ibLast = p.last;
          leg.ibIv = p.iv;
          leg.ibDelta = p.delta;
          leg.ibGamma = p.gamma;
          leg.ibVega = p.vega;
          leg.ibTheta = p.theta;
          matched += 1;
        }
      });
      if (matched > 0 && typeof Euro !== "undefined" && Euro.UI) {
        Euro.UI.renderAll();
      }
    } catch (_err) {
      /* IB pricing is a bonus; silent on failure */
    }
  }

  Api.beginLoading = beginLoading;
  Api.cancelInFlightLoads = cancelInFlightLoads;
  Api.endLoading = endLoading;
  Api.syncLoadingUi = syncLoadingUi;
  Api.setControlsLockState = setControlsLockState;
  Api.renderChartLoadingOverlay = renderChartLoadingOverlay;
  Api.renderStatus = renderStatus;
  Api.setDataBadge = setDataBadge;
  Api.handleRequestAbort = handleRequestAbort;
  Api.chainKey = chainKey;
  Api.currentSpot = currentSpot;
  Api.currentChain = currentChain;
  Api.scenarioSpot = scenarioSpot;
  Api.rowsForLeg = rowsForLeg;
  Api.optionAtStrike = optionAtStrike;
  Api.optionAtDelta = optionAtDelta;
  Api.nearestRow = nearestRow;
  Api.averageIv = averageIv;
  Api.loadIndices = loadIndices;
  Api.loadExpiries = loadExpiries;
  Api.loadSavedTrades = loadSavedTrades;
  Api.loadSavedTemplates = loadSavedTemplates;
  Api.loadSelectedChain = loadSelectedChain;
  Api.loadChain = loadChain;
  Api.getJson = getJson;
  Api.postJson = postJson;
  Api.getIbPrices = getIbPrices;
  Api.autoIbPrices = autoIbPrices;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Api;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Api = Api;
  }
})(this);
