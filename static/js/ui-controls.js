(function (root) {
  "use strict";

  var UI = {};

  var S = function () { return Euro.State; };
  var A = function () { return Euro.Api; };
  var C = function () { return Euro.Chart; };
  var P = function () { return Euro.Pricing; };
  var U = function () { return Euro.Utils; };
  var V = function () { return Euro.VolModels; };

  var els = S().els;
  var st = S().data;

  function renderAll() {
    renderControls();
    renderSavedTrades();
    renderSavedTemplates();
    renderExpiryStrip();
    renderStrikeRail();
    renderStats();
    renderLegs();
    renderChainTable();
    C().drawChart();
    if (root.Euro && root.Euro.Sim) { root.Euro.Sim.renderSimControls(); }
  }
  UI.renderAll = renderAll;

  function renderControls() {
    els.tickerInput.value = st.ticker || "";
    els.multiplierInput.value = String(st.multiplier);
    els.noIbToggle.checked = st.noIb;
    els.mockToggle.checked = st.mock;
    var maxDte = U().maxAnalysisDte(st.legs, st.selectedExpiry, st.expiries, S().today);
    els.dateSlider.max = String(Math.max(1, maxDte));
    if (st.dateOffset > maxDte) { st.dateOffset = maxDte; }
    els.dateSlider.value = String(st.dateOffset);
    els.rangeSlider.value = String(st.rangePct);
    els.ivSlider.value = String(st.ivShiftPct);
    if (els.spotSlider) { els.spotSlider.value = String(st.spotShiftPct); }
    if (els.volModeSelect) { els.volModeSelect.value = U().normalizeVolMode(st.volMode); }
    els.tradeNameInput.value = st.tradeName;
    if (els.templateNameInput) { els.templateNameInput.value = st.templateName; }
    if (els.templateStrikeModeSelect) { els.templateStrikeModeSelect.value = st.templateStrikeMode || "pts"; }
    if (els.templateScopeSelect) { els.templateScopeSelect.value = st.templateUnderlyingScope || "ticker"; }
    var analysisDate = U().addBusinessDays(S().today, st.dateOffset);
    els.dateLabel.textContent = U().formatShortDate(analysisDate) + " (" + st.dateOffset + "bd)";
    els.rangeLabel.textContent = "+/-" + st.rangePct + "%";
    els.ivLabel.textContent = (st.ivShiftPct >= 0 ? "+" : "") + st.ivShiftPct + " vol pts";
    if (els.spotLabel) {
      els.spotLabel.textContent = (st.spotShiftPct >= 0 ? "+" : "") + st.spotShiftPct.toFixed(1) + "%";
    }
  }
  UI.renderControls = renderControls;

  function renderIndexSelect() {
    els.indexSelect.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose preset (optional)";
    els.indexSelect.appendChild(placeholder);
    if (!st.indices.length) {
      var opt = document.createElement("option");
      opt.value = st.ticker || "";
      opt.textContent = st.ticker || "No presets";
      els.indexSelect.appendChild(opt);
      els.indexSelect.value = st.ticker || "";
      return;
    }
    for (var i = 0; i < st.indices.length; i += 1) {
      var preset = st.indices[i];
      var op = document.createElement("option");
      op.value = preset.symbol;
      op.textContent = preset.name + " (" + preset.symbol + ")";
      els.indexSelect.appendChild(op);
    }
    var hasCurrent = st.indices.some(function (item) { return item.symbol === st.ticker; });
    if (st.ticker && !hasCurrent) {
      var matched = findPresetForTicker(st.ticker);
      if (matched) { applyPreset(matched); }
    }
    if (st.indices.some(function (item) { return item.symbol === st.ticker; })) {
      els.indexSelect.value = st.ticker;
    } else {
      els.indexSelect.value = "";
    }
    if (els.tickerSuggestions) {
      els.tickerSuggestions.innerHTML = "";
      var seen = new Set();
      for (var j = 0; j < st.indices.length; j += 1) {
        var p = st.indices[j];
        var candidates = [p.symbol].concat(Array.isArray(p.aliases) ? p.aliases : [])
          .map(function (v) { return String(v || "").trim().toUpperCase(); })
          .filter(Boolean);
        for (var k = 0; k < candidates.length; k += 1) {
          if (seen.has(candidates[k])) { continue; }
          seen.add(candidates[k]);
          var item = document.createElement("option");
          item.value = candidates[k];
          item.label = p.name + " (" + p.symbol + ")";
          els.tickerSuggestions.appendChild(item);
        }
      }
    }
  }
  UI.renderIndexSelect = renderIndexSelect;

  function renderSavedTrades() {
    els.savedTradeSelect.innerHTML = "";
    if (!st.savedTrades.length) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No saved trades";
      els.savedTradeSelect.appendChild(opt);
      els.loadTradeButton.disabled = true;
      els.saveStatus.textContent = "CSV";
      return;
    }
    els.loadTradeButton.disabled = false;
    for (var i = 0; i < st.savedTrades.length; i += 1) {
      var trade = st.savedTrades[i];
      var op = document.createElement("option");
      op.value = trade.trade_id;
      op.textContent = trade.trade_name + " - " + trade.ticker + " (" + trade.leg_count + ")";
      els.savedTradeSelect.appendChild(op);
    }
    els.savedTradeSelect.value = st.currentTradeId || st.savedTrades[0].trade_id;
    els.saveStatus.textContent = st.savedTrades.length + " saved";
  }
  UI.renderSavedTrades = renderSavedTrades;

  function renderSavedTemplates() {
    if (!els.savedTemplateSelect || !els.loadTemplateButton || !els.templateStatus) { return; }
    els.savedTemplateSelect.innerHTML = "";
    if (!st.savedTemplates.length) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No saved templates";
      els.savedTemplateSelect.appendChild(opt);
      els.loadTemplateButton.disabled = true;
      els.templateStatus.textContent = "CSV";
      return;
    }
    els.loadTemplateButton.disabled = false;
    for (var i = 0; i < st.savedTemplates.length; i += 1) {
      var tpl = st.savedTemplates[i];
      var op = document.createElement("option");
      op.value = tpl.template_id;
      var scopeLabel = tpl.underlying_scope === "any" ? "Any Underlying" : tpl.ticker;
      op.textContent = tpl.template_name + " - " + scopeLabel + " (" + tpl.leg_count + ")";
      els.savedTemplateSelect.appendChild(op);
    }
    els.savedTemplateSelect.value = st.currentTemplateId || st.savedTemplates[0].template_id;
    els.templateStatus.textContent = st.savedTemplates.length + " saved";
  }
  UI.renderSavedTemplates = renderSavedTemplates;

  function renderExpiryStrip() {
    els.expiryStrip.innerHTML = "";
    var expiries = st.expiries;
    if (!expiries || expiries.length === 0) { A().renderStatus(); return; }

    var now = new Date();
    var currentYear = now.getFullYear();

    var groups = [];
    var currentGroup = null;
    for (var i = 0; i < expiries.length; i += 1) {
      var exp = expiries[i];
      var parts = exp.date.split("-");
      var monthKey = parts[0] + "-" + parts[1];
      if (!currentGroup || currentGroup.key !== monthKey) {
        currentGroup = {
          key: monthKey,
          month: exp.month,
          year: parseInt(parts[0], 10),
          expiries: [],
        };
        groups.push(currentGroup);
      }
      currentGroup.expiries.push(exp);
    }

    var wrapper = document.createElement("div");
    wrapper.className = "expiry-grid";

    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      var monthLabel = group.month;
      if (group.year !== currentYear) {
        monthLabel += " '" + String(group.year).slice(2);
      }

      var card = document.createElement("div");
      card.className = "expiry-month-card";

      var monthEl = document.createElement("div");
      monthEl.className = "expiry-month";
      monthEl.textContent = monthLabel;
      card.appendChild(monthEl);

      var daysRow = document.createElement("div");
      daysRow.className = "expiry-days";

      for (var j = 0; j < group.expiries.length; j += 1) {
        var exp = group.expiries[j];
        var dayEl = document.createElement("div");
        dayEl.className = "expiry-day" + (exp.date === st.selectedExpiry ? " active" : "") + (exp.monthly ? " monthly" : "");
        dayEl.tabIndex = 0;
        dayEl.setAttribute("role", "button");
        dayEl.setAttribute("aria-label", exp.date);
        dayEl.title = exp.label + " - " + exp.dte + "d";
        var expDate = new Date(exp.date + "T00:00:00");
        dayEl.textContent = expDate.getDate();
        dayEl.addEventListener("click", (function (date) {
          return async function () {
            if (st.loading) { return; }
            st.selectedExpiry = date;
            await A().loadSelectedChain();
            await Euro.Templates.maybeAppendTradeSnapshot("expiry_change");
            renderAll();
          };
        })(exp.date));
        daysRow.appendChild(dayEl);
      }

      card.appendChild(daysRow);
      wrapper.appendChild(card);
    }

    els.expiryStrip.appendChild(wrapper);
    A().renderStatus();
  }
  UI.renderExpiryStrip = renderExpiryStrip;

  function renderStrikeRail() {
    if (!st.ticker) {
      els.strikeRail.innerHTML = "";
      els.strikeRail.textContent = "Load a ticker to show strikes.";
      return;
    }
    var chain = A().currentChain();
    var liveSpot = A().currentSpot();
    var scenSpot = A().scenarioSpot();
    var spot = Number.isFinite(liveSpot) && liveSpot > 0 ? liveSpot : scenSpot;
    els.strikeRail.innerHTML = "";
    if (!spot) {
      els.strikeRail.textContent = "Load a chain to show strikes.";
      return;
    }
    var visRange = C().visibleStrikeRange(spot);
    var minStrike = visRange[0];
    var maxStrike = visRange[1];
    var railWidth = Math.max(els.strikeRail.clientWidth || 0, 320);
    var railLegs = st.legs.map(function (leg) {
      var legStrike = (leg.right || "").toUpperCase() === "U" ? scenSpot : leg.strike;
      var pct = strikePct(legStrike, minStrike, maxStrike);
      var centerPx = (pct / 100) * railWidth;
      return {
        leg: leg,
        pct: pct,
        centerPx: centerPx,
        width: estimateLegTagWidth(leg),
        strike: legStrike,
      };
    });
    var buyLayout = placeRailLegs(railLegs.filter(function (item) { return item.leg.side === "buy"; }));
    var sellLayout = placeRailLegs(railLegs.filter(function (item) { return item.leg.side === "sell"; }));
    var tagHeight = 38;
    var laneHeight = 44;
    var axisGap = 10;
    var topPad = 10;
    var bottomPad = 10;
    var buyDepth = buyLayout.laneCount ? tagHeight + (buyLayout.laneCount - 1) * laneHeight : 20;
    var sellDepth = sellLayout.laneCount ? tagHeight + (sellLayout.laneCount - 1) * laneHeight : 20;
    var axisY = topPad + buyDepth + 2;
    var railHeight = Math.max(112, Math.ceil(axisY + axisGap + sellDepth + bottomPad));
    els.strikeRail.style.height = railHeight + "px";
    els.strikeRail.style.setProperty("--axis-y", axisY + "px");
    var axis = document.createElement("div");
    axis.className = "strike-axis";
    els.strikeRail.appendChild(axis);
    var ticks = C().makeTicks(minStrike, maxStrike, 8);
    for (var ti = 0; ti < ticks.length; ti += 1) {
      var div = document.createElement("div");
      div.className = "strike-tick";
      div.style.left = strikePct(ticks[ti], minStrike, maxStrike) + "%";
      div.textContent = U().formatStrike(ticks[ti]);
      els.strikeRail.appendChild(div);
    }
    var spotMarker = document.createElement("div");
    spotMarker.className = "spot-marker";
    spotMarker.style.left = strikePct(scenSpot, minStrike, maxStrike) + "%";
    var markerLabel = st.spotShiftPct
      ? (st.ticker + " " + U().formatStrike(scenSpot) + " (shifted)")
      : (st.ticker + " " + U().formatStrike(spot));
    spotMarker.innerHTML = "<span>" + markerLabel + "</span>";
    els.strikeRail.appendChild(spotMarker);
    var positionedLegs = buyLayout.items.concat(sellLayout.items);
    for (var li = 0; li < positionedLegs.length; li += 1) {
      var item = positionedLegs[li];
      var leg = item.leg;
      var laneOffset = item.lane * laneHeight;
      var top = leg.side === "buy"
        ? axisY - axisGap - tagHeight - laneOffset
        : axisY + axisGap + laneOffset;
      var linkSize = leg.side === "buy" ? axisY - (top + tagHeight) : top - axisY;
      var pin = document.createElement("span");
      var pinClass = leg.right === "C" ? "call" : leg.right === "P" ? "put" : "stock";
      pin.className = ["leg-strike-pin", pinClass].join(" ");
      pin.style.left = item.pct + "%";
      els.strikeRail.appendChild(pin);
      var tag = document.createElement("div");
      var rightClass = leg.right === "C" ? "call" : leg.right === "P" ? "put" : "stock";
      var rightLabel = leg.right === "U" ? "STK" : leg.right;
      tag.className = [
        "leg-tag", rightClass,
        leg.side === "sell" ? "sell" : "buy",
        leg.excluded ? "excluded" : "",
        st.drag && st.drag.id === leg.id ? "dragging" : "",
      ].join(" ");
      tag.style.left = item.pct + "%";
      tag.style.top = Math.max(4, top) + "px";
      tag.style.setProperty("--link-size", Math.max(8, Math.round(linkSize)) + "px");
      tag.dataset.id = leg.id;
      tag.innerHTML = '<span class="leg-main">' + (leg.side === "buy" ? "+" : "-") + leg.qty + " " + U().formatStrike(item.strike) + rightLabel + "</span>" +
        "<small>" + (leg.right === "U" ? "spot" : leg.expiry) + "</small>" +
        '<span class="leg-link" aria-hidden="true"></span>';
      tag.title = leg.side.toUpperCase() + " " + leg.qty + " " + U().formatStrike(item.strike) + rightLabel + " - " + (leg.right === "U" ? "spot" : leg.expiry);
      if (leg.right !== "U") {
        tag.addEventListener("pointerdown", function (lid) {
          return function (event) { startDrag(event, lid); };
        }(leg.id));
      }
      tag.addEventListener("contextmenu", function (lid) {
        return function (event) {
          event.preventDefault();
          showContextMenu(lid, event.clientX, event.clientY);
        };
      }(leg.id));
      els.strikeRail.appendChild(tag);
    }
    if (chain) {
      var meta = st.ticker + " " + U().formatNumber(chain.spot) + " - " + chain.source + " - " + chain.timestamp_utc;
      if (Boolean(chain.fallback_mock) && chain.live_error) {
        meta += " - fallback: " + String(chain.live_error).split("\n")[0];
      } else if (Boolean(chain.from_cache)) {
        meta += " - " + (chain.cache_fresh !== false ? "fresh cache" : "stale cache");
        if (chain.live_error) { meta += " - live error: " + String(chain.live_error).split("\n")[0]; }
      }
      if (chain.tool_warning) { meta += " - tool warning: " + String(chain.tool_warning).split("\n")[0]; }
      if (chain.ib_timeout_warning) { meta += " - " + chain.ib_timeout_warning; }
      if (chain.ib_quality_warning) { meta += " - " + chain.ib_quality_warning; }
      els.chainMeta.textContent = meta;
    }
  }
  UI.renderStrikeRail = renderStrikeRail;

  function placeRailLegs(items) {
    var sorted = [].concat(items).sort(function (a, b) { return a.centerPx - b.centerPx; });
    var laneRightEdge = [];
    var gapPx = 10;
    for (var i = 0; i < sorted.length; i += 1) {
      var item = sorted[i];
      var leftEdge = item.centerPx - item.width / 2;
      var lane = 0;
      while (lane < laneRightEdge.length && leftEdge < laneRightEdge[lane] + gapPx) {
        lane += 1;
      }
      if (lane === laneRightEdge.length) { laneRightEdge.push(-Infinity); }
      laneRightEdge[lane] = leftEdge + item.width;
      item.lane = lane;
    }
    return { items: sorted, laneCount: laneRightEdge.length };
  }

  function estimateLegTagWidth(leg) {
    var rightLabel = leg.right === "U" ? "STK" : leg.right;
    var mainLabel = (leg.side === "buy" ? "+" : "-") + leg.qty + " " + U().formatStrike(leg.strike) + rightLabel;
    var expiry = String(leg.expiry || "");
    var rough = 28 + mainLabel.length * 7.2 + Math.max(0, expiry.length - 6) * 2.5;
    return Math.max(92, Math.min(220, Math.round(rough)));
  }

  function renderStats() {
    var series = C().computeSeries();
    var net = P().netCost(st.legs, st.multiplier);
    if (st.legs.length === 0) {
      els.netCost.textContent = "-";
      els.maxLoss.textContent = "-";
      els.maxProfit.textContent = "-";
      els.breakevens.textContent = "-";
      if (els.comboDelta) { els.comboDelta.textContent = "-"; }
      if (els.comboGamma) { els.comboGamma.textContent = "-"; }
      if (els.comboVega) { els.comboVega.textContent = "-"; }
      if (els.comboTheta) { els.comboTheta.textContent = "-"; }
      return;
    }
    els.netCost.textContent = (net >= 0 ? "Debit" : "Credit") + " " + U().formatMoney(Math.abs(net));
    var displayedValues = series.active.map(function (point) { return point.y; });
    var minValue = Math.min.apply(null, displayedValues);
    var maxValue = Math.max.apply(null, displayedValues);
    els.maxLoss.textContent = minValue < 0 ? U().formatMoney(Math.abs(minValue)) : U().formatMoney(0);
    els.maxProfit.textContent = maxValue > 0 ? U().formatMoney(maxValue) : U().formatMoney(0);
    var crossings = P().breakevens(series.active);
    if (crossings.length) {
      var spotRef = A() ? A().scenarioSpot() : null;
      var beText = crossings.slice(0, 4).map(function (strike) {
        var text = U().formatStrike(strike);
        if (Number.isFinite(spotRef) && spotRef > 0) {
          var pct = ((strike / spotRef) - 1) * 100;
          text += " (" + (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%)";
        }
        return text;
      }).join(", ");
      els.breakevens.textContent = beText;
    } else {
      els.breakevens.textContent = "-";
    }
    var greekTotals = C().computeComboGreeks();
    if (els.comboDelta) { els.comboDelta.textContent = U().formatGreek(greekTotals.delta, 3); }
    if (els.comboGamma) { els.comboGamma.textContent = U().formatGreek(greekTotals.gamma, 4); }
    if (els.comboVega) { els.comboVega.textContent = U().formatGreek(greekTotals.vegaPerVolPt, 2); }
    if (els.comboTheta) { els.comboTheta.textContent = U().formatGreek(greekTotals.thetaPerDay, 2); }
  }
  UI.renderStats = renderStats;

  function renderLegs() {
    var table = els.legsTable;
    table.innerHTML = "";
    table.className = st.legs.length ? "legs-table" : "legs-table empty";
    if (st.legs.length === 0) {
      table.textContent = "No contracts yet.";
      return;
    }
    for (var i = 0; i < st.legs.length; i += 1) {
      var leg = st.legs[i];
      var row = document.createElement("div");
      row.className = "leg-row";
      row.dataset.id = leg.id;
      var rightClass = leg.right === "C" ? "call" : leg.right === "P" ? "put" : "stock";
      var rightLabel = leg.right === "U" ? "STK" : leg.right;
      row.innerHTML = '<div class="leg-pill ' + rightClass + '">' + rightLabel + "</div>" +
        '<select data-field="side"><option value="buy">Buy</option><option value="sell">Sell</option></select>' +
        '<input data-field="qty" type="number" min="1" step="1" value="' + leg.qty + '" />' +
        '<select data-field="expiry"></select>' +
        '<input data-field="strike" type="number" step="0.01" value="' + leg.strike + '" />' +
        '<button data-action="remove" title="Remove">x</button>' +
        '<div class="price">' + (leg.right === "U"
          ? "Entry " + U().formatPrice(leg.entry) + " / Underlying"
          : (leg.ibMid !== undefined
            ? "IB " + U().formatPrice(leg.ibMid) + " (" + U().formatPrice(leg.ibBid) + "/" + U().formatPrice(leg.ibAsk) + ") IV " + U().formatIv(leg.ibIv)
            : "Entry " + U().formatPrice(leg.entry) + " / IV " + U().formatIv(leg.iv))) + "</div>";
      (function (rowEl, l) {
        var sideSelect = rowEl.querySelector('[data-field="side"]');
        sideSelect.disabled = st.loading;
        sideSelect.value = l.side;
        sideSelect.addEventListener("change", function () {
          if (st.loading) { return; }
          l.side = sideSelect.value;
          renderAll();
        });
        var qtyInput = rowEl.querySelector('[data-field="qty"]');
        qtyInput.disabled = st.loading;
        qtyInput.addEventListener("input", function () {
          if (st.loading) { return; }
          l.qty = Math.max(1, Math.floor(U().numberOr(qtyInput.value, 1)));
          renderAll();
        });
        var expirySelect = rowEl.querySelector('[data-field="expiry"]');
        if (l.right === "U") {
          var opt = document.createElement("option");
          opt.value = l.expiry || "SPOT";
          opt.textContent = "Spot";
          expirySelect.appendChild(opt);
          expirySelect.disabled = true;
        } else {
          for (var ei = 0; ei < st.expiries.length; ei += 1) {
            var exp = st.expiries[ei];
            var op = document.createElement("option");
            op.value = exp.date;
            op.textContent = exp.label + " (" + exp.dte + "d)";
            expirySelect.appendChild(op);
          }
          if (!st.expiries.some(function (e) { return e.date === l.expiry; })) {
            var actualOpt = document.createElement("option");
            actualOpt.value = l.expiry;
            actualOpt.textContent = l.expiry + " (actual)";
            expirySelect.appendChild(actualOpt);
          }
          expirySelect.value = l.expiry;
          expirySelect.disabled = st.loading;
          expirySelect.addEventListener("change", async function () {
            if (st.loading) { return; }
            await changeLegExpiry(l.id, expirySelect.value);
            renderAll();
          });
        }
        var strikeInput = rowEl.querySelector('[data-field="strike"]');
        if (l.right === "U") {
          strikeInput.disabled = true;
        } else {
          strikeInput.disabled = st.loading;
          strikeInput.addEventListener("change", function () {
            if (st.loading) { return; }
            updateLegStrike(l, U().numberOr(strikeInput.value, l.strike), true);
            renderAll();
          });
        }
        var removeButton = rowEl.querySelector('[data-action="remove"]');
        removeButton.disabled = st.loading;
        removeButton.addEventListener("click", function () {
          if (st.loading) { return; }
          st.legs = st.legs.filter(function (item) { return item.id !== l.id; });
          renderAll();
        });
      })(row, leg);
      table.appendChild(row);
    }
  }
  UI.renderLegs = renderLegs;

  function renderChainTable() {
    if (!st.ticker) {
      els.chainTable.innerHTML = "";
      els.chainTable.textContent = "Load a ticker to view the option chain.";
      return;
    }
    var chain = A().currentChain();
    var previousScrollTop = els.chainTable.scrollTop;
    els.chainTable.innerHTML = "";
    if (!chain || !chain.rows.length) {
      els.chainTable.textContent = st.loading ? "Loading chain..." : "No contracts loaded.";
      return;
    }
    var scenSpot = A().scenarioSpot();
    var visRange = C().visibleStrikeRange(scenSpot);
    var minStrike = visRange[0];
    var maxStrike = visRange[1];
    var grouped = P().groupRowsByStrike(chain.rows).filter(function (item) {
      return item.strike >= minStrike && item.strike <= maxStrike;
    });
    var nearestRowEl = null;
    var nearestDistance = Number.POSITIVE_INFINITY;
    for (var gi = 0; gi < grouped.length; gi += 1) {
      var item = grouped[gi];
      var row = document.createElement("div");
      row.className = "chain-row " + (Math.abs(item.strike - scenSpot) / scenSpot < 0.01 ? "near" : "");
      row.dataset.strike = String(item.strike);
      row.appendChild(renderOptionCell(item.call, "call"));
      var strike = document.createElement("div");
      strike.className = "strike-cell";
      strike.textContent = U().formatStrike(item.strike);
      row.appendChild(strike);
      row.appendChild(renderOptionCell(item.put, "put"));
      els.chainTable.appendChild(row);
      var dist = Math.abs(item.strike - scenSpot);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestRowEl = row;
      }
    }
    if (st.centerChainOnNextRender && nearestRowEl) {
      centerRowInChain(nearestRowEl);
      st.centerChainOnNextRender = false;
    } else {
      els.chainTable.scrollTop = previousScrollTop;
    }
  }
  UI.renderChainTable = renderChainTable;

  function renderOptionCell(option, type) {
    var cell = document.createElement("div");
    cell.className = "chain-cell " + type + "-cell";
    if (!option) {
      cell.textContent = "-";
      return cell;
    }
    var buy = document.createElement("button");
    buy.className = type === "call" ? "buy-call" : "buy-put";
    buy.textContent = "B";
    buy.disabled = st.loading;
    buy.title = "Buy (click again to add; Shift+Click for qty)";
    buy.addEventListener("click", function (opt) {
      return function (event) { addLeg(opt, "buy", event); };
    }(option));
    var sell = document.createElement("button");
    sell.className = type === "call" ? "sell-call" : "sell-put";
    sell.textContent = "S";
    sell.disabled = st.loading;
    sell.title = "Sell (click again to add; Shift+Click for qty)";
    sell.addEventListener("click", function (opt) {
      return function (event) { addLeg(opt, "sell", event); };
    }(option));
    var quote = document.createElement("span");
    quote.className = "quote";
    quote.textContent = U().formatPrice(option.bid) + " / " + U().formatPrice(option.mid) + " / " + U().formatPrice(option.ask) + "  " + U().formatIv(option.iv);
    var flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = option.stale ? "STALE" : option.wide_spread ? "WIDE" : "";
    if (!flag.textContent) { flag.style.visibility = "hidden"; }
    cell.append(buy, sell, quote, flag);
    return cell;
  }
  UI.renderOptionCell = renderOptionCell;

  function renderLegsOverlay() {
    if (!els.plChart) { return; }
    var chartWrap = els.plChart.parentElement;
    if (!chartWrap) { return; }
    var existing = chartWrap.querySelector(".chart-overlay");
    if (existing) { existing.remove(); }
    var activeLegs = st.legs.filter(function (leg) { return !leg.excluded; });
    if (!activeLegs.length) { return; }
    var overlay = document.createElement("div");
    overlay.className = "chart-overlay";
    var showStickyDebug = U().stickyDebugEnabled() && U().normalizeVolMode(st.volMode) === "sticky_delta";
    var analysisDate = U().startOfDay(U().addBusinessDays(S().today, st.dateOffset));
    var scenSpot = A().scenarioSpot();
    var rows = activeLegs.slice(0, 8).map(function (leg) {
      if ((leg.right || "").toUpperCase() === "U") {
        var sign = leg.side === "buy" ? 1 : -1;
        var signedSpot = sign * scenSpot;
        return "<tr><td>" + (leg.side === "buy" ? "+" : "-") + leg.qty + " " + st.ticker + " STK</td>" +
          "<td>Spot</td><td>" + U().formatPrice(signedSpot) + "</td><td>-</td>" +
          (showStickyDebug ? "<td>-</td>" : "") + "</tr>";
      }
      var legVal = C().optionValue(leg, scenSpot, analysisDate, scenSpot);
      var expiryDate = U().startOfDay(U().parseDate(leg.expiry));
      var calDays = Math.max(0, (expiryDate.getTime() - analysisDate.getTime()) / 86400000);
      var tYears = Math.max(0, calDays / 365);
      var modeledIv = V().modeledVol(leg, scenSpot, calDays, analysisDate, scenSpot);
      var stickyDebug = showStickyDebug
        ? V().stickyDeltaDebugInfo(leg, scenSpot, tYears, analysisDate, scenSpot)
        : null;
      var stickyText = stickyDebug
        ? "t" + U().formatGreek(stickyDebug.targetDelta, 3) + " m" + U().formatGreek(stickyDebug.nearestDelta, 3) + " iv" + (stickyDebug.mappedIv * 100).toFixed(2) + "%"
        : "-";
      var sg = leg.side === "buy" ? 1 : -1;
      var signedPrice = sg * legVal;
      return "<tr><td>" + (leg.side === "buy" ? "+" : "-") + leg.qty + " " + U().formatStrike(leg.strike) + (leg.right === "U" ? "STK" : leg.right) + "</td>" +
        "<td>" + leg.expiry + "</td><td>" + U().formatPrice(signedPrice) + "</td><td>" + U().formatIv(modeledIv) + "</td>" +
        (showStickyDebug ? "<td>" + stickyText + "</td>" : "") + "</tr>";
    }).join("");
    var hiddenCount = Math.max(0, activeLegs.length - 8);
    var note = hiddenCount ? '<div class="muted">+' + hiddenCount + " more legs not shown</div>" : "";
    var debugBanner = "";
    if (showStickyDebug) {
      var sampleLeg = activeLegs.find(function (l) { return (l.right || "").toUpperCase() !== "U"; });
      if (sampleLeg) {
        var ed = U().startOfDay(U().parseDate(sampleLeg.expiry));
        var cd = Math.max(0, (ed.getTime() - analysisDate.getTime()) / 86400000);
        var ty = Math.max(0, cd / 365);
        var info = V().stickyDeltaDebugInfo(sampleLeg, scenSpot, ty, analysisDate, scenSpot);
        if (info) {
          var deltaGap = Math.abs(info.targetDelta - info.nearestDelta);
          debugBanner = '<div class="chart-overlay-debug">StickyDelta debug - ' + (sampleLeg.side === "buy" ? "+" : "-") + sampleLeg.qty + " " + U().formatStrike(sampleLeg.strike) + sampleLeg.right + ": tΔ " + U().formatGreek(info.targetDelta, 3) + ", mΔ " + U().formatGreek(info.nearestDelta, 3) + " (|Δ| " + U().formatGreek(deltaGap, 3) + "), IV " + (info.mappedIv * 100).toFixed(2) + "%</div>";
        } else {
          debugBanner = '<div class="chart-overlay-debug">StickyDelta debug - no mapping data for current leg set.</div>';
        }
      }
    }
    overlay.innerHTML = '<div class="chart-overlay-title">Leg Snapshot (Scenario)</div>' + debugBanner +
      '<table><thead><tr><th>Leg</th><th>Expiry</th><th>Price</th><th>IV</th>' +
      (showStickyDebug ? "<th>StickyDelta</th>" : "") +
      '</tr></thead><tbody>' + rows + "</tbody></table>" + note;
    chartWrap.appendChild(overlay);
  }
  UI.renderLegsOverlay = renderLegsOverlay;

  function renderRecentTickers() {
    if (!els.recentTickerSelect) { return; }
    els.recentTickerSelect.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = st.recentTickers.length ? "Choose recent" : "No recent";
    els.recentTickerSelect.appendChild(placeholder);
    for (var i = 0; i < st.recentTickers.length; i += 1) {
      var op = document.createElement("option");
      op.value = st.recentTickers[i];
      op.textContent = st.recentTickers[i];
      els.recentTickerSelect.appendChild(op);
    }
    if (st.recentTickers.indexOf(st.ticker) >= 0) {
      els.recentTickerSelect.value = st.ticker;
    } else {
      els.recentTickerSelect.value = "";
    }
  }
  UI.renderRecentTickers = renderRecentTickers;

  function centerRowInChain(row) {
    var container = els.chainTable;
    var target = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
    container.scrollTop = Math.max(0, target);
  }
  UI.centerRowInChain = centerRowInChain;

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(function () {
      els.toast.classList.add("hidden");
    }, 9000);
  }
  UI.showToast = showToast;

  function hideContextMenu() {
    els.contextMenu.classList.add("hidden");
  }
  UI.hideContextMenu = hideContextMenu;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = UI;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.UI = UI;
  }
})(this);
