(function (root) {
  "use strict";

  var Sim = {};
  var activePollId = null;

  function S() { return root.Euro && root.Euro.State; }
  function state() { return S() ? S().data : null; }
  function els() { return S() ? S().els : null; }
  function U() { return root.Euro && root.Euro.Utils; }

  function SimUI() {
    var e = els();
    if (!e) { return; }
    var panel = e.simulationPanel;
    if (!panel) { return; }
    var st = state();
    if (!st || !st.ticker || st.legs.length === 0) {
      panel.classList.add("sim-hidden");
      return;
    }
    panel.classList.remove("sim-hidden");
  }
  Sim.SimUI = SimUI;

  function renderSimControls() {
    SimUI();
    var e = els();
    if (!e) { return; }
    var st = state();
    if (!st) { return; }
    if (e.simPathsSlider) { e.simPathsSlider.value = String(st.simPaths || 10000); }
    if (e.simPathsLabel) { e.simPathsLabel.textContent = U().formatNumber(st.simPaths || 10000); }
    // Set default horizon from first expiry's DTE
    if (e.simHorizonInput && !st.simHorizonSet) {
      var defaultDte = computeDefaultHorizon();
      if (defaultDte > 0) {
        e.simHorizonInput.value = String(defaultDte);
        e.simHorizonInput.max = String(defaultDte);
        st.simHorizonSet = true;
      }
    }
  }
  Sim.renderSimControls = renderSimControls;

  function renderSimResults(results) {
    var e = els();
    if (!e) { return; }
    if (!results) {
      e.simStatus.textContent = "Run simulation to see results.";
      e.simResults.classList.add("sim-hidden");
      return;
    }
    e.simResults.classList.remove("sim-hidden");

    var dist = results.pnl_distribution || {};
    var ord = results.path_ordering || {};

    var currency = (state() && state().currency) || "USD";

    function fmt(val) {
      if (!Number.isFinite(val)) { return "-"; }
      return currency + " " + Math.round(val).toLocaleString();
    }

    e.simResultMean.textContent = fmt(dist.mean);
    e.simResultMedian.textContent = fmt(dist.median);
    e.simResultStd.textContent = fmt(dist.std);
    e.simResultVar95.textContent = fmt(dist.var_95);
    e.simResultCvar95.textContent = fmt(dist.cvar_95);
    e.simResultMaxProfit.textContent = fmt(dist.max_profit);
    e.simResultMaxLoss.textContent = fmt(dist.max_loss);
    e.simResultProfitProb.textContent = dist.profit_prob != null
      ? (dist.profit_prob * 100).toFixed(1) + "%" : "-";
    e.simResultSkew.textContent = dist.skew != null ? dist.skew.toFixed(3) : "-";

    e.simResultMaxDD.textContent = ord.max_drawdown_mean != null
      ? (ord.max_drawdown_mean * 100).toFixed(1) + "%" : "-";
    e.simResultTouchUp.textContent = ord.first_touch_up_pct != null
      ? ord.first_touch_up_pct.toFixed(1) + "%" : "-";
    e.simResultTouchDown.textContent = ord.first_touch_down_pct != null
      ? ord.first_touch_down_pct.toFixed(1) + "%" : "-";

    // TP/SL results
    if (ord.tp_hit_prob != null) {
      e.simResultTpProb.textContent = (ord.tp_hit_prob * 100).toFixed(1) + "%";
      e.simResultSlProb.textContent = (ord.sl_hit_prob * 100).toFixed(1) + "%";
      e.simResultTpSlRow.classList.remove("sim-hidden");
    } else {
      e.simResultTpSlRow.classList.add("sim-hidden");
    }

    // Draw mini P&L distribution histogram
    drawPnlHistogram(e.simHistCanvas, dist);

    e.simStatus.textContent = "Simulation complete (" + (results.n_paths || "?") + " paths).";
  }
  Sim.renderSimResults = renderSimResults;

  function drawPnlHistogram(canvas, dist) {
    if (!canvas || !dist || !dist.deciles || dist.deciles.length < 3) { return; }
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = rect.width;
    var h = rect.height;
    ctx.clearRect(0, 0, w, h);

    var dec = dist.deciles;
    var n = dec.length - 1;
    var xMin = dec[0];
    var xMax = dec[n];
    var range = Math.max(xMax - xMin, 1);

    // Compute bar heights (difference between consecutive deciles)
    var bars = [];
    var maxCount = 0;
    for (var i = 0; i < n; i += 1) {
      var count = 0.1; // each decile represents 10% of observations
      if (i === 0 || i === n - 1) { count = 0.05; } // tails thinner
      bars.push(count);
      if (count > maxCount) { maxCount = count; }
    }

    var barW = Math.max(4, (w - 12) / n - 1);
    var midY = h / 2;
    var zeroIdx = -1;

    for (var j = 0; j < n; j += 1) {
      var xl = dec[j];
      var xr = dec[j + 1];
      var cx = (xl + xr) / 2;
      var px = 6 + ((cx - xMin) / range) * (w - 12);
      var barH = (bars[j] / Math.max(maxCount, 0.01)) * (h * 0.4);
      ctx.fillStyle = cx >= 0 ? "rgba(22, 211, 111, 0.7)" : "rgba(255, 66, 66, 0.7)";
      ctx.fillRect(px - barW / 2, midY - barH / 2, barW, barH);
      if (zeroIdx < 0 && cx >= 0) { zeroIdx = j; }
    }

    // Draw zero line
    var zeroPx = 6 + ((0 - xMin) / range) * (w - 12);
    ctx.strokeStyle = "rgba(244, 241, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(zeroPx, 4);
    ctx.lineTo(zeroPx, h - 4);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = "#a7a0bc";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("0", zeroPx, h - 2);
    ctx.textAlign = "left";
    ctx.fillText("P&L Distribution", 6, 10);
  }
  Sim.drawPnlHistogram = drawPnlHistogram;

  function computeDefaultHorizon() {
    var st = state();
    if (!st || !st.legs || !st.legs.length) { return 60; }
    // Find the earliest expiry among option legs
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var minDte = Infinity;
    st.legs.forEach(function (l) {
      if (l.right === "U" || !l.expiry) { return; }
      var parts = l.expiry.split("-");
      if (parts.length !== 3) { return; }
      var expDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var dte = Math.round((expDate - today) / 86400000);
      if (dte > 0 && dte < minDte) { minDte = dte; }
    });
    return Number.isFinite(minDte) && minDte > 0 ? minDte : 60;
  }

  function submitSimulation() {
    var e = els();
    var st = state();
    if (!e || !st) { return; }

    // Disable button, show progress
    e.simButton.disabled = true;
    e.simButton.textContent = "Running...";
    e.simStatus.textContent = "Submitting simulation...";
    e.simResults.classList.add("sim-hidden");

    var tpVal = parseFloat(e.simTpInput ? e.simTpInput.value : "");
    var slVal = parseFloat(e.simSlInput ? e.simSlInput.value : "");
    var mode = st.simTpSlMode || "pct";
    var tpDol = Number.isFinite(tpVal) ? tpVal : null;
    var slDol = Number.isFinite(slVal) ? slVal : null;

    if (mode === "pct" && (tpDol !== null || slDol !== null)) {
      // Convert % of net premium to dollar P&L
      var activeLegs = st.legs.filter(function (l) { return !l.excluded; });
      var netPremium = 0;
      activeLegs.forEach(function (l) {
        var dir = l.side === "buy" ? -1 : 1;
        netPremium += l.entry * l.qty * st.multiplier * dir;
      });
      var base = Math.abs(netPremium) || 1;
      if (tpDol !== null) { tpDol = (tpDol / 100) * base; }
      if (slDol !== null) { slDol = (slDol / 100) * base; }
    }

    var payload = {
      spot: st.ticker ? (root.Euro.Api && root.Euro.Api.scenarioSpot()) : null,
      legs: st.legs.filter(function (l) { return !l.excluded; }).map(function (l) {
        return {
          strike: l.strike,
          right: l.right,
          side: l.side,
          qty: l.qty,
          entry: l.entry,
          expiry: l.expiry,
          iv: l.iv,
        };
      }),
      multiplier: st.multiplier,
      n_paths: parseInt(e.simPathsSlider ? e.simPathsSlider.value : "10000", 10) || 10000,
      horizon_days: parseInt(e.simHorizonInput ? e.simHorizonInput.value : "60", 10) || 60,
      take_profit: tpDol,
      stop_loss: slDol,
    };

    fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          e.simStatus.textContent = "Error: " + data.error;
          e.simButton.disabled = false;
          e.simButton.textContent = "Run Simulation";
          return;
        }
        e.simStatus.textContent = "Running simulation... (job " + data.job_id + ")";
        pollJob(data.job_id);
      })
      .catch(function (err) {
        e.simStatus.textContent = "Network error: " + err.message;
        e.simButton.disabled = false;
        e.simButton.textContent = "Run Simulation";
      });
  }
  Sim.submitSimulation = submitSimulation;

  function pollJob(jobId) {
    var e = els();
    var maxAttempts = 180;
    var attempts = 0;
    clearInterval(activePollId);

    activePollId = setInterval(function () {
      attempts += 1;
      if (attempts > maxAttempts) {
        clearInterval(activePollId);
        if (e) {
          e.simStatus.textContent = "Simulation timed out.";
          e.simButton.disabled = false;
          e.simButton.textContent = "Run Simulation";
        }
        return;
      }

      fetch("/api/simulate?job_id=" + encodeURIComponent(jobId) + "&results=1")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.status === "done" || data.status === "completed") {
            clearInterval(activePollId);
            if (e) {
              e.simButton.disabled = false;
              e.simButton.textContent = "Run Simulation";
              // Legacy field name; the manager stores under "result"
              var result = data.result || data;
              Sim.renderSimResults(result);
            }
          } else if (data.status === "error") {
            clearInterval(activePollId);
            if (e) {
              e.simStatus.textContent = "Error: " + (data.error || "unknown");
              e.simButton.disabled = false;
              e.simButton.textContent = "Run Simulation";
            }
          } else if (data.status === "running") {
            if (e) { e.simStatus.textContent = "Simulating... (" + Math.round(data.progress_pct || 0) + "%)"; }
          }
        })
        .catch(function () {
          // Ignore transient poll errors
        });
    }, 1000);
  }
  Sim.pollJob = pollJob;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Sim;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.Sim = Sim;
  }
})(this);
