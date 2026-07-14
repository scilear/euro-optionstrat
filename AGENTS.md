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
