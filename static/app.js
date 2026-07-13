/* global Euro */
var Euro = window.Euro || {};

var S = function () { return Euro.State; };
var A = function () { return Euro.Api; };
var C = function () { return Euro.Chart; };
var P = function () { return Euro.Pricing; };
var U = function () { return Euro.Utils; };
var V = function () { return Euro.VolModels; };

var els = S().els;
var st = S().data;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  bindEvents();
  loadRecentTickers();
  await Promise.allSettled([A().loadIndices(), A().loadExpiries(), A().loadSavedTrades(), A().loadSavedTemplates()]);
  var initialTicker = st.recentTickers[0] || "";
  if (initialTicker) {
    applyTickerSearchTicker(initialTicker);
  }
  Euro.UI.renderIndexSelect();
  Euro.UI.renderRecentTickers();
  Euro.UI.renderExpiryStrip();
  if (st.expiries.length > 0) {
    st.selectedExpiry = st.expiries[0].date;
  }
  if (st.ticker) {
    await A().loadSelectedChain();
  }
  Euro.UI.renderAll();
}

function bindElements() {
  var ids = [
    "indexSelect", "tickerInput", "recentTickerSelect", "multiplierInput",
    "noIbToggle", "mockToggle", "loadTickerButton", "refreshButton",
    "tickerSuggestions", "dataBadge", "chainMeta", "expiryStatus",
    "expiryStrip", "strikeRail", "netCost", "maxLoss", "maxProfit",
    "breakevens", "comboDelta", "comboGamma", "comboVega", "comboTheta",
    "plChart", "chartLoadingOverlay", "chartLoadingText",
    "dateSlider", "rangeSlider", "ivSlider", "spotSlider", "volModeSelect",
    "dateLabel", "rangeLabel", "ivLabel", "spotLabel",
    "simulationPanel", "simPathsSlider", "simPathsLabel", "simHorizonInput",
    "simButton", "simStatus", "simResults", "simHistCanvas",
    "simResultMean", "simResultMedian", "simResultStd",
    "simResultVar95", "simResultCvar95", "simResultMaxProfit", "simResultMaxLoss",
    "simResultProfitProb", "simResultSkew", "simResultMaxDD",
    "simResultTouchUp", "simResultTouchDown",
    "simTpInput", "simSlInput", "simResultTpProb", "simResultSlProb", "simResultTpSlRow",
    "simModePct", "simModeDol",
    "ibPricesButton", "clearButton", "tradeNameInput", "saveTradeButton", "savedTradeSelect",
    "loadTradeButton", "saveStatus", "templateNameInput", "saveTemplateButton",
    "templateStrikeModeSelect", "templateScopeSelect", "savedTemplateSelect",
    "loadTemplateButton", "templateStatus", "legsTable", "chainStatus",
    "chainTable", "contextMenu", "toast",
  ];
  for (var i = 0; i < ids.length; i += 1) {
    els[ids[i]] = document.getElementById(ids[i]);
  }
}

