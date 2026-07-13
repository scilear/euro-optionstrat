"""Option-chain retrieval, normalization, and cache management."""

from __future__ import annotations

import copy
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import date
from datetime import timedelta
from pathlib import Path
from typing import Any

from .constants import DEFAULT_INDEX_ROWS
from .constants import EXPIRY_RE
from .constants import MOCK_SPOTS
from .constants import TICKER_RE
from .models import ChainError
from .models import IndexPreset
from .utils import age_seconds_from_utc
from .utils import black_scholes
from .utils import bs_delta
from .utils import float_or_none
from .utils import normalize_row
from .utils import strike_step
from .utils import third_friday
from .utils import utc_now


def load_index_presets(mapping_file: Path) -> list[IndexPreset]:
    """Load index ticker presets from a JSON mapping file."""
    rows: list[dict[str, Any]] = []
    try:
        with mapping_file.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        raw_rows = payload.get("indices", [])
        if isinstance(raw_rows, list):
            rows = [row for row in raw_rows if isinstance(row, dict)]
    except (OSError, json.JSONDecodeError):
        rows = []

    presets = _parse_index_rows(rows)
    if presets:
        return presets
    return _parse_index_rows(DEFAULT_INDEX_ROWS)


def _parse_index_rows(rows: list[dict[str, Any]]) -> list[IndexPreset]:
    presets: list[IndexPreset] = []
    for row in rows:
        try:
            presets.append(
                IndexPreset(
                    symbol=str(row["symbol"]).upper(),
                    name=str(row["name"]),
                    currency=str(row["currency"]).upper(),
                    multiplier=int(row["multiplier"]),
                    option_chain_ticker=str(row["option_chain_ticker"]).upper(),
                    yahoo_ticker=str(row.get("yahoo_ticker") or row["option_chain_ticker"]).upper(),
                    aliases=[str(alias).upper() for alias in row.get("aliases", [])],
                    note=str(row.get("note") or ""),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return presets


class OptionChainService:
    """Fetches and normalizes option-chain JSON from OptionTrader."""

    def __init__(
        self,
        chain_tool: Path,
        timeout_seconds: int,
        ib_timeout_seconds: int,
        mapping_file: Path,
        xdg_cache_home: str | None,
        chain_cache_file: Path,
        cache_fresh_seconds: int,
    ) -> None:
        self.chain_tool = chain_tool
        self.timeout_seconds = timeout_seconds
        self.ib_timeout_seconds = max(1, int(ib_timeout_seconds))
        self.xdg_cache_home = (xdg_cache_home or "").strip() or None
        self.mapping_file = mapping_file
        self.chain_cache_file = chain_cache_file
        self.cache_fresh_seconds = max(1, int(cache_fresh_seconds))
        self.index_presets: list[IndexPreset] = []
        self.ticker_map: dict[str, IndexPreset] = {}
        self.reload_index_presets()
        self.cache: dict[tuple[str, str, str, bool, bool], dict[str, Any]] = {}
        self.live_chain_cache: dict[str, dict[str, Any]] = {}
        self._expiries_cache: dict[str, list[dict[str, Any]]] = {}
        self._load_live_cache_file()

    def get_indices(self) -> list[dict[str, Any]]:
        """Return supported index presets."""
        return [
            {
                "symbol": preset.symbol,
                "name": preset.name,
                "currency": preset.currency,
                "multiplier": preset.multiplier,
                "option_chain_ticker": preset.option_chain_ticker,
                "yahoo_ticker": preset.yahoo_ticker,
                "aliases": preset.aliases,
                "note": preset.note,
            }
            for preset in self.index_presets
        ]

    def _fetch_actual_expiries(self, ticker: str) -> list[dict[str, Any]] | None:
        """Fetch actual option expirations for a ticker via yfinance."""
        import concurrent.futures
        import logging

        def _fetch() -> list[str] | None:
            import yfinance as yf
            try:
                t = yf.Ticker(ticker)
                return list(t.options)
            except Exception:
                return None

        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            fut = pool.submit(_fetch)
            try:
                raw = fut.result(timeout=15)
            except Exception:
                return None
        if not raw:
            return None
        today = date.today()
        result = []
        for expiry_str in raw:
            try:
                expiry = date.fromisoformat(expiry_str)
            except (ValueError, TypeError):
                continue
            if expiry <= today:
                continue
            result.append({
                "date": expiry.isoformat(),
                "dte": (expiry - today).days,
                "month": expiry.strftime("%b"),
                "label": expiry.strftime("%b %-d")
                if sys.platform != "win32"
                else expiry.strftime("%b %#d"),
                "monthly": expiry == third_friday(expiry.year, expiry.month),
            })
        return result if result else None

    def get_expiries(self, ticker: str | None = None) -> list[dict[str, Any]]:
        """Return useful candidate expiries.

        For index tickers (SPX, RUT, etc.) include Mon-Wed-Fri weeklies.
        For equity tickers, fetch actual available expirations from yfinance,
        falling back to Fridays + monthlies on error.
        """
        today = date.today()
        is_index = ticker is not None and ticker.upper() in self.ticker_map

        if not is_index and ticker:
            cached = self._expiries_cache.get(ticker)
            if cached is not None:
                return cached
            actual = self._fetch_actual_expiries(ticker)
            if actual is not None:
                self._expiries_cache[ticker] = actual
                return actual

        dates: set[date] = set()

        if is_index:
            for day_offset in range(0, 35):
                candidate = today + timedelta(days=day_offset)
                if candidate.weekday() < 5:
                    dates.add(candidate)

        next_friday = today + timedelta(days=(4 - today.weekday()) % 7)
        if next_friday <= today:
            next_friday += timedelta(days=7)
        for week_offset in range(16):
            dates.add(next_friday + timedelta(days=7 * week_offset))

        for month_offset in range(18):
            year = today.year + (today.month - 1 + month_offset) // 12
            month = (today.month - 1 + month_offset) % 12 + 1
            monthly = third_friday(year, month)
            if monthly > today:
                dates.add(monthly)

        return [
            {
                "date": expiry.isoformat(),
                "dte": (expiry - today).days,
                "month": expiry.strftime("%b"),
                "label": expiry.strftime("%b %-d")
                if sys.platform != "win32"
                else expiry.strftime("%b %#d"),
                "monthly": expiry == third_friday(expiry.year, expiry.month),
            }
            for expiry in sorted(dates)
        ]

    def get_chain(
        self,
        ticker: str,
        expiry: str,
        no_ib: bool,
        mock: bool,
    ) -> dict[str, Any]:
        """Return a normalized chain for the requested ticker and expiry."""
        requested_ticker = self._clean_ticker(ticker)
        display_ticker = self._canonical_symbol(requested_ticker)
        source_ticker = self._source_ticker(display_ticker)
        expiry = self._clean_expiry(expiry)
        key = (display_ticker, source_ticker, expiry, no_ib, mock)
        if key not in self.cache:
            if mock:
                self.cache[key] = self._mock_chain(display_ticker, source_ticker, expiry)
            else:
                try:
                    chain = self._fetch_chain(
                        display_ticker,
                        source_ticker,
                        expiry,
                        no_ib,
                    )
                except ChainError as first_error:
                    if no_ib:
                        raise
                    try:
                        chain = self._fetch_chain(
                            display_ticker,
                            source_ticker,
                            expiry,
                            True,
                        )
                        chain["ib_timeout_warning"] = (
                            f"IB request failed; auto-fallback to --no-ib ({first_error})"
                        )
                    except ChainError:
                        raise first_error
                if not no_ib and self._ib_chain_looks_unusable(chain):
                    try:
                        fallback_chain = self._fetch_chain(
                            display_ticker,
                            source_ticker,
                            expiry,
                            True,
                        )
                        fallback_chain["ib_quality_warning"] = (
                            "IB chain had too few priced strikes; auto-fallback to --no-ib"
                        )
                        chain = fallback_chain
                    except ChainError:
                        pass
                self._remember_live_chain(display_ticker, chain)
                self.cache[key] = chain
        return self.cache[key]

    def clear_cache(self) -> None:
        """Clear cached chain responses."""
        self.cache.clear()

    def get_cached_chain_response(self, ticker: str, live_error: str) -> dict[str, Any] | None:
        """Return the latest cached live chain for ticker, with freshness metadata."""
        requested_ticker = self._clean_ticker(ticker)
        display_ticker = self._canonical_symbol(requested_ticker)
        cached = self.live_chain_cache.get(display_ticker)
        if cached is None:
            return None

        payload = copy.deepcopy(cached)
        age_seconds = age_seconds_from_utc(payload.get("timestamp_utc"))
        is_fresh = age_seconds is not None and age_seconds <= self.cache_fresh_seconds
        payload["from_cache"] = True
        payload["cache_age_seconds"] = age_seconds
        payload["cache_fresh_seconds"] = self.cache_fresh_seconds
        payload["cache_fresh"] = bool(is_fresh)
        payload["live_error"] = live_error
        payload["served_at_utc"] = utc_now()
        return payload

    def reload_index_presets(self) -> None:
        """Reload index presets from mapping file with built-in fallback."""
        self.index_presets = load_index_presets(self.mapping_file)
        self.ticker_map = self._build_ticker_map()

    def _load_live_cache_file(self) -> None:
        self.live_chain_cache = {}
        try:
            if not self.chain_cache_file.exists() or self.chain_cache_file.stat().st_size == 0:
                return
            with self.chain_cache_file.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            by_ticker = payload.get("by_ticker") if isinstance(payload, dict) else None
            if not isinstance(by_ticker, dict):
                return
            for ticker, chain in by_ticker.items():
                if isinstance(ticker, str) and isinstance(chain, dict):
                    self.live_chain_cache[ticker.upper()] = chain
        except (OSError, json.JSONDecodeError):
            self.live_chain_cache = {}

    def _save_live_cache_file(self) -> None:
        try:
            self.chain_cache_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": 1,
                "updated_at_utc": utc_now(),
                "by_ticker": self.live_chain_cache,
            }
            with self.chain_cache_file.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
        except OSError:
            return

    def _remember_live_chain(self, display_ticker: str, chain: dict[str, Any]) -> None:
        self.live_chain_cache[display_ticker.upper()] = copy.deepcopy(chain)
        self._save_live_cache_file()

    def _fetch_chain(
        self,
        display_ticker: str,
        source_ticker: str,
        expiry: str,
        no_ib: bool,
    ) -> dict[str, Any]:
        if not self.chain_tool.exists():
            raise ChainError(f"option_chain.sh not found at {self.chain_tool}")

        cmd = [
            str(self.chain_tool),
            "--ticker",
            source_ticker,
            "--expiry",
            expiry,
            "--output",
            "json",
        ]
        if no_ib:
            cmd.append("--no-ib")

        timeout_secs = self.timeout_seconds if no_ib else min(
            self.timeout_seconds,
            self.ib_timeout_seconds,
        )
        command_text = " ".join(shlex.quote(part) for part in cmd)
        self._log_chain_tool(
            "start "
            f"ticker={display_ticker} source_ticker={source_ticker} expiry={expiry} "
            f"no_ib={int(no_ib)} timeout={timeout_secs}s cmd={command_text}"
        )
        started = time.monotonic()

        try:
            run_env = os.environ.copy()
            if self.xdg_cache_home:
                Path(self.xdg_cache_home).expanduser().mkdir(parents=True, exist_ok=True)
                run_env["XDG_CACHE_HOME"] = str(Path(self.xdg_cache_home).expanduser())

            result = subprocess.run(
                cmd,
                cwd=str(self.chain_tool.parent.parent),
                capture_output=True,
                check=False,
                text=True,
                timeout=timeout_secs,
                env=run_env,
            )
        except OSError as exc:
            self._log_chain_tool(f"oserror ticker={display_ticker} expiry={expiry} error={exc}")
            raise ChainError(f"option_chain.sh environment setup failed: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            elapsed = time.monotonic() - started
            self._log_chain_tool(
                "timeout "
                f"ticker={display_ticker} expiry={expiry} no_ib={int(no_ib)} "
                f"elapsed={elapsed:.2f}s limit={timeout_secs}s"
            )
            if exc.stderr:
                stderr_text = exc.stderr if isinstance(exc.stderr, str) else exc.stderr.decode(
                    "utf-8", errors="replace"
                )
                for line in stderr_text.splitlines():
                    self._log_chain_tool(f"stderr {line}")
            raise ChainError(
                f"option_chain.sh timed out after {timeout_secs}s "
                f"for {display_ticker} ({source_ticker}) {expiry}"
            ) from exc

        elapsed = time.monotonic() - started
        self._log_chain_tool(
            "finish "
            f"ticker={display_ticker} expiry={expiry} no_ib={int(no_ib)} rc={result.returncode} "
            f"elapsed={elapsed:.2f}s stdout_bytes={len(result.stdout)} stderr_bytes={len(result.stderr)}"
        )
        if result.stderr.strip():
            for line in result.stderr.strip().splitlines():
                self._log_chain_tool(f"stderr {line}")

        if result.returncode != 0:
            stderr = result.stderr.strip() or "no stderr"
            stdout_text = result.stdout.strip()
            if stdout_text:
                try:
                    recovered_payload = json.loads(stdout_text)
                    if isinstance(recovered_payload, dict) and isinstance(
                        recovered_payload.get("rows"), list
                    ):
                        self._log_chain_tool(
                            "recover-json "
                            f"ticker={display_ticker} expiry={expiry} source={recovered_payload.get('source')} "
                            f"rows={len(recovered_payload.get('rows') or [])}"
                        )
                        recovered_payload["tool_warning"] = stderr
                        return self._normalize_payload(
                            recovered_payload,
                            display_ticker,
                            source_ticker,
                            expiry,
                            mock=False,
                        )
                except json.JSONDecodeError:
                    self._log_chain_tool(
                        f"stdout-not-json ticker={display_ticker} expiry={expiry}"
                    )
                    pass
            raise ChainError(f"option_chain.sh failed: {stderr}")

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self._log_chain_tool(f"invalid-json ticker={display_ticker} expiry={expiry}")
            raise ChainError("option_chain.sh returned invalid JSON") from exc

        if isinstance(payload, dict):
            self._log_chain_tool(
                "payload "
                f"ticker={display_ticker} expiry={expiry} source={payload.get('source')} "
                f"count={payload.get('count')} raw_ticker={payload.get('ticker')}"
            )

        return self._normalize_payload(
            payload,
            display_ticker,
            source_ticker,
            expiry,
            mock=False,
        )

    def _log_chain_tool(self, message: str) -> None:
        sys.stderr.write(f"{utc_now()} [option_chain] {message}\n")

    def _mock_chain(self, display_ticker: str, source_ticker: str, expiry: str) -> dict[str, Any]:
        spot = MOCK_SPOTS.get(display_ticker.upper(), MOCK_SPOTS.get(source_ticker.upper(), 5000.0))
        expiry_date = date.fromisoformat(expiry)
        dte = max((expiry_date - date.today()).days, 1)
        base_vol = 0.18 + min(dte, 365) / 3650.0
        step = strike_step(spot)
        center = round(spot / step) * step
        rows: list[dict[str, Any]] = []

        for index in range(-28, 29):
            strike = center + index * step
            if strike <= 0:
                continue
            moneyness = strike / spot - 1.0
            for right in ("C", "P"):
                skew = max(-0.04, min(0.08, -moneyness * 0.35))
                iv = max(0.05, base_vol + skew)
                mid = black_scholes(spot, strike, dte / 365.0, iv, right)
                spread = max(step * 0.002, mid * 0.04)
                bid = max(0.0, mid - spread / 2.0)
                ask = mid + spread / 2.0
                delta = bs_delta(spot, strike, dte / 365.0, iv, right)
                rows.append(
                    {
                        "expiry": expiry,
                        "strike": round(strike, 4),
                        "right": right,
                        "bid": round(bid, 4),
                        "ask": round(ask, 4),
                        "mid": round(mid, 4),
                        "last": round(mid, 4),
                        "iv": round(iv, 6),
                        "delta": round(delta, 6),
                        "gamma": None,
                        "vega": None,
                        "theta": None,
                        "oi": 0,
                        "volume": 0,
                        "stale": False,
                        "wide_spread": False,
                        "iv_solve_status": "mock",
                    }
                )

        payload = {
            "ticker": display_ticker,
            "expiry": expiry,
            "spot": spot,
            "iv_rank_rv_proxy": None,
            "source": "synthetic-sample",
            "count": len(rows),
            "rows": rows,
        }
        return self._normalize_payload(
            payload,
            display_ticker,
            source_ticker,
            expiry,
            mock=True,
        )

    def _normalize_payload(
        self,
        payload: dict[str, Any],
        display_ticker: str,
        source_ticker: str,
        requested_expiry: str,
        mock: bool,
    ) -> dict[str, Any]:
        rows = []
        for row in payload.get("rows", []):
            normalized = normalize_row(row, float_or_none)
            if normalized is not None:
                rows.append(normalized)

        rows.sort(key=lambda item: (item["strike"], item["right"]))
        actual_expiry = str(payload.get("expiry") or requested_expiry)
        return {
            "ticker": display_ticker,
            "source_ticker": source_ticker,
            "raw_ticker": str(payload.get("ticker") or source_ticker).upper(),
            "requested_expiry": requested_expiry,
            "expiry": actual_expiry,
            "spot": float_or_none(payload.get("spot")),
            "iv_rank_rv_proxy": float_or_none(payload.get("iv_rank_rv_proxy")),
            "source": payload.get("source") or "unknown",
            "count": len(rows),
            "rows": rows,
            "mock": mock,
            "from_cache": False,
            "cache_age_seconds": 0,
            "cache_fresh": True,
            "cache_fresh_seconds": self.cache_fresh_seconds,
            "timestamp_utc": utc_now(),
            "served_at_utc": utc_now(),
        }

    def _ib_chain_looks_unusable(self, chain: dict[str, Any]) -> bool:
        source = str(chain.get("source") or "").lower()
        if "ib" not in source:
            return False

        dte_days: int | None = None
        expiry_text = str(chain.get("expiry") or chain.get("requested_expiry") or "").strip()
        if expiry_text:
            try:
                dte_days = (date.fromisoformat(expiry_text) - date.today()).days
            except ValueError:
                dte_days = None

        rows = chain.get("rows") if isinstance(chain, dict) else None
        if not isinstance(rows, list) or not rows:
            return True

        priced_rows = 0
        valid_iv_rows = 0
        two_sided_rows = 0
        unique_strikes: set[float] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            strike = float_or_none(row.get("strike"))
            if strike is not None:
                unique_strikes.add(strike)

            bid = float_or_none(row.get("bid")) or 0.0
            ask = float_or_none(row.get("ask")) or 0.0
            mid = float_or_none(row.get("mid")) or 0.0
            last = float_or_none(row.get("last")) or 0.0
            iv = float_or_none(row.get("iv"))

            if max(bid, ask, mid, last) > 0:
                priced_rows += 1
            if bid > 0 and ask > 0:
                two_sided_rows += 1
            if iv is not None and iv > 0:
                valid_iv_rows += 1

        if len(unique_strikes) < 4:
            return True
        if priced_rows < 8:
            return True
        if two_sided_rows < 4:
            return True
        if (dte_days is None or dte_days > 0) and valid_iv_rows < 4:
            return True
        return False

    @property
    def _ib_contract_price_tool(self) -> Path:
        """Path to ib_contract_price.py in the OptionTrader tools directory."""
        return self.chain_tool.parent / "ib_contract_price.sh"

    def get_ib_prices(
        self,
        ticker: str,
        legs: list[dict],
    ) -> list[dict[str, Any]]:
        """Fetch live IB bid/ask/mid/Greeks for specific legs only.

        Uses ib_contract_price.py which fetches individual contract prices
        from IB (much faster than loading the full chain via option_chain.sh).
        Skips stock legs (right='U').
        """
        display_ticker = self._canonical_symbol(ticker)

        # Build leg list for the script (skip stock legs)
        target_legs: list[dict[str, Any]] = []
        for leg in legs:
            right = str(leg.get("right", "")).upper()
            expiry = str(leg.get("expiry", "")).strip()
            if right == "U" or not expiry:
                continue
            target_legs.append({
                "expiry": expiry,
                "strike": float(leg.get("strike", 0)),
                "right": right,
            })

        if not target_legs:
            return []

        # Build comma-separated legs arg: expiry|strike|right,expiry|strike|right
        leg_parts: list[str] = []
        for leg in target_legs:
            leg_parts.append(f"{leg['expiry']}|{leg['strike']}|{leg['right']}")
        legs_arg = ",".join(leg_parts)

        cmd = [
            str(self._ib_contract_price_tool),
            "--ticker", display_ticker,
            "--legs", legs_arg,
        ]

        command_text = " ".join(shlex.quote(part) for part in cmd)
        self._log_chain_tool(
            f"start ib-contract-price ticker={display_ticker} legs={len(target_legs)} cmd={command_text}"
        )
        started = time.monotonic()

        try:
            run_env = os.environ.copy()
            if self.xdg_cache_home:
                Path(self.xdg_cache_home).expanduser().mkdir(parents=True, exist_ok=True)
                run_env["XDG_CACHE_HOME"] = str(Path(self.xdg_cache_home).expanduser())

            result = subprocess.run(
                cmd,
                cwd=str(self.chain_tool.parent.parent),
                capture_output=True,
                check=False,
                text=True,
                timeout=self.ib_timeout_seconds,
                env=run_env,
            )
        except OSError as exc:
            self._log_chain_tool(f"oserror ib-contract-price ticker={display_ticker} error={exc}")
            raise ChainError(f"ib_contract_price.py environment setup failed: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            elapsed = time.monotonic() - started
            self._log_chain_tool(
                f"timeout ib-contract-price ticker={display_ticker} "
                f"elapsed={elapsed:.2f}s limit={self.ib_timeout_seconds}s"
            )
            raise ChainError(
                f"ib_contract_price.py timed out after {self.ib_timeout_seconds}s for {display_ticker}"
            ) from exc

        elapsed = time.monotonic() - started
        self._log_chain_tool(
            f"finish ib-contract-price ticker={display_ticker} "
            f"rc={result.returncode} elapsed={elapsed:.2f}s "
            f"stdout_bytes={len(result.stdout)}"
        )

        if result.stderr.strip():
            for line in result.stderr.strip().splitlines():
                self._log_chain_tool(f"stderr {line}")

        if result.returncode != 0:
            stderr = result.stderr.strip() or "no stderr"
            raise ChainError(f"ib_contract_price.py failed: {stderr}")

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self._log_chain_tool(f"invalid-json ib-contract-price ticker={display_ticker}")
            raise ChainError("ib_contract_price.py returned invalid JSON") from exc

        prices = payload.get("prices", [])
        error_msg = payload.get("error")
        if error_msg:
            raise ChainError(f"IB contract pricing error: {error_msg}")

        return prices

    def _clean_ticker(self, ticker: str) -> str:
        ticker = ticker.strip().upper()
        if not TICKER_RE.match(ticker):
            raise ChainError(f"Invalid ticker: {ticker!r}")
        return ticker

    def _source_ticker(self, ticker: str) -> str:
        preset = self.ticker_map.get(ticker)
        return preset.option_chain_ticker if preset else ticker

    def _canonical_symbol(self, ticker: str) -> str:
        preset = self.ticker_map.get(ticker)
        return preset.symbol if preset else ticker

    def _build_ticker_map(self) -> dict[str, IndexPreset]:
        ticker_map = {}
        for preset in self.index_presets:
            keys = {preset.symbol, preset.option_chain_ticker, preset.yahoo_ticker, *preset.aliases}
            for key in keys:
                ticker_map[key.upper()] = preset
        return ticker_map

    def _clean_expiry(self, expiry: str) -> str:
        expiry = expiry.strip()
        if not EXPIRY_RE.match(expiry):
            raise ChainError(f"Invalid expiry: {expiry!r}")
        try:
            date.fromisoformat(expiry)
        except ValueError as exc:
            raise ChainError(f"Invalid expiry date: {expiry!r}") from exc
        return expiry
