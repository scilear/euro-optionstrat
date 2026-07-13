"""CLI wiring and app bootstrap for euro_optionstrat."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from .chain_service import OptionChainService
from .constants import DEFAULT_CACHE_FRESH_SECONDS
from .constants import DEFAULT_CHAIN_CACHE_FILE
from .constants import DEFAULT_CHAIN_TOOL
from .constants import DEFAULT_IB_TIMEOUT_SECONDS
from .constants import DEFAULT_MAPPING_FILE
from .constants import DEFAULT_TEMPLATES_FILE
from .constants import DEFAULT_TIMEOUT_SECONDS
from .constants import DEFAULT_TRADES_FILE
from .constants import DEFAULT_XDG_CACHE_HOME
from .http_handler import EuroOptionStratServer
from .stores import TemplateStore
from .stores import TradeStore


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Local OptionStrat-style builder for index option chains.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", default=8765, type=int, help="Port to bind")
    parser.add_argument(
        "--chain-tool",
        default=os.environ.get("EU_OPTION_CHAIN_TOOL", DEFAULT_CHAIN_TOOL),
        help="Path to OptionTrader tools/option_chain.sh",
    )
    parser.add_argument(
        "--mapping-file",
        default=os.environ.get("EU_OPTIONSTRAT_MAPPING", str(DEFAULT_MAPPING_FILE)),
        help="Path to index ticker mapping JSON",
    )
    parser.add_argument(
        "--trades-file",
        default=os.environ.get("EU_OPTIONSTRAT_TRADES", str(DEFAULT_TRADES_FILE)),
        help="Path to saved trades CSV",
    )
    parser.add_argument(
        "--templates-file",
        default=os.environ.get("EU_OPTIONSTRAT_TEMPLATES", str(DEFAULT_TEMPLATES_FILE)),
        help="Path to saved templates CSV",
    )
    parser.add_argument(
        "--timeout",
        default=int(os.environ.get("EU_OPTIONSTRAT_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)),
        type=int,
        help="option_chain.sh timeout in seconds",
    )
    parser.add_argument(
        "--ib-timeout",
        default=int(os.environ.get("EU_OPTIONSTRAT_IB_TIMEOUT", DEFAULT_IB_TIMEOUT_SECONDS)),
        type=int,
        help="Per-request timeout in seconds when IB is enabled",
    )
    parser.add_argument(
        "--xdg-cache-home",
        default=os.environ.get("EU_OPTIONSTRAT_XDG_CACHE_HOME", DEFAULT_XDG_CACHE_HOME),
        help=(
            "Optional XDG cache root passed to option_chain.sh; useful when HOME has low disk space"
        ),
    )
    parser.add_argument(
        "--chain-cache-file",
        default=os.environ.get("EU_OPTIONSTRAT_CHAIN_CACHE_FILE", str(DEFAULT_CHAIN_CACHE_FILE)),
        help="Path to JSON file storing latest successful live chain per ticker",
    )
    parser.add_argument(
        "--cache-fresh-seconds",
        default=int(os.environ.get("EU_OPTIONSTRAT_CACHE_FRESH_SECONDS", DEFAULT_CACHE_FRESH_SECONDS)),
        type=int,
        help="Age threshold in seconds before cached chain is flagged as stale",
    )
    return parser.parse_args()


def main() -> None:
    """Run the local web server."""
    args = parse_args()
    chain_tool = Path(args.chain_tool).expanduser().resolve()
    mapping_file = Path(args.mapping_file).expanduser().resolve()
    trades_file = Path(args.trades_file).expanduser().resolve()
    templates_file = Path(args.templates_file).expanduser().resolve()
    chain_cache_file = Path(args.chain_cache_file).expanduser().resolve()
    service = OptionChainService(
        chain_tool=chain_tool,
        timeout_seconds=args.timeout,
        ib_timeout_seconds=args.ib_timeout,
        mapping_file=mapping_file,
        xdg_cache_home=args.xdg_cache_home,
        chain_cache_file=chain_cache_file,
        cache_fresh_seconds=args.cache_fresh_seconds,
    )
    trade_store = TradeStore(trades_file)
    template_store = TemplateStore(templates_file)
    server = EuroOptionStratServer((args.host, args.port), service, trade_store, template_store)
    url = f"http://{args.host}:{args.port}"
    print(f"Euro OptionStrat running at {url}")
    print(f"Using option chain tool: {chain_tool}")
    print(f"Using index mapping: {mapping_file}")
    print(f"Using saved trades CSV: {trades_file}")
    print(f"Using saved templates CSV: {templates_file}")
    print(f"Using XDG cache home: {args.xdg_cache_home}")
    print(f"Using chain cache file: {chain_cache_file}")
    print(f"Cache freshness threshold: {args.cache_fresh_seconds}s")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server")