function bindEvents() {
  els.indexSelect.addEventListener("change", async function () {
    var preset = st.indices.find(function (item) { return item.symbol === els.indexSelect.value; });
    applyPreset(preset || null);
    rememberRecentTicker(st.ticker);
    Euro.UI.renderRecentTickers();
    resetForNewTicker();
    await A().loadSelectedChain();
    Euro.UI.renderAll();
  });

  if (els.recentTickerSelect) {
    els.recentTickerSelect.addEventListener("change", async function () {
      var ticker = String(els.recentTickerSelect.value || "").trim().toUpperCase();
      if (!ticker) { return; }
      els.tickerInput.value = ticker;
      await loadTickerFromInput();
    });
  }

  if (els.loadTickerButton) {
    els.loadTickerButton.addEventListener("click", async function () {
      await loadTickerFromInput();
    });
  }

  els.refreshButton.addEventListener("click", async function () {
    var requestedTicker = els.tickerInput.value.trim().toUpperCase();
    await A().loadIndices(true);
    Euro.UI.renderIndexSelect();
    st.ticker = els.tickerInput.value.trim().toUpperCase();
    st.multiplier = U().numberOr(els.multiplierInput.value, st.multiplier);
    st.noIb = els.noIbToggle.checked;
    st.mock = els.mockToggle.checked;
    var preset = st.indices.find(function (item) { return item.symbol === requestedTicker; });
    if (preset) { applyPreset(preset); }
    await fetch("/api/clear-cache").catch(function () { return null; });
    resetForNewTicker(false);
    await A().loadSelectedChain();
    await Euro.Templates.maybeAppendTradeSnapshot("refresh");
    Euro.UI.renderAll();
  });

  els.tickerInput.addEventListener("keydown", async function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      await loadTickerFromInput();
    }
  });

  els.multiplierInput.addEventListener("input", function () {
    st.multiplier = Math.max(1, U().numberOr(els.multiplierInput.value, 1));
    Euro.UI.renderAll();
  });

  els.noIbToggle.addEventListener("change", async function () {
    A().cancelInFlightLoads();
    st.noIb = els.noIbToggle.checked;
    st.chains.clear();
    await A().loadSelectedChain();
    await Euro.Templates.maybeAppendTradeSnapshot("toggle_no_ib");
    Euro.UI.renderAll();
  });

  els.mockToggle.addEventListener("change", async function () {
    A().cancelInFlightLoads();
    st.mock = els.mockToggle.checked;
    st.chains.clear();
    await A().loadSelectedChain();
    await Euro.Templates.maybeAppendTradeSnapshot("toggle_mock");
    Euro.UI.renderAll();
  });

  if (els.ibPricesButton) {
    els.ibPricesButton.addEventListener("click", async function () {
      var optionLegs = st.legs.filter(function (l) { return l.right !== "U"; });
      if (!optionLegs.length) {
        Euro.UI.showToast("No option legs to price via IB.");
        return;
      }
      if (!st.ticker) {
        Euro.UI.showToast("No ticker loaded.");
        return;
      }
      Euro.UI.showToast("Fetching IB prices for " + optionLegs.length + " leg(s)...");
      try {
        var t0 = performance.now();
        var result = await A().getIbPrices(st.ticker, optionLegs.map(function (l) {
          return { strike: l.strike, right: l.right, expiry: l.expiry };
        }));
        var elapsed = ((performance.now() - t0) / 1000).toFixed(1);
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
          Euro.UI.showToast("IB prices: " + matched + "/" + optionLegs.length + " legs matched (" + elapsed + "s).");
        Euro.UI.renderAll();
      } catch (err) {
        Euro.UI.showToast("IB pricing failed: " + err.message);
      }
    });
  }

  els.clearButton.addEventListener("click", function () {
    st.legs = [];
    st.dateOffset = 0;
    st.currentTradeId = "";
    st.simHorizonSet = false;
    Euro.UI.renderAll();
  });

  els.saveTradeButton.addEventListener("click", Euro.Templates.saveCurrentTrade);
  els.loadTradeButton.addEventListener("click", Euro.Templates.loadSelectedTrade);
  els.tradeNameInput.addEventListener("input", function () {
    st.tradeName = els.tradeNameInput.value;
  });

  if (els.saveTemplateButton) {
    els.saveTemplateButton.addEventListener("click", Euro.Templates.saveCurrentTemplate);
  }
  if (els.loadTemplateButton) {
    els.loadTemplateButton.addEventListener("click", Euro.Templates.loadSelectedTemplate);
  }
  if (els.templateNameInput) {
    els.templateNameInput.addEventListener("input", function () {
      st.templateName = els.templateNameInput.value;
    });
  }
  if (els.templateStrikeModeSelect) {
    els.templateStrikeModeSelect.addEventListener("change", function () {
      var next = String(els.templateStrikeModeSelect.value || "pts").toLowerCase();
      st.templateStrikeMode = next === "pct" ? "pct" : next === "delta" ? "delta" : "pts";
    });
  }
  if (els.templateScopeSelect) {
    els.templateScopeSelect.addEventListener("change", function () {
      var next = String(els.templateScopeSelect.value || "ticker").toLowerCase();
      st.templateUnderlyingScope = next === "any" ? "any" : "ticker";
    });
  }

  els.dateSlider.addEventListener("input", function () {
    st.dateOffset = Number(els.dateSlider.value);
    Euro.UI.renderAll();
  });

  els.rangeSlider.addEventListener("input", function () {
    st.rangePct = Number(els.rangeSlider.value);
    Euro.UI.renderAll();
  });

  els.ivSlider.addEventListener("input", function () {
    st.ivShiftPct = Number(els.ivSlider.value);
    Euro.UI.renderAll();
  });

  if (els.spotSlider) {
    els.spotSlider.addEventListener("input", function () {
      st.spotShiftPct = Number(els.spotSlider.value);
      Euro.UI.renderAll();
    });
  }

  if (els.volModeSelect) {
    els.volModeSelect.addEventListener("change", async function () {
      var next = U().normalizeVolMode(els.volModeSelect.value);
      st.volMode = next;
      if (next === "sticky_delta" && st.ticker && st.legs.length) {
        await ensureChainsForLegs();
      }
      Euro.UI.renderAll();
    });
  }

  document.addEventListener("click", function (event) {
    if (!els.contextMenu.contains(event.target)) {
      Euro.UI.hideContextMenu();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (st.loading) {
        A().cancelInFlightLoads();
        Euro.UI.showToast("Canceled loading.");
      }
      Euro.UI.hideContextMenu();
    }
  });

  if (els.simButton) {
    els.simButton.addEventListener("click", function () {
      if (Euro.Sim) { Euro.Sim.submitSimulation(); }
    });
  }
  if (els.simPathsSlider) {
    els.simPathsSlider.addEventListener("input", function () {
      var st = S().data;
      if (st) { st.simPaths = parseInt(els.simPathsSlider.value, 10) || 10000; }
      if (Euro.Sim) { Euro.Sim.renderSimControls(); }
    });
  }
  function setSimTpSlMode(mode) {
    var st = S().data;
    if (st) { st.simTpSlMode = mode; }
    var isPct = mode === "pct";
    els.simModePct.classList.toggle("active", isPct);
    els.simModeDol.classList.toggle("active", !isPct);
    els.simTpInput.placeholder = isPct ? "%" : "$";
    els.simSlInput.placeholder = isPct ? "%" : "$";
  }
  if (els.simModePct) {
    els.simModePct.addEventListener("click", function () { setSimTpSlMode("pct"); });
  }
  if (els.simModeDol) {
    els.simModeDol.addEventListener("click", function () { setSimTpSlMode("dol"); });
  }
  // Default to pct
  setSimTpSlMode("pct");

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  els.strikeRail.addEventListener("contextmenu", onRailContextMenu);
  els.plChart.addEventListener("pointermove", onChartPointerMove);
  els.plChart.addEventListener("pointerleave", onChartPointerLeave);
  window.addEventListener("resize", function () {
    Euro.UI.renderStrikeRail();
    C().drawChart();
  });
}

