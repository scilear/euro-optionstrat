# Euro Option Strategy Builder (euro_optionstrat)

Flexible, robust option strategy builder for European and US index options.
Features power-user construction, analysis, and portable reuse of index option
structures across multiple underlyings with parametric (relative) date/strike
workflows and deep editing.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
./run.sh
# Or: ./run.sh --port 8765 --host 0.0.0.0
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

## Features

- **Parametric Templates** — Save/load strategy templates as relative recipes
  by DTE and strike offset, not locked to any single underlying.
- **Strike Mode Flexibility** — Points, percent, or delta-based offsets.
- **Trade & Template Management** — Named save/load with overwrite protection.
  File-per-item JSON in `trades/` and `templates/`.
- **Drag-and-Drop Strike Rail** — Draggable leg tags, right-click context menus
  (maturity, duplicate, remove, exclude), stock leg support.
- **Interactive Controls** — Date slider, price range, IV shift, spot shift,
  and vol model selector (parallel, sticky strike, sticky delta).
- **P&L Visualization** — Canvas payoff diagram with three series (analysis
  date, min expiry, final expiry), hover crosshair, combo Greeks.
- **Chain Table** — Bid/mid/ask/IV for all strikes, buy/sell buttons.
- **Saved Trades P&L History** — Snapshot-based mark-to-close P&L tracking.
- **Monte Carlo Simulation** — SSVI vol surface + regime-dependent OU process
  + numba-JIT path generation. Configurable paths, horizon, TP/SL rules.
- **Data Sources** — OptionTrader (IB) primary, yfinance fallback, synthetic
  sample mode for testing.

## Supported Underlyings

**European indices:** SX5E (Euro Stoxx 50), DAX, CAC40, UKX (FTSE 100), SMI,
AEX, IBEX. **US indices:** SPX (S&P 500), RUT (Russell 2000). Plus any
stock/ETF ticker via yfinance.

## Controls

| Action | How |
|--------|-----|
| Add contract | Click **B/S** in chain table |
| Reassign strike | Drag leg on the strike rail |
| Leg options | Right-click a leg (maturity, duplicate, remove, exclude) |
| Add stock leg | Right-click empty rail area |
| Load ticker | Type in Ticker Search + click Load Ticker |
| Recent tickers | Dropdown persisted in browser localStorage |
| Simulation | Configure strategy, expand Simulation panel, click Run |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/indices` | List supported index presets |
| GET | `/api/expiries` | Available expirations for a ticker |
| GET | `/api/chain` | Option chain for ticker+expiry |
| GET | `/api/clear-cache` | Clear chain cache |
| GET | `/api/trades` | List saved trades |
| GET | `/api/trade` | Load a specific trade |
| GET | `/api/templates` | List saved templates |
| GET | `/api/template` | Load a specific template |
| GET | `/api/simulate` | Get simulation status |
| POST | `/api/trades` | Save a trade |
| POST | `/api/trade-snapshot` | Append P&L snapshot |
| POST | `/api/templates` | Save a template |
| POST | `/api/simulate` | Submit simulation job |
| POST | `/api/ib-prices` | Fetch live IB prices |

## Requirements

- Python 3.10+
- numpy, numba, scipy (simulation engine)
- yfinance (optional, for fallback chain data)
- External: `option_chain.sh` from
  [OptionTrader](https://github.com/scilear/optiontrader) (optional, for live
  IB data)

## Architecture

```
├── server.py                 # Entry point
├── backend/
│   ├── app.py                # CLI + startup wiring
│   ├── http_handler.py       # HTTP server + API routing
│   ├── chain_service.py      # Chain fetch/normalize/cache
│   ├── stores.py             # Trade/Template persistence
│   ├── constants.py          # Paths, regexes, defaults
│   ├── models.py             # Dataclasses + errors
│   ├── utils.py              # Shared helpers
│   └── simulation/           # Monte Carlo engine
│       ├── ssvi.py           # SSVI surface + pricing
│       ├── ou_process.py     # Regime OU with hysteresis
│       ├── monte_carlo.py    # Path generation + repricing
│       ├── metrics.py        # P&L distribution metrics
│       └── params.py         # Default parameter sets
├── static/
│   ├── index.html            # Single-page app shell
│   ├── app.js                # App bootstrap + event wiring
│   └── js/                   # Frontend modules
│       ├── state.js, api.js, pricing.js, chart.js
│       ├── ui-controls.js, templates-trades.js
│       ├── vol-models.js, simulation-ui.js
│       └── utils.js
├── trades/                   # Saved trade JSON files
├── templates/                # Saved template JSON files
└── tests/                    # JS unit tests
```

## License

MIT
