(function (root) {
  "use strict";

  var Templates = {};

  var S = function () { return Euro.State; };
  var A = function () { return Euro.Api; };
  var C = function () { return Euro.Chart; };
  var P = function () { return Euro.Pricing; };
  var U = function () { return Euro.Utils; };
  var V = function () { return Euro.VolModels; };

  var els = S().els;
  var st = S().data;

  async function saveCurrentTrade() {
    if (!st.legs.length) { Euro.UI.showToast("Add at least one option leg before saving."); return; }
    var tradeName = (st.tradeName || U().defaultTradeName()).trim();
    var currentSaved = st.savedTrades.find(function (trade) { return trade.trade_id === st.currentTradeId; });
    var targetTradeId = st.currentTradeId;
    if (currentSaved && currentSaved.trade_name !== tradeName) { targetTradeId = ""; }
    var duplicate = st.savedTrades.find(function (trade) {
      return trade.trade_name === tradeName && trade.trade_id !== targetTradeId;
    });
    if (duplicate) {
      if (!window.confirm("A trade named '" + tradeName + "' already exists. Overwrite it?")) {
        Euro.UI.showToast("Save cancelled.");
        return;
      }
      targetTradeId = duplicate.trade_id;
    }
    var a = A();
    var payload = {
      trade_id: targetTradeId,
      trade_name: tradeName,
      ticker: st.ticker,
      currency: st.currency,
      multiplier: st.multiplier,
      selected_expiry: st.selectedExpiry,
      range_pct: st.rangePct,
      iv_shift_pct: st.ivShiftPct,
      spot_shift_pct: st.spotShiftPct,
      vol_mode: st.volMode,
      date_offset: st.dateOffset,
      opened_spot: a ? a.currentSpot() : null,
      legs: st.legs,
    };
    try {
      var response = await A().postJson("/api/trades", payload);
      var trade = response.trade;
      st.currentTradeId = trade.trade_id;
      st.tradeName = trade.trade_name;
      st.tradeOpeningNetCost = Number.isFinite(Number(trade.opening_net_cost))
        ? Number(trade.opening_net_cost)
        : P().netCost(st.legs, st.multiplier);
      st.tradeOpenedAtUtc = String(trade.opened_at_utc || "");
      st.tradePnlHistory = Array.isArray(trade.pnl_history) ? trade.pnl_history : [];
      await A().loadSavedTrades();
      Euro.UI.renderAll();
      await maybeAppendTradeSnapshot("save_trade");
      Euro.UI.showToast("Saved " + trade.trade_name + ".");
    } catch (error) {
      Euro.UI.showToast(error.message || String(error));
    }
  }
  Templates.saveCurrentTrade = saveCurrentTrade;

  async function loadSelectedTrade() {
    if (st.loading) { A().cancelInFlightLoads(); }
    var tradeId = els.savedTradeSelect.value;
    if (!tradeId) { return; }
    try {
      var response = await A().getJson("/api/trade?id=" + encodeURIComponent(tradeId));
      await applySavedTrade(response.trade);
      Euro.UI.showToast("Loaded " + response.trade.trade_name + ".");
    } catch (error) {
      Euro.UI.showToast(error.message || String(error));
    }
  }
  Templates.loadSelectedTrade = loadSelectedTrade;

  async function applySavedTrade(trade) {
    st.currentTradeId = trade.trade_id;
    st.tradeName = trade.trade_name;
    st.ticker = trade.ticker;
    st.currency = trade.currency;
    st.multiplier = Number(trade.multiplier) || 1;
    st.selectedExpiry = trade.selected_expiry || (trade.legs && trade.legs[0] && trade.legs[0].expiry) || st.selectedExpiry;
    st.rangePct = Number(trade.range_pct) || 12;
    st.ivShiftPct = Number(trade.iv_shift_pct) || 0;
    st.spotShiftPct = Number(trade.spot_shift_pct) || 0;
    st.volMode = U().normalizeVolMode(trade.vol_mode);
    st.dateOffset = Number(trade.date_offset) || 0;
    st.tradeOpeningNetCost = Number.isFinite(Number(trade.opening_net_cost))
      ? Number(trade.opening_net_cost)
      : null;
    st.tradeOpenedAtUtc = String(trade.opened_at_utc || "");
    st.tradePnlHistory = Array.isArray(trade.pnl_history) ? trade.pnl_history : [];
    st.lastTradeSnapshotMs = 0;
    st.simHorizonSet = false;
    st.legs = trade.legs || [];
    st.chains.clear();
    els.indexSelect.value = st.ticker;
    await A().loadSelectedChain();
    if (st.volMode === "sticky_delta" && st.legs.length) {
      await Promise.all((
        function () {
          var expirySet = new Set();
          st.legs.forEach(function (l) {
            if ((l.right || "").toUpperCase() !== "U" && l.expiry) {
              expirySet.add(l.expiry);
            }
          });
          return Array.from(expirySet);
        })().filter(function (exp) { return exp !== st.selectedExpiry; }).map(function (exp) {
          return A().loadChain(exp, null, true);
        })
      );
    }
    await maybeAppendTradeSnapshot("load_trade");
    Euro.UI.renderAll();
  }
  Templates.applySavedTrade = applySavedTrade;

  async function saveCurrentTemplate() {
    if (!st.legs.length) { Euro.UI.showToast("Add at least one option leg before saving a template."); return; }
    var templateName = (st.templateName || U().defaultTemplateName()).trim();
    var currentSaved = st.savedTemplates.find(function (tpl) { return tpl.template_id === st.currentTemplateId; });
    var targetTemplateId = st.currentTemplateId;
    if (currentSaved && currentSaved.template_name !== templateName) { targetTemplateId = ""; }
    var duplicate = st.savedTemplates.find(function (tpl) {
      return tpl.template_name === templateName && tpl.template_id !== targetTemplateId;
    });
    if (duplicate) {
      if (!window.confirm("A template named '" + templateName + "' already exists. Overwrite it?")) {
        Euro.UI.showToast("Save cancelled.");
        return;
      }
      targetTemplateId = duplicate.template_id;
    }
    var a = A();
    var spot = a ? a.currentSpot() : null;
    if (!Number.isFinite(spot) || spot <= 0) { Euro.UI.showToast("Template save needs a valid spot."); return; }
    var strikeMode = st.templateStrikeMode || "pts";
    var payload = {
      template_id: targetTemplateId,
      template_name: templateName,
      ticker: st.templateUnderlyingScope === "any" ? "" : st.ticker,
      currency: st.currency,
      multiplier: st.multiplier,
      strike_mode: strikeMode,
      underlying_scope: st.templateUnderlyingScope,
      saved_spot: spot,
      selected_dte: U().dteFromExpiry(st.selectedExpiry),
      range_pct: st.rangePct,
      iv_shift_pct: st.ivShiftPct,
      spot_shift_pct: st.spotShiftPct,
      vol_mode: st.volMode,
      date_offset: st.dateOffset,
      legs: st.legs.map(function (leg) {
        var strikeOffset = P().isStockLeg(leg)
          ? 0
          : strikeMode === "pct"
            ? ((leg.strike - spot) / spot) * 100
            : leg.strike - spot;
        return {
          id: leg.id,
          side: leg.side,
          qty: leg.qty,
          right: P().isStockLeg(leg) ? "U" : leg.right,
          expiry_dte: P().isStockLeg(leg) ? 0 : U().dteFromExpiry(leg.expiry),
          strike_offset: strikeOffset,
          entry: leg.entry,
          iv: leg.iv,
          delta: leg.delta,
        };
      }),
    };
    try {
      var response = await A().postJson("/api/templates", payload);
      var template = response.template;
      st.currentTemplateId = template.template_id;
      st.templateName = template.template_name;
      st.templateStrikeMode = template.strike_mode || "pts";
      st.templateUnderlyingScope = template.underlying_scope || "ticker";
      await A().loadSavedTemplates();
      Euro.UI.renderAll();
      Euro.UI.showToast("Saved template " + template.template_name + ".");
    } catch (error) {
      Euro.UI.showToast(error.message || String(error));
    }
  }
  Templates.saveCurrentTemplate = saveCurrentTemplate;

  async function loadSelectedTemplate() {
    if (st.loading) { A().cancelInFlightLoads(); }
    if (!els.savedTemplateSelect) { return; }
    var templateId = els.savedTemplateSelect.value;
    if (!templateId) { return; }
    try {
      var response = await A().getJson("/api/template?id=" + encodeURIComponent(templateId));
      await applySavedTemplate(response.template);
      Euro.UI.showToast("Loaded template " + response.template.template_name + ".");
    } catch (error) {
      Euro.UI.showToast(error.message || String(error));
    }
  }
  Templates.loadSelectedTemplate = loadSelectedTemplate;

  async function applySavedTemplate(template) {
    var previousTicker = st.ticker;
    st.currentTemplateId = template.template_id;
    st.templateName = template.template_name;
    st.templateStrikeMode = template.strike_mode || "pts";
    st.templateUnderlyingScope = template.underlying_scope || "ticker";
    if (st.templateUnderlyingScope === "ticker") {
      st.ticker = template.ticker || st.ticker;
      st.currency = template.currency || st.currency;
      st.multiplier = Number(template.multiplier) || st.multiplier;
    }
    st.rangePct = Number(template.range_pct) || st.rangePct;
    st.ivShiftPct = Number(template.iv_shift_pct) || st.ivShiftPct;
    st.spotShiftPct = Number(template.spot_shift_pct) || 0;
    st.volMode = U().normalizeVolMode(template.vol_mode);
    st.dateOffset = Number(template.date_offset) || 0;
    st.currentTradeId = "";
    st.tradeName = "";
    var selectedDte = Number(template.selected_dte) || 0;
    var nextSelectedExpiry = U().expiryForDte(selectedDte, st.expiries);
    if (nextSelectedExpiry) { st.selectedExpiry = nextSelectedExpiry; }
    if (st.ticker !== previousTicker) { st.chains.clear(); }
    if (els.indexSelect) {
      var hasTicker = Array.from(els.indexSelect.options || []).some(function (opt) { return opt.value === st.ticker; });
      els.indexSelect.value = hasTicker ? st.ticker : "";
    }
    var a = A();
    var savedSpot = Number(template.saved_spot);
    var liveSpot = a ? a.currentSpot() : null;
    var baseSpot = Number.isFinite(liveSpot) && liveSpot > 0
      ? liveSpot
      : (Number.isFinite(savedSpot) && savedSpot > 0 ? savedSpot : null);
    st.legs = materializeTemplateLegs(template, baseSpot);
    var maxDte = U().maxAnalysisDte(st.legs, st.selectedExpiry, st.expiries, S().today);
    if (st.dateOffset > maxDte) { st.dateOffset = maxDte; }
    Euro.UI.renderAll();
    var hydrationToken = ++st.templateHydrationToken;
    void hydrateTemplateChains(template, savedSpot, hydrationToken);
  }
  Templates.applySavedTemplate = applySavedTemplate;

  function materializeTemplateLegs(template, baseSpot) {
    var legs = [];
    for (var index = 0; index < (template.legs || []).length; index += 1) {
      var leg = template.legs[index];
      var expiry = U().expiryForDte(Number(leg.expiry_dte) || 0, st.expiries) || st.selectedExpiry;
      var right = String(leg.right || "").toUpperCase();
      var legId = leg.id || (st.currentTemplateId || "template") + "-" + index;
      if (right === "U") {
        var stockEntry = Number(leg.entry);
        var stockSpot = Number.isFinite(baseSpot) && baseSpot > 0 ? baseSpot : 0;
        legs.push({
          id: legId,
          side: leg.side === "sell" ? "sell" : "buy",
          qty: U().normalizeQty(leg.qty, 1) || 1,
          right: "U",
          expiry: "SPOT",
          strike: Number.isFinite(stockSpot) ? stockSpot : 0,
          entry: Number.isFinite(stockEntry) ? stockEntry : (Number.isFinite(stockSpot) ? stockSpot : 0),
          iv: null,
          delta: leg.side === "sell" ? -1 : 1,
        });
        continue;
      }
      var a = A();
      var matched = null;
      if (st.templateStrikeMode === "delta") {
        var targetDelta = Number(leg.delta);
        matched = a ? a.optionAtDelta(expiry, right, targetDelta) : null;
      } else {
        var strikeOffset = Number(leg.strike_offset) || 0;
        var targetStrike = st.templateStrikeMode === "pct" && baseSpot
          ? baseSpot * (1 + strikeOffset / 100)
          : (baseSpot || 0) + strikeOffset;
        matched = a ? a.optionAtStrike(expiry, right, targetStrike) : null;
      }
      legs.push({
        id: legId,
        side: leg.side === "sell" ? "sell" : "buy",
        qty: U().normalizeQty(leg.qty, 1) || 1,
        right: right,
        expiry: (matched && matched.expiry) || expiry,
        strike: (matched && matched.strike) || U().roundTo(targetStrike, 0.01),
        entry: (matched && (matched.mid || matched.last)) || Number(leg.entry) || 0,
        iv: (matched && matched.iv) || (Number.isFinite(Number(leg.iv)) ? Number(leg.iv) : (a ? a.averageIv() : 0.2)),
        delta: (matched && matched.delta) || (Number.isFinite(Number(leg.delta)) ? Number(leg.delta) : null),
      });
    }
    return legs;
  }
  Templates.materializeTemplateLegs = materializeTemplateLegs;

  async function hydrateTemplateChains(template, savedSpot, hydrationToken) {
    var expirySet = new Set();
    if (st.selectedExpiry) { expirySet.add(st.selectedExpiry); }
    for (var i = 0; i < (template.legs || []).length; i += 1) {
      var expiry = U().expiryForDte(Number(template.legs[i].expiry_dte) || 0, st.expiries) || st.selectedExpiry;
      if (expiry) { expirySet.add(expiry); }
    }
    var expiryList = Array.from(expirySet);
    if (hydrationToken !== st.templateHydrationToken) { return; }
    await Promise.all(expiryList.map(function (exp) {
      return A().loadChain(exp, null, true);
    }));
    if (hydrationToken !== st.templateHydrationToken) { return; }
    var a = A();
    var liveSpot = a ? a.currentSpot() : null;
    var baseSpot = Number.isFinite(liveSpot) && liveSpot > 0
      ? liveSpot
      : (Number.isFinite(savedSpot) && savedSpot > 0 ? savedSpot : null);
    st.legs = materializeTemplateLegs(template, baseSpot);
    var maxDte = U().maxAnalysisDte(st.legs, st.selectedExpiry, st.expiries, S().today);
    if (st.dateOffset > maxDte) { st.dateOffset = maxDte; }
    Euro.UI.renderAll();
  }
  Templates.hydrateTemplateChains = hydrateTemplateChains;

  function quoteForLegMark(leg) {
    if ((leg.right || "").toUpperCase() === "U") {
      var spot = A().currentSpot();
      return Number.isFinite(spot) ? spot : null;
    }
    var a = A();
    var chainKey = a ? a.chainKey(leg.expiry) : leg.expiry;
    var chain = st.chains.get(chainKey);
    if (!chain || !Array.isArray(chain.rows)) { return null; }
    var row = a ? a.nearestRow(chain.rows, leg.strike, leg.right) : null;
    if (!row) { return null; }
    var bid = Number(row.bid) || 0;
    var ask = Number(row.ask) || 0;
    var mid = Number(row.mid) || 0;
    var last = Number(row.last) || 0;
    if (leg.side === "buy") {
      if (bid > 0) { return bid; }
    } else if (ask > 0) { return ask; }
    if (mid > 0) { return mid; }
    if (last > 0) { return last; }
    return null;
  }
  Templates.quoteForLegMark = quoteForLegMark;

  function computeTradeMarkToClosePnl() {
    if (!st.currentTradeId || !st.legs.length) { return null; }
    var opening = Number(st.tradeOpeningNetCost);
    if (!Number.isFinite(opening)) { return null; }
    if (!Number.isFinite(st.multiplier) || st.multiplier <= 0) { return null; }
    var closeCashflow = 0;
    for (var i = 0; i < st.legs.length; i += 1) {
      var leg = st.legs[i];
      if (leg.excluded) { continue; }
      var mark = quoteForLegMark(leg);
      if (!Number.isFinite(mark)) { return null; }
      var qty = Math.max(1, Math.floor(Number(leg.qty) || 1));
      var unit = mark * qty * st.multiplier;
      closeCashflow += leg.side === "buy" ? unit : -unit;
    }
    return opening - closeCashflow;
  }
  Templates.computeTradeMarkToClosePnl = computeTradeMarkToClosePnl;

  async function maybeAppendTradeSnapshot(sourceTag) {
    if (sourceTag === undefined) { sourceTag = "refresh"; }
    if (!st.currentTradeId || st.loading) { return; }
    var nowMs = Date.now();
    if (nowMs - st.lastTradeSnapshotMs < 3000) { return; }
    var pnl = computeTradeMarkToClosePnl();
    if (!Number.isFinite(pnl)) { return; }
    var a = A();
    var payload = {
      trade_id: st.currentTradeId,
      timestamp_utc: new Date().toISOString(),
      pnl_mark_to_close: pnl,
      spot: a ? a.currentSpot() : null,
      source: sourceTag,
      selected_expiry: st.selectedExpiry,
    };
    try {
      var response = await A().postJson("/api/trade-snapshot", payload);
      var trade = response.trade || null;
      if (trade && Array.isArray(trade.pnl_history)) {
        st.tradePnlHistory = trade.pnl_history;
      } else if (response.snapshot) {
        st.tradePnlHistory = [].concat(st.tradePnlHistory).concat([response.snapshot]);
      }
      if (trade && Number.isFinite(Number(trade.opening_net_cost))) {
        st.tradeOpeningNetCost = Number(trade.opening_net_cost);
      }
      st.lastTradeSnapshotMs = nowMs;
      Euro.UI.renderAll();
    } catch (_error) {
      return;
    }
  }
  Templates.maybeAppendTradeSnapshot = maybeAppendTradeSnapshot;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Templates;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Templates = Templates;
  }
})(this);
