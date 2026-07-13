"""Dataclasses and backend domain exceptions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IndexPreset:
    """Display metadata for an index preset."""

    symbol: str
    name: str
    currency: str
    multiplier: int
    option_chain_ticker: str
    yahoo_ticker: str
    aliases: list[str]
    note: str


class ChainError(RuntimeError):
    """Raised when option-chain data cannot be loaded."""


class TradeStoreError(RuntimeError):
    """Raised when saved trade data is invalid."""


class TemplateStoreError(RuntimeError):
    """Raised when saved template data is invalid."""


class SimulationError(RuntimeError):
    """Raised when simulation parameters or execution fails."""