function addLeg(option, side, event) {
  var qty = requestedOrderQty(side, option, event);
  if (!qty) { return; }
  var entry = option.mid || (option.bid + option.ask) / 2 || option.last || 0;
  var existing = st.legs.find(function (leg) {
    return leg.side === side && leg.right === option.right && leg.expiry === option.expiry && Math.abs(leg.strike - option.strike) < 0.0001;
  });
  if (existing) {
    var prevQty = existing.qty;
    var nextQty = prevQty + qty;
    existing.qty = nextQty;
    existing.entry = ((existing.entry || 0) * prevQty + entry * qty) / Math.max(1, nextQty);
    existing.iv = option.iv || existing.iv || A().averageIv();
    existing.delta = option.delta;
  } else {
    st.legs.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      side: side,
      qty: qty,
      right: option.right,
      expiry: option.expiry,
      strike: option.strike,
      entry: entry,
      iv: option.iv || A().averageIv(),
      delta: option.delta,
    });
  }
  var maxDte = U().maxAnalysisDte(st.legs, st.selectedExpiry, st.expiries, S().today);
  if (st.dateOffset > maxDte) { st.dateOffset = maxDte; }
  if (!st.noIb) { A().autoIbPrices().catch(function () {}); }
  Euro.UI.renderAll();
}

