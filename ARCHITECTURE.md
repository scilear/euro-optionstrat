# Euro OptionStrat Architecture

This document describes the post-Phase-1 backend structure for `tools/euro_optionstrat`.

## Runtime Entry
- `server.py`
  - Thin compatibility entrypoint.
  - Re-exports key symbols for backward compatibility.
  - Delegates startup to `backend.app.main()`.

## Backend Modules
- `backend/app.py`
  - CLI parsing.
  - Service/store wiring.
  - HTTP server startup.

- `backend/http_handler.py`
  - `EuroOptionStratServer` and `EuroOptionStratHandler`.
  - API routing for indices, expiries, chain, trades, templates.
  - JSON response helpers and endpoint-level error mapping.

- `backend/chain_service.py`
  - Option chain fetch, fallback, and normalization.
  - Index preset loading and ticker mapping.
  - Live chain cache load/save.
  - Synthetic/mock chain generation.

- `backend/stores.py`
  - `TradeStore` and `TemplateStore` persistence.
  - File-per-item JSON storage in `trades/` and `templates/`.
  - CSV mirror export for backward compatibility.
  - Legacy CSV migration when JSON directories are empty.

- `backend/constants.py`
  - Paths, defaults, regexes, schema field lists, index presets.

- `backend/models.py`
  - Dataclass/domain types and error classes.

- `backend/utils.py`
  - Pure utility functions (parsing, time, pricing helpers, formatting).

## Data Persistence
- Primary stores:
  - `tools/euro_optionstrat/trades/*.json`
  - `tools/euro_optionstrat/templates/*.json`
- Compatibility mirrors:
  - `tools/euro_optionstrat/trades.csv`
  - `tools/euro_optionstrat/templates.csv`

## Validation
- API smoke validation script:
  - `scripts/validation/validate_euro_optionstrat_api.py`
- File-size guardrail script:
  - `scripts/validation/validate_euro_optionstrat_file_sizes.py`
