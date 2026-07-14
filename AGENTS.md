# Euro Option Strategy Builder (euro_optionstrat)

## Stack
- **Backend**: Python 3.10+ stdlib (`http.server.ThreadingHTTPServer`, no framework)
- **Frontend**: Vanilla JS IIFE modules on `window.Euro` (no bundler, no framework)
- **Simulation**: numpy + numba (`@njit`) + scipy
- **Tests**: Node.js (`require()`) for pure JS modules only — no Python test runner

## Commands
```bash
pip install -r requirements.txt   # deps: numpy, numba, scipy
./run.sh                           # start server on 127.0.0.1:8765
# or: python3 server.py --port 8765 --host 0.0.0.0

# JS tests (run individually, no test runner/CI)
node tests/test_utils.js
node tests/test_pricing.js
node tests/test_modules.js         # module boundary + dep order checks

# Restart (kills old + starts with nohup)
./restart_optionstrat.sh
# env vars: EU_OPTIONSTRAT_PORT, EU_OPTIONSTRAT_HOST
```

## Frontend — critical ordering
Scripts load in `static/index.html` in this exact order (dependency chain, test_modules.js verifies this):
`state.js → utils.js → pricing.js → api.js → vol-models.js → chart.js → ui-controls.js → simulation-ui.js → templates-trades.js → app.js`

Each JS module in `static/js/` is an IIFE that exports to `module.exports` (for Node tests) and `window.Euro.*` (for browser). **Do not reorder script tags without updating test_modules.js.**

## Backend structure
- `server.py` — thin re-export entrypoint, delegates to `backend.app.main()`
- `backend/` — package with: `app.py`, `http_handler.py`, `chain_service.py`, `stores.py`, `models.py`, `utils.py`, `constants.py`, `simulation/`
- `backend/simulation/` — SSVI surface + regime OU MC engine, async via `SimulationManager` + `ThreadPoolExecutor`
- External chain data: optional `option_chain.sh` from OptionTrader (IB); falls back to yfinance or synthetic mock

## Persistence
- Trades stored as individual JSON in `trades/`, templates in `templates/`
- Legacy CSV at `trades.csv` / `templates.csv` — migration happens automatically when JSON dir is empty
- `chain_cache.json` is runtime cache, gitignored

## Index mapping (`index_mapping.json`)
Maps display symbols (SX5E, SPX, etc.) to IB ticker, yahoo ticker, multiplier, currency. The `option_chain_ticker` field is what gets passed to the external chain tool — it often differs from the display symbol (e.g. SX5E → ESTX50, UKX → Z).

## Environment variables (all optional)
`EU_OPTION_CHAIN_TOOL`, `EU_OPTIONSTRAT_MAPPING`, `EU_OPTIONSTRAT_TRADES`, `EU_OPTIONSTRAT_TEMPLATES`, `EU_OPTIONSTRAT_TIMEOUT`, `EU_OPTIONSTRAT_IB_TIMEOUT`, `EU_OPTIONSTRAT_XDG_CACHE_HOME`, `EU_OPTIONSTRAT_CHAIN_CACHE_FILE`, `EU_OPTIONSTRAT_CACHE_FRESH_SECONDS`

## Constraints
- No CI, no pre-commit, no formatter/linter config in repo
- `ARCHITECTURE.md`, `REFACTOR_PLAN.md`, `SIMULATION_PLAN.md` are design documents — good for context, but the code is the source of truth
- Generated files: never edit `trades/*.json`, `templates/*.json`, or `chain_cache.json` directly

## Architecture & Technical Reference

### Template/Trade Persistence
- File-per-item JSON is the primary store in `trades/` and `templates/`.
- CSV mirrors (`trades.csv`, `templates.csv`) are regenerated for backward compatibility.
- `chain_cache.json` is runtime cache, gitignored.
- Legacy CSV migration happens automatically when JSON directories are empty.

### Scenario & Vol Modeling
- `spot_shift_pct` and `vol_mode` persist with both trades and templates (default: 0 / `parallel`).
- **Vol models:**
  - `parallel`: constant per-leg base IV plus one additive shift to all legs.
  - `sticky_strike`: each leg reprices using chain IV nearest that strike.
  - `sticky_delta`: builds scenario delta→IV samples, de-duplicates near-delta points, winsorizes outliers, smooths locally, then interpolates mapped IV. All modes still apply the global IV shift.
- **Sticky Debug (hidden):** enable with `?stickyDebug=1` in URL. Shows `tΔ`, `mΔ`, `|Δ|`, and mapped IV for a sample leg when Vol Model = Sticky Delta.

### Parametric / Portable Templates
- Templates with `scope: any` store no ticker — they're portable recipes.
- When loading a portable template, UI keeps the currently-selected ticker.
- Templates with `scope: ticker` are hard-tied to one index; loading on a different ticker warns.
- Strike offset mode: each template records `points` or `percent` of spot. Enforced on save/load/apply.
- Old templates (missing fields) upgrade on load with defaults: `scope: ticker`, `strike_mode: pts`.

### Overwrite & Collision Policy
- When a save collides on name, UI prompts for confirmation.
- Backend will not overwrite without explicit confirmation.
- IDs always increment (`_next_template_id` / `_next_trade_id`), legacy entries remain accessible until deliberately replaced.

### Server & Debugging
- Server starts on `0.0.0.0` by default for remote access.
- Use `restart_optionstrat.sh` for unbuffered logs, health check, auto port-kill, nohup restart. Logs: `optionstrat_server.log`.
- Chain fetch failures return last good cached result with `from_cache` metadata. If neither live nor cache available, sample data is served.
- Fallback to yfinance happens automatically if OptionTrader fails.
- All expiry, strike, and mapping logic is data-driven for extensibility.