function requestedOrderQty(side, option, event) {
  if (!event || !event.shiftKey) { return 1; }
  var promptVal = window.prompt(side.toUpperCase() + " " + option.right + " " + U().formatStrike(option.strike) + " quantity:", "1");
  if (promptVal === null) { return 0; }
  var qty = U().normalizeQty(promptVal, 0);
  if (!qty) {
    Euro.UI.showToast("Quantity must be a whole number >= 1.");
    return 0;
  }
  return qty;
}

async function changeLegExpiry(id, expiry) {
  var leg = st.legs.find(function (item) { return item.id === id; });
  if (!leg || (leg.right || "").toUpperCase() === "U") { return; }
  var chain = await A().loadChain(expiry);
  leg.expiry = expiry;
  if (chain && chain.rows.length) { updateLegStrike(leg, leg.strike, true); }
}

async function updateLegStrike(leg, targetStrike, snap) {
  if ((leg.right || "").toUpperCase() === "U") { return; }
  var rows = A().rowsForLeg(leg);
  if (snap && (!rows || !rows.length)) {
    Euro.UI.showToast("Loading strikes for maturity " + leg.expiry);
    await A().loadChain(leg.expiry);
    rows = A().rowsForLeg(leg);
  }
  if (snap) {
    var snappedStrike = nearestAvailableStrike(rows, leg.right, targetStrike);
    if (snappedStrike !== null) { targetStrike = snappedStrike; }
    var row = A().nearestRow(rows, targetStrike, leg.right);
    if (row) {
      leg.strike = row.strike;
      leg.expiry = row.expiry;
      leg.entry = row.mid || (row.bid + row.ask) / 2 || row.last || leg.entry;
      leg.iv = row.iv || leg.iv || A().averageIv();
      leg.delta = row.delta;
      return;
    }
    if (snappedStrike !== null) { leg.strike = snappedStrike; return; }
  }
  leg.strike = U().roundTo(targetStrike, 0.01);
  if (!st.noIb) { A().autoIbPrices().catch(function () {}); }
}

function startDrag(event, id) {
  if (st.loading || event.button !== 0) { return; }
  event.preventDefault();
  st.drag = { id: id };
  if (event.currentTarget.setPointerCapture) { event.currentTarget.setPointerCapture(event.pointerId); }
  Euro.UI.renderStrikeRail();
}

async function onPointerMove(event) {
  if (!st.drag) { return; }
  var leg = st.legs.find(function (item) { return item.id === st.drag.id; });
  if (!leg) { return; }
  var strike = strikeFromClientX(event.clientX);
  await updateLegStrike(leg, strike, true);
  Euro.UI.renderStrikeRail();
  C().drawChart();
}

function onChartPointerMove(event) {
  var rect = els.plChart.getBoundingClientRect();
  st.chartHoverPx = event.clientX - rect.left;
  st.chartHoverPy = event.clientY - rect.top;
  C().drawChart();
}

function onChartPointerLeave() {
  st.chartHoverPx = null;
  st.chartHoverPy = null;
  C().drawChart();
}

function onPointerUp() {
  if (!st.drag) { return; }
  var leg = st.legs.find(function (item) { return item.id === st.drag.id; });
  if (leg) { updateLegStrike(leg, leg.strike, true); }
  st.drag = null;
  Euro.UI.renderAll();
}

