"""Shared constants for euro_optionstrat backend."""

from __future__ import annotations

import re
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"
DEFAULT_MAPPING_FILE = ROOT_DIR / "index_mapping.json"
DEFAULT_TRADES_FILE = ROOT_DIR / "trades.csv"
DEFAULT_TEMPLATES_FILE = ROOT_DIR / "templates.csv"
DEFAULT_CHAIN_CACHE_FILE = ROOT_DIR / "chain_cache.json"
DEFAULT_CHAIN_TOOL = "~/Documents/OptionTrader/tools/option_chain.sh"
DEFAULT_TIMEOUT_SECONDS = 90
DEFAULT_IB_TIMEOUT_SECONDS = 120
DEFAULT_XDG_CACHE_HOME = "/mnt/Data/fabien-cache"
DEFAULT_CACHE_FRESH_SECONDS = 900

TICKER_RE = re.compile(r"^[A-Za-z0-9.^_-]{1,24}$")
EXPIRY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRADE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

TRADE_FIELDS = [
    "trade_id",
    "trade_name",
    "ticker",
    "currency",
    "multiplier",
    "selected_expiry",
    "range_pct",
    "iv_shift_pct",
    "spot_shift_pct",
    "vol_mode",
    "date_offset",
    "created_at_utc",
    "updated_at_utc",
    "leg_id",
    "side",
    "qty",
    "right",
    "expiry",
    "strike",
    "entry",
    "iv",
    "delta",
]

TEMPLATE_FIELDS = [
    "template_id",
    "template_name",
    "ticker",
    "currency",
    "multiplier",
    "strike_mode",
    "underlying_scope",
    "saved_spot",
    "selected_dte",
    "range_pct",
    "iv_shift_pct",
    "spot_shift_pct",
    "vol_mode",
    "date_offset",
    "created_at_utc",
    "updated_at_utc",
    "leg_id",
    "side",
    "qty",
    "right",
    "expiry_dte",
    "strike_offset",
    "entry",
    "iv",
    "delta",
]

MOCK_SPOTS = {
    "SX5E": 5450.0,
    "ESTX50": 5450.0,
    "^STOXX50E": 5450.0,
    "DAX": 24150.0,
    "^GDAXI": 24150.0,
    "CAC40": 7900.0,
    "^FCHI": 7900.0,
    "UKX": 8750.0,
    "Z": 8750.0,
    "^FTSE": 8750.0,
    "SMI": 12250.0,
    "^SSMI": 12250.0,
    "AEX": 940.0,
    "EOE": 940.0,
    "^AEX": 940.0,
    "IBEX": 14100.0,
    "^IBEX": 14100.0,
    "SPX": 5300.0,
    "^GSPC": 5300.0,
    "RUT": 2100.0,
    "^RUT": 2100.0,
}

DEFAULT_INDEX_ROWS = [
    {
        "symbol": "SX5E",
        "name": "Euro Stoxx 50",
        "currency": "EUR",
        "multiplier": 10,
        "option_chain_ticker": "ESTX50",
        "yahoo_ticker": "^STOXX50E",
        "aliases": ["ESTX50", "EUROSTOXX", "EUROSTOXX50"],
        "note": "IB index ticker ESTX50 (EUREX); Yahoo underlying ^STOXX50E",
    },
    {
        "symbol": "DAX",
        "name": "DAX",
        "currency": "EUR",
        "multiplier": 5,
        "option_chain_ticker": "DAX",
        "yahoo_ticker": "^GDAXI",
        "aliases": ["GDAXI"],
        "note": "IB index ticker DAX (EUREX); Yahoo underlying ^GDAXI",
    },
    {
        "symbol": "CAC40",
        "name": "CAC 40",
        "currency": "EUR",
        "multiplier": 10,
        "option_chain_ticker": "CAC40",
        "yahoo_ticker": "^FCHI",
        "aliases": ["CAC", "FCHI"],
        "note": "IB index ticker CAC40 (MONEP); Yahoo underlying ^FCHI",
    },
    {
        "symbol": "UKX",
        "name": "FTSE 100",
        "currency": "GBP",
        "multiplier": 10,
        "option_chain_ticker": "Z",
        "yahoo_ticker": "^FTSE",
        "aliases": ["FTSE", "FTSE100", "Z"],
        "note": "IB index ticker Z (ICEEU); Yahoo underlying ^FTSE",
    },
    {
        "symbol": "SMI",
        "name": "Swiss Market Index",
        "currency": "CHF",
        "multiplier": 10,
        "option_chain_ticker": "SMI",
        "yahoo_ticker": "^SSMI",
        "aliases": ["SSMI"],
        "note": "IB index ticker SMI (EUREX); Yahoo underlying ^SSMI",
    },
    {
        "symbol": "AEX",
        "name": "AEX",
        "currency": "EUR",
        "multiplier": 100,
        "option_chain_ticker": "EOE",
        "yahoo_ticker": "^AEX",
        "aliases": ["EOE"],
        "note": "IB index ticker EOE (FTA); Yahoo underlying ^AEX",
    },
    {
        "symbol": "IBEX",
        "name": "IBEX 35",
        "currency": "EUR",
        "multiplier": 10,
        "option_chain_ticker": "IBEX",
        "yahoo_ticker": "^IBEX",
        "aliases": ["IBEX35"],
        "note": "IB index ticker IBEX (MEFFRV); Yahoo underlying ^IBEX",
    },
    {
        "symbol": "SPX",
        "name": "S&P 500 Index",
        "currency": "USD",
        "multiplier": 100,
        "option_chain_ticker": "SPX",
        "yahoo_ticker": "^GSPC",
        "aliases": ["^SPX", "GSPC", "^GSPC", "SPXW"],
        "note": "IB index ticker SPX; Yahoo underlying ^GSPC",
    },
    {
        "symbol": "RUT",
        "name": "Russell 2000 Index",
        "currency": "USD",
        "multiplier": 100,
        "option_chain_ticker": "RUT",
        "yahoo_ticker": "^RUT",
        "aliases": ["^RUT", "RUTW"],
        "note": "IB index ticker RUT; Yahoo underlying ^RUT",
    },
]
