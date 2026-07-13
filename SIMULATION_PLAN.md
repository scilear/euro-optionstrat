# Simulation Engine — Implementation Plan & Task Sequence

## Technical Decisions (Critique Points Addressed)

### D1. Regime Hysteresis Band
**Problem**: Single threshold `θ` causes `A_t` to oscillate noisily near the boundary (a tiny shock flips regime each step, changing all OU params).

**Decision**: Two thresholds `θ_low < θ_high` with hysteresis.
- `A_t < θ_low` → Low vol regime
- `A_t > θ_high` → High vol regime
- `θ_low ≤ A_t ≤ θ_high` → **stay in current regime** (no flip)

This adds one flag per path (`r_t`) and a conditional. Cost: ~0. Defaults for SPX: `θ_low=0.18, θ_high=0.22`.

### D2. Exact Conditional OU (not Euler)
**Problem**: Euler `dF = κ(μ - F)Δt + η√Δt Z` has discretization bias when `κΔt ~ 1`. For daily steps `Δt = 1/365` and `κ ~ 10-30`, the bias is material.

**Decision**: Exact conditional update (closed-form, same cost as Euler):

```
F_{t+1} = μ + (F_t - μ)e^{-κΔt} + η√((1 - e^{-2κΔt}) / (2κ)) · Z
```

This gives the true conditional distribution `F_{t+1} | F_t` for an OU process — zero discretization bias for any `Δt`.

### D3. SSVI ρ Limitation
**Problem**: Constant `ρ_τ` across expiries is not observed in real markets (term structure of skew exists).

**Decision**: Implement per the spec (constant ρ) for v1, but document as known limitation. The code will accept a `ρ_by_tenor` dict in the SSVI config for future use; v1 just ignores it and uses the scalar `ρ`. This way the interface doesn't change when we upgrade.

### D4. Transaction Costs on Management Rules
**Problem**: Spec says "on entry and exit" — management actions (rolls, adjustments) also generate trades and incur costs.

**Decision**: Transaction cost applies to **every** trade event (entry, exit, roll, adjustment). Each management action records its cost the same way as initial entry. The `spread_bps` parameter controls all of them uniformly.

---

## Architecture

### New Python Module: `backend/simulation/` (package)

```
backend/simulation/
├── __init__.py          # Public API: run_simulation()
├── ssvi.py              # SSVI surface: params → w(k,τ) → iv → BS price
├── ou_process.py        # Regime-dependent OU with hysteresis + exact update
├── monte_carlo.py       # Path generation, repricing loop
├── metrics.py           # P&L distribution, quantiles, path ordering
└── params.py            # Default parameter sets (SPX, IWM, etc.)
```

### API Changes

```
POST /api/simulate
  Body: { trade_id, n_paths, n_steps, horizon_days, events?, spread_bps? }
  Response: { job_id }   (async, returns immediately)

GET /api/simulate/status?job_id=xxx
  Response: { status: "running"|"done"|"error", progress_pct, result? }
```

### Frontend Changes

- New `<div id="simulation-panel">` in `index.html`
- `static/js/simulation-ui.js` — UI controls and result display
- Extend `chart.js` to show P&L distribution (histogram/cone)

---

## Task Sequence

### Phase 0: Dependencies (5 min)

```
[ ] Add requirements.txt with: numpy, numba, scipy
[ ] pip install
[ ] Verify imports work
```

### Phase 1: SSVI Surface + Pricing (30 min)

Core mathematical implementation. Standalone — testable without the rest.

```
[ ] 1.1 Implement ssvi.py
      - ssvi_total_variance(k, theta, rho, eta, gamma) → w
      - ssvi_iv(k, tau, theta, rho, eta, gamma) → iv
      - option_price_ssvi(S, K, tau, r, q, right, theta, rho, eta, gamma)
      - Units: theta = ATM IV² × tau (total variance at expiry)

[ ] 1.2 Implement theta interpolation
      - theta_from_atm_term(A_t, T_t, tau_requests)
      - A_t = ATM IV at 30d, T_t = ATM IV(60d) - ATM IV(30d)
      - Linear interpolation in tau-space, flat extrapolation

[ ] 1.3 Calibration stub
      - fit_ssvi(chain_snapshot) → {eta, gamma, rho}
      - scipy.optimize.least_squares on cross-sectional IVs
      - Default fallback: eta=2.0, gamma=0.5, rho=-0.7

[ ] 1.4 Test
      - Spot-check: ATM option at 30d → price matches BS with A_t
      - Spot-check: OTM put at 25Δ → skew sensible (rho < 0)
      - Edge: theta = 0 → flat smile
```