function showContextMenu(id, clientX, clientY) {
  var leg = st.legs.find(function (item) { return item.id === id; });
  if (!leg) { return; }
  els.contextMenu.innerHTML = "";
  var title = document.createElement("div");
  title.className = "menu-title";
  title.textContent = leg.right === "U"
    ? st.ticker + " stock leg"
    : U().formatStrike(leg.strike) + leg.right + " maturity";
  els.contextMenu.appendChild(title);
  var qtyEditor = document.createElement("div");
  qtyEditor.className = "menu-qty";
  var qtyLabel = document.createElement("span");
  qtyLabel.className = "menu-label";
  qtyLabel.textContent = "Quantity";
  qtyEditor.appendChild(qtyLabel);
  var qtyRow = document.createElement("div");
  qtyRow.className = "menu-qty-row";
  var qtyDown = document.createElement("button");
  qtyDown.type = "button";
  qtyDown.className = "menu-step";
  qtyDown.textContent = "-";
  var qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.step = "1";
  qtyInput.value = String(leg.qty);
  var qtyUp = document.createElement("button");
  qtyUp.type = "button";
  qtyUp.className = "menu-step";
  qtyUp.textContent = "+";
  qtyRow.append(qtyDown, qtyInput, qtyUp);
  qtyEditor.appendChild(qtyRow);
  var applyQty = function () {
    var q = U().normalizeQty(qtyInput.value, leg.qty);
    if (!q) {
      qtyInput.value = String(leg.qty);
      Euro.UI.showToast("Quantity must be a whole number >= 1.");
      return;
    }
    leg.qty = q;
    qtyInput.value = String(q);
    Euro.UI.renderAll();
  };
  qtyDown.addEventListener("click", function () {
    leg.qty = Math.max(1, leg.qty - 1);
    qtyInput.value = String(leg.qty);
    Euro.UI.renderAll();
  });
  qtyUp.addEventListener("click", function () {
    leg.qty += 1;
    qtyInput.value = String(leg.qty);
    Euro.UI.renderAll();
  });
  qtyInput.addEventListener("change", applyQty);
  qtyInput.addEventListener("keydown", function (eventKey) {
    if (eventKey.key === "Enter") { applyQty(); }
  });
  els.contextMenu.appendChild(qtyEditor);

  if (leg.right !== "U") {
    var nearExps = nearestExpiries(leg.expiry, 10);
    for (var ei = 0; ei < nearExps.length; ei += 1) {
      (function (exp) {
        var btn = document.createElement("button");
        btn.textContent = exp.label + " - " + exp.dte + "d";
        btn.addEventListener("click", async function () {
          await changeLegExpiry(id, exp.date);
          Euro.UI.hideContextMenu();
          Euro.UI.renderAll();
        });
        els.contextMenu.appendChild(btn);
      })(nearExps[ei]);
    }
    var switchType = document.createElement("button");
    var nextRight = leg.right === "C" ? "P" : "C";
    switchType.textContent = "Switch to " + (nextRight === "C" ? "Call" : "Put");
    switchType.addEventListener("click", function () {
      leg.right = nextRight;
      updateLegStrike(leg, leg.strike, true);
      Euro.UI.hideContextMenu();
      Euro.UI.renderAll();
    });
    els.contextMenu.appendChild(switchType);
  }

  var toggle = document.createElement("button");
  if (leg.excluded) {
    toggle.textContent = "Include leg";
    toggle.addEventListener("click", function () { leg.excluded = false; Euro.UI.hideContextMenu(); Euro.UI.renderAll(); });
  } else {
    toggle.textContent = "Exclude leg";
    toggle.addEventListener("click", function () { leg.excluded = true; Euro.UI.hideContextMenu(); Euro.UI.renderAll(); });
  }
  els.contextMenu.appendChild(toggle);

  var dup = document.createElement("button");
  dup.textContent = "Duplicate leg";
  dup.addEventListener("click", function () {
    st.legs.push(Object.assign({}, leg, { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) }));
    Euro.UI.hideContextMenu();
    Euro.UI.renderAll();
    if (!st.noIb) { A().autoIbPrices().catch(function () {}); }
  });
  els.contextMenu.appendChild(dup);

  var remove = document.createElement("button");
  remove.textContent = "Remove leg";
  remove.addEventListener("click", function () {
    st.legs = st.legs.filter(function (item) { return item.id !== id; });
    Euro.UI.hideContextMenu();
    Euro.UI.renderAll();
  });
  els.contextMenu.appendChild(remove);

  els.contextMenu.style.left = Math.min(clientX, window.innerWidth - 240) + "px";
  els.contextMenu.style.top = Math.min(clientY, window.innerHeight - 360) + "px";
  els.contextMenu.classList.remove("hidden");
}

