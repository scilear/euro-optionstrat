#!/usr/bin/env python3
"""Compatibility entrypoint for euro_optionstrat backend."""

from backend.app import main
from backend.app import parse_args
from backend.chain_service import OptionChainService
from backend.chain_service import _parse_index_rows
from backend.chain_service import load_index_presets
from backend.constants import DEFAULT_CACHE_FRESH_SECONDS
from backend.constants import DEFAULT_CHAIN_CACHE_FILE
from backend.constants import DEFAULT_CHAIN_TOOL
from backend.constants import DEFAULT_IB_TIMEOUT_SECONDS
from backend.constants import DEFAULT_INDEX_ROWS
from backend.constants import DEFAULT_MAPPING_FILE
from backend.constants import DEFAULT_TIMEOUT_SECONDS
from backend.constants import DEFAULT_TEMPLATES_FILE
from backend.constants import DEFAULT_TRADES_FILE
from backend.constants import DEFAULT_XDG_CACHE_HOME
from backend.constants import EXPIRY_RE
from backend.constants import MOCK_SPOTS
from backend.constants import ROOT_DIR
from backend.constants import STATIC_DIR
from backend.constants import TEMPLATE_FIELDS
from backend.constants import TICKER_RE
from backend.constants import TRADE_FIELDS
from backend.constants import TRADE_ID_RE
from backend.http_handler import EuroOptionStratHandler
from backend.http_handler import EuroOptionStratServer
from backend.models import ChainError
from backend.models import IndexPreset
from backend.models import TemplateStoreError
from backend.models import TradeStoreError
from backend.stores import TemplateStore
from backend.stores import TradeStore
from backend.utils import age_seconds_from_utc
from backend.utils import black_scholes
from backend.utils import bs_delta
from backend.utils import first
from backend.utils import float_or_none
from backend.utils import ncdf
from backend.utils import normalize_row
from backend.utils import normalize_vol_mode
from backend.utils import slugify
from backend.utils import strike_step
from backend.utils import third_friday
from backend.utils import truthy
from backend.utils import utc_now


__all__ = [
    "main",
    "parse_args",
    "OptionChainService",
    "EuroOptionStratServer",
    "EuroOptionStratHandler",
    "TradeStore",
    "TemplateStore",
    "ChainError",
    "TradeStoreError",
    "TemplateStoreError",
    "IndexPreset",
    "DEFAULT_CHAIN_TOOL",
    "ROOT_DIR",
    "STATIC_DIR",
    "DEFAULT_MAPPING_FILE",
    "DEFAULT_TRADES_FILE",
    "DEFAULT_TEMPLATES_FILE",
    "DEFAULT_CHAIN_CACHE_FILE",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_IB_TIMEOUT_SECONDS",
    "DEFAULT_XDG_CACHE_HOME",
    "DEFAULT_CACHE_FRESH_SECONDS",
    "TICKER_RE",
    "EXPIRY_RE",
    "TRADE_ID_RE",
    "TRADE_FIELDS",
    "TEMPLATE_FIELDS",
    "MOCK_SPOTS",
    "DEFAULT_INDEX_ROWS",
    "load_index_presets",
    "_parse_index_rows",
    "_first",
    "_truthy",
    "_utc_now",
    "_age_seconds_from_utc",
    "_slugify",
    "_normalize_vol_mode",
    "_float_or_none",
    "_third_friday",
    "_strike_step",
    "_ncdf",
    "_black_scholes",
    "_bs_delta",
    "_normalize_row",
]


def _first(params, name, default):
    return first(params, name, default)


def _truthy(value):
    return truthy(value)


def _utc_now():
    return utc_now()


def _age_seconds_from_utc(value):
    return age_seconds_from_utc(value)


def _slugify(value):
    return slugify(value)


def _normalize_vol_mode(value):
    return normalize_vol_mode(value)


def _float_or_none(value):
    return float_or_none(value)


def _third_friday(year, month):
    return third_friday(year, month)


def _strike_step(spot):
    return strike_step(spot)


def _ncdf(value):
    return ncdf(value)


def _black_scholes(spot, strike, t_years, vol, right):
    return black_scholes(spot, strike, t_years, vol, right)


def _bs_delta(spot, strike, t_years, vol, right):
    return bs_delta(spot, strike, t_years, vol, right)


def _normalize_row(row):
    return normalize_row(row, float_or_none)


if __name__ == "__main__":
    main()