### Phase 2: OU Process with Hysteresis (20 min)

```
[ ] 2.1 Implement ou_process.py
      - RegimeParams dataclass: {kappa, mu, eta, sigma_S}
      - CorrMatrix dataclass: 4×4 Cholesky factors per regime
      - OUState dataclass: {S, A, R, T, regime}

[ ] 2.2 exact_ou_step(state, params_low, params_high, theta_low, theta_high, dt)
      - Generate 4 correlated normals via Cholesky
      - Update S (GBM with regime-dependent σ_S)
      - Update A (exact OU, then clamp to [0.05, 1.0])
      - Determine new regime via hysteresis:
          if A < theta_low: regime = LOW
          elif A > theta_high: regime = HIGH
          else: regime stays
      - Update R, T using new regime's OU params (exact OU)

[ ] 2.3 Test
      - OU with no shocks → reverts to μ
      - Hysteresis: A oscillates around boundary → regime stays stable
      - Spot: GBM with σ_S matches expected distribution
```

### Phase 3: Monte Carlo Engine (40 min)

```
[ ] 3.1 Path generation: generate_paths(initial_state, params, n_paths, n_steps, dt)
      - Returns array of shape (n_paths, n_steps+1, 4) = [S, A, R, T]
      - Loop: for each step, call exact_ou_step() on each path
      - With numba.jit for speed

[ ] 3.2 Option repricing: price_legs_along_paths(paths, legs, ssvi_params)
      - For each leg, for each path, for each step:
          - Compute tau = max(expiry - current_time, 0)
          - If tau <= 0: intrinsic value
          - Else: theta from A_t, T_t; SSVI price
      - Returns (n_paths, n_steps+1, n_legs) price arrays

[ ] 3.3 P&L computation
      - Entry cost: sum(leg.qty * leg.entry * multiplier)
      - Path P&L: sum(price_path - entry_cost) per path
      - Management actions: apply at specified steps, adjust cost

[ ] 3.4 Test
      - All paths start at same S → initial prices match BS
      - No vol moves (A constant) → narrow distribution
      - Single leg, 1 step → distribution ≈ BS with A_t
```

### Phase 4: Management Rules & Events (30 min)

```
[ ] 4.1 Management action evaluator
      - Input: current (S, A, R, T), leg state, rule set
      - Rules: target entry/exit based on spot/vol/date conditions
      - Returns modify/close/hold decision per leg

[ ] 4.2 Event handling
      - Scheduled date + ΔA (ATM IV shock)
      - Apply ΔA to A_t, then skew/term shocks: ΔR = β_R·ΔA, ΔT = β_T·ΔA
      - Default β_R = -0.35, β_T = -0.10 for SPX

[ ] 4.3 Transaction costs
      - cost = |qty| × price × spread_bps / 10000
      - Applied on: initial entry, exit, each management action
```

### Phase 5: Output Metrics (20 min)

```
[ ] 5.1 P&L distribution
      - Final P&L per path → histogram deciles, mean, median, std, skew, kurtosis
      - Confidence intervals: 50%, 68%, 90%, 95%

[ ] 5.2 Path ordering metrics
      - First-touch probability: "reaches +X% P&L before -Y% P&L"
      - Max drawdown distribution
      - Time to first target

[ ] 5.3 Validation
      - Quantile calibration error per decile
      - Arbitrage violation count (SSVI violations along paths)
```

### Phase 6: API Integration (15 min)

```
[ ] 6.1 POST /api/simulate
      - Deserialize request → run_simulation() → store result → return job_id
      - Validation: trade exists, paths ≤ 100k, horizon ≤ 365d

[ ] 6.2 GET /api/simulate/status?job_id=xxx
      - Return progress or completed result

[ ] 6.3 Wire into app.py: inject simulation engine, add routes
```