function onRailContextMenu(event) {
  if (st.loading) { return; }
  if (event.target.closest(".leg-tag")) { return; }
  event.preventDefault();
  var targetStrike = strikeFromClientX(event.clientX);
  if (!Number.isFinite(targetStrike)) { return; }
  showRailAddMenu(event.clientX, event.clientY, targetStrike);
}

function showRailAddMenu(clientX, clientY, targetStrike) {
  var expiry = st.selectedExpiry || (st.expiries[0] && st.expiries[0].date);
  if (!expiry) { Euro.UI.showToast("No expiry selected."); return; }
  var callOption = A().optionAtStrike(expiry, "C", targetStrike);
  var putOption = A().optionAtStrike(expiry, "P", targetStrike);
  var referenceStrike = (callOption && callOption.strike) || (putOption && putOption.strike) || targetStrike;
  els.contextMenu.innerHTML = "";
  var title = document.createElement("div");
  title.className = "menu-title";
  title.textContent = "Add at " + U().formatStrike(referenceStrike) + " (" + expiry + ")";
  els.contextMenu.appendChild(title);
  var actions = [
    { label: "Buy Call", side: "buy", option: callOption },
    { label: "Sell Call", side: "sell", option: callOption },
    { label: "Buy Put", side: "buy", option: putOption },
    { label: "Sell Put", side: "sell", option: putOption },
  ];
  for (var ai = 0; ai < actions.length; ai += 1) {
    (function (action) {
      var btn = document.createElement("button");
      btn.textContent = action.label;
      btn.disabled = !action.option;
      btn.addEventListener("click", function () {
        if (!action.option) { return; }
        addLeg(action.option, action.side);
        Euro.UI.hideContextMenu();
      });
      els.contextMenu.appendChild(btn);
    })(actions[ai]);
  }
  var stockQtyEditor = document.createElement("div");
  stockQtyEditor.className = "menu-qty";
  var stockQtyLabel = document.createElement("span");
  stockQtyLabel.className = "menu-label";
  stockQtyLabel.textContent = "Stock Quantity";
  stockQtyEditor.appendChild(stockQtyLabel);
  var stockQtyRow = document.createElement("div");
  stockQtyRow.className = "menu-qty-row";
  var sqDown = document.createElement("button");
  sqDown.type = "button";
  sqDown.className = "menu-step";
  sqDown.textContent = "-";
  var sqInput = document.createElement("input");
  sqInput.type = "number";
  sqInput.min = "1";
  sqInput.step = "1";
  sqInput.value = "1";
  var sqUp = document.createElement("button");
  sqUp.type = "button";
  sqUp.className = "menu-step";
  sqUp.textContent = "+";
  stockQtyRow.append(sqDown, sqInput, sqUp);
  stockQtyEditor.appendChild(stockQtyRow);
  var readStockQty = function () {
    var q = U().normalizeQty(sqInput.value, 1);
    if (!q) { Euro.UI.showToast("Stock quantity must be a whole number >= 1."); sqInput.value = "1"; return 0; }
    sqInput.value = String(q);
    return q;
  };
  sqDown.addEventListener("click", function () {
    var cur = U().normalizeQty(sqInput.value, 1) || 1;
    sqInput.value = String(Math.max(1, cur - 1));
  });
  sqUp.addEventListener("click", function () {
    var cur = U().normalizeQty(sqInput.value, 1) || 1;
    sqInput.value = String(cur + 1);
  });
  sqInput.addEventListener("change", readStockQty);
  sqInput.addEventListener("keydown", function (eventKey) {
    if (eventKey.key === "Enter") { readStockQty(); }
  });
  els.contextMenu.appendChild(stockQtyEditor);
  var stockActions = [
    { label: "Buy " + st.ticker + " Stock", side: "buy" },
    { label: "Sell " + st.ticker + " Stock", side: "sell" },
  ];
  for (var sai = 0; sai < stockActions.length; sai += 1) {
    (function (action) {
      var btn = document.createElement("button");
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        var q = readStockQty();
        if (!q) { return; }
        addStockLeg(action.side, q);
        Euro.UI.hideContextMenu();
      });
      els.contextMenu.appendChild(btn);
    })(stockActions[sai]);
  }
  var note = document.createElement("div");
  note.className = "menu-note";
  note.textContent = "Uses the nearest available strike in selected expiry.";
  els.contextMenu.appendChild(note);
  els.contextMenu.style.left = Math.min(clientX, window.innerWidth - 240) + "px";
  els.contextMenu.style.top = Math.min(clientY, window.innerHeight - 360) + "px";
  els.contextMenu.classList.remove("hidden");
}

