# Euro OptionStrat Refactor Plan

Scope: `tools/euro_optionstrat` only.

## Goals
- Improve readability and maintainability.
- Reduce monolithic files and isolate responsibilities.
- Keep runtime behavior and API contracts unchanged during migration.

## Phase 1 (Current)
- Split backend from `server.py` into focused modules:
  - `backend/app.py`: CLI args + startup wiring
  - `backend/http_handler.py`: HTTP server and API routing
  - `backend/chain_service.py`: option-chain loading/normalization/cache
  - `backend/stores.py`: trade/template persistence
  - `backend/models.py`: dataclasses and domain errors
  - `backend/utils.py`: shared pure helpers
  - `backend/constants.py`: defaults, regexes, field lists, presets
- Keep `server.py` as a thin compatibility entrypoint.

## Phase 2
- Split `static/app.js` by responsibilities:
  - state, api, pricing, vol models, chart, templates/trades, UI controls, bootstrap.

## Phase 3
- Split `static/styles.css` into base/layout/components/states.

## Guardrails
- Add lightweight API regression checks for `/api/chain`, `/api/trades`, `/api/templates`, `/api/trade-snapshot`.
- Add file-size/LOC guardrail to flag future monolith growth.