### Phase 7: Frontend (30 min)

```
[ ] 7.1 simulation-ui.js
      - "Run Simulation" button in the strategy builder
      - Controls: n_paths (slider 1k-100k), horizon (dropdown), spread_bps
      - Progress bar during simulation

[ ] 7.2 Results display
      - P&L histogram (canvas, reuse chart.js rendering)
      - Key metrics table (mean, median, std, VaR 95%)
      - Path ordering stats (first-touch, max DD)

[ ] 7.3 Wire into app.js and index.html
```

### Phase 8: Validation & Polish (15 min)

```
[ ] 8.1 Smoke test
      - Create simple fly → simulate → verify distribution looks reasonable
      - With and without spot shift → verify vol response

[ ] 8.2 Edge cases
      - 0 paths → error
      - horizon = 0 → error
      - All ATM vol = 0 → flat prices
      - Negative spread_bps → error

[ ] 8.3 Arbitrage violation monitor
      - Log % of paths with SSVI violations
      - Warning if >1%
```

---

## Default Parameters (SPX)

| Parameter | Low Vol Regime | High Vol Regime |
|-----------|:---:|:---:|
| κ_A (mean reversion speed) | 15 | 25 |
| μ_A (long-run ATM IV) | 0.16 | 0.32 |
| η_A (vol of vol) | 0.40 | 0.60 |
| κ_R (risk reversal MR) | 12 | 20 |
| μ_R (long-run RR) | -0.06 | -0.12 |
| η_R (vol of RR) | 0.20 | 0.30 |
| κ_T (term slope MR) | 10 | 15 |
| μ_T (long-run term slope) | 0.02 | 0.04 |
| η_T (vol of term slope) | 0.15 | 0.20 |
| σ_S (spot vol) | 0.15 | 0.30 |
| ρ(S, A) | -0.70 | -0.80 |
| ρ(S, R) | 0.30 | 0.40 |
| ρ(A, R) | -0.50 | -0.60 |
| θ_low / θ_high | 0.18 / 0.22 | 0.18 / 0.22 |

**SSVI defaults**: `η=2.0, γ=0.5, ρ=-0.7`

**Risk-free rate**: 3% (matching existing pricing.js)

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `backend/simulation/__init__.py` | **CREATE** | Public API |
| `backend/simulation/ssvi.py` | **CREATE** | SSVI surface & pricing |
| `backend/simulation/ou_process.py` | **CREATE** | Exact OU with hysteresis |
| `backend/simulation/monte_carlo.py` | **CREATE** | Path gen & repricing |
| `backend/simulation/metrics.py` | **CREATE** | Output metrics |
| `backend/simulation/params.py` | **CREATE** | Default params |
| `backend/http_handler.py` | **EDIT** | Add simulate endpoints |
| `backend/app.py` | **EDIT** | Wire simulation engine |
| `requirements.txt` | **CREATE** | numpy, numba, scipy |
| `static/js/simulation-ui.js` | **CREATE** | Frontend for sim |
| `static/index.html` | **EDIT** | Add sim panel |
| `static/js/app.js` | **EDIT** | Wire sim controls |
| `static/js/chart.js` | **EDIT** | Distribution viz |

---

## Sequence (Dependency Order)

```
Phase 0 (deps)
   │
   ▼
Phase 1 (SSVI) ──────┐
                      │
Phase 2 (OU) ─────────┤
                      ▼
               Phase 3 (MC engine)
                      │
               ┌──────┼──────┐
               ▼      ▼      ▼
          Phase 4  Phase 5  Phase 6
          (events) (metrics) (API)
               │      │      │
               └──────┼──────┘
                      ▼
               Phase 7 (frontend)
                      │
                      ▼
               Phase 8 (validation)
```

Phases 4-6 are independent of each other (all depend only on Phase 3).

---

## v1 Scope Limits (Explicit)

- **European options only** (no early exercise)
- **SSVI with constant ρ** (term structure of skew not captured)
- **Daily steps** (no intraday)
- **Management rules**: basic stop-loss/take-profit only (no complex rolling calendars)
- **Live calibration**: uses current chain snapshot; historical calibration is offline/optional
- **Numba**: acceleration only for the inner loop (path gen + pricing); everything else is pure numpy