function addStockLeg(side, qty) {
  if (qty === undefined) { qty = 1; }
  var safeQty = U().normalizeQty(qty, 1);
  if (!safeQty) { Euro.UI.showToast("Stock quantity must be a whole number >= 1."); return; }
  var scenSpot = A().scenarioSpot();
  if (!Number.isFinite(scenSpot) || scenSpot <= 0) { Euro.UI.showToast("No valid spot to add stock leg."); return; }
  var existing = st.legs.find(function (leg) { return leg.right === "U" && leg.side === side && !leg.excluded; });
  if (existing) {
    var prevQty = existing.qty;
    var nextQty = prevQty + safeQty;
    existing.qty = nextQty;
    existing.entry = ((existing.entry || 0) * prevQty + scenSpot * safeQty) / Math.max(1, nextQty);
  } else {
    st.legs.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      side: side,
      qty: safeQty,
      right: "U",
      expiry: "SPOT",
      strike: scenSpot,
      entry: scenSpot,
      iv: null,
      delta: side === "buy" ? 1 : -1,
    });
  }
  Euro.UI.renderAll();
}

function applyPreset(preset) {
  if (!preset) { return; }
  st.ticker = preset.symbol;
  st.currency = preset.currency;
  st.multiplier = preset.multiplier;
  els.tickerInput.value = preset.symbol;
  els.multiplierInput.value = String(preset.multiplier);
}

function applyTickerSearchTicker(rawTicker) {
  var ticker = String(rawTicker || "").trim().toUpperCase();
  if (!ticker) { return false; }
  st.ticker = ticker;
  els.tickerInput.value = ticker;
  var preset = findPresetForTicker(ticker);
  if (preset) {
    st.currency = preset.currency;
    st.multiplier = preset.multiplier;
  } else {
    st.currency = "USD";
    st.multiplier = 100;
  }
  els.multiplierInput.value = String(st.multiplier);
  if (els.indexSelect) {
    var hasTicker = Array.from(els.indexSelect.options || []).some(function (opt) { return opt.value === ticker; });
    els.indexSelect.value = hasTicker ? ticker : "";
  }
  return true;
}

function findPresetForTicker(ticker) {
  var key = String(ticker || "").trim().toUpperCase();
  if (!key) { return null; }
  return st.indices.find(function (item) {
    var symbol = String(item.symbol || "").toUpperCase();
    var optTicker = String(item.option_chain_ticker || "").toUpperCase();
    var yahooTicker = String(item.yahoo_ticker || "").toUpperCase();
    var aliases = Array.isArray(item.aliases) ? item.aliases : [];
    return symbol === key || optTicker === key || yahooTicker === key ||
      aliases.some(function (a) { return String(a || "").toUpperCase() === key; });
  }) || null;
}

function defaultMultiplierForCurrency(currency) {
  var key = String(currency || "").toUpperCase();
  return (S().DEFAULT_MULTIPLIER_BY_CURRENCY[key]) || 100;
}

async function loadTickerFromInput() {
  if (st.loading) { A().cancelInFlightLoads(); }
  var ticker = els.tickerInput.value.trim().toUpperCase();
  if (!ticker) { Euro.UI.showToast("Enter a ticker to load."); return; }
  var applied = applyTickerSearchTicker(ticker);
  if (!applied) { Euro.UI.showToast("Invalid ticker."); return; }
  st.noIb = els.noIbToggle.checked;
  st.mock = els.mockToggle.checked;
  resetForNewTicker();
  await A().loadExpiries(st.ticker);
  await A().loadSelectedChain();
  await Euro.Templates.maybeAppendTradeSnapshot("ticker_change");
  rememberRecentTicker(st.ticker);
  Euro.UI.renderRecentTickers();
  Euro.UI.renderAll();
  Euro.UI.showToast("Loaded " + st.ticker + ".");
}

async function ensureChainsForLegs() {
  if (!st.ticker || !st.legs.length) { return; }
  var expiries = new Set();
  st.legs.forEach(function (leg) {
    if ((leg.right || "").toUpperCase() !== "U" && leg.expiry) {
      expiries.add(leg.expiry);
    }
  });
  for (var expiry of expiries) {
    var key = A().chainKey(expiry);
    if (!st.chains.has(key)) {
      await A().loadChain(expiry, "Loading chain for " + expiry + " (sticky delta)...");
    }
  }
}

function loadRecentTickers() {
  st.recentTickers = [];
  if (typeof window === "undefined" || !window.localStorage) { return; }
  try {
    var raw = window.localStorage.getItem(S().RECENT_TICKERS_KEY);
    if (!raw) { return; }
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { return; }
    st.recentTickers = parsed
      .map(function (item) { return String(item || "").trim().toUpperCase(); })
      .filter(Boolean)
      .filter(function (item, idx, arr) { return arr.indexOf(item) === idx; })
      .slice(0, S().MAX_RECENT_TICKERS);
  } catch (_error) {
    st.recentTickers = [];
  }
}

function saveRecentTickers() {
  if (typeof window === "undefined" || !window.localStorage) { return; }
  try {
    window.localStorage.setItem(S().RECENT_TICKERS_KEY, JSON.stringify(st.recentTickers));
  } catch (_error) {
    return;
  }
}

function rememberRecentTicker(rawTicker) {
  var ticker = String(rawTicker || "").trim().toUpperCase();
  if (!ticker) { return; }
  st.recentTickers = [ticker].concat(st.recentTickers.filter(function (item) { return item !== ticker; }))
    .slice(0, S().MAX_RECENT_TICKERS);
  saveRecentTickers();
}

function resetForNewTicker(clearLegs) {
  if (clearLegs === undefined) { clearLegs = true; }
  A().cancelInFlightLoads();
  st.templateHydrationToken += 1;
  st.chains.clear();
  st.selectedExpiry = "";
  if (clearLegs) { st.legs = []; st.simHorizonSet = false; }
  st.dateOffset = 0;
  st.chainLoadTime = "";
}

function strikePct(strike, minStrike, maxStrike) {
  return Math.max(0, Math.min(100, ((strike - minStrike) / (maxStrike - minStrike)) * 100));
}

function strikeFromClientX(clientX) {
  var spot = A().currentSpot();
  if (!spot) { return Number.NaN; }
  var visRange = C().visibleStrikeRange(spot);
  var rect = els.strikeRail.getBoundingClientRect();
  if (!rect.width) { return Number.NaN; }
  var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return visRange[0] + ratio * (visRange[1] - visRange[0]);
}

function nearestExpiries(currentExpiry, limit) {
  var current = U().parseDate(currentExpiry);
  return [].concat(st.expiries).sort(function (a, b) {
    return Math.abs(U().parseDate(a.date) - current) - Math.abs(U().parseDate(b.date) - current);
  }).slice(0, limit);
}

function nearestAvailableStrike(rows, right, targetStrike) {
  if (right === "U") { return null; }
  var strikes = Array.from(new Set(rows.filter(function (row) { return row.right === right; }).map(function (row) { return row.strike; })));
  if (!strikes.length) { return null; }
  return strikes.reduce(function (best, strike) {
    return Math.abs(strike - targetStrike) < Math.abs(best - targetStrike) ? strike : best;
  });
}

/* Expose renderStatus on Euro.UI for external access */
Euro.UI.renderStatus = A().renderStatus;
