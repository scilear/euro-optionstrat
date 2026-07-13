"""Shared utility helpers for euro_optionstrat backend."""

from __future__ import annotations

import math
import re
from datetime import date
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from typing import Any
from uuid import uuid4


def normalize_row(row: dict[str, Any], float_or_none: callable) -> dict[str, Any] | None:
    strike = float_or_none(row.get("strike"))
    expiry = row.get("expiry")
    right = str(row.get("right") or "").upper()
    if strike is None or not expiry or right not in {"C", "P"}:
        return None

    bid = float_or_none(row.get("bid")) or 0.0
    ask = float_or_none(row.get("ask")) or 0.0
    mid = float_or_none(row.get("mid"))
    if mid is None:
        mid = (bid + ask) / 2.0 if bid + ask > 0 else float_or_none(row.get("last")) or 0.0

    return {
        "expiry": str(expiry),
        "strike": strike,
        "right": right,
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "last": float_or_none(row.get("last")) or 0.0,
        "iv": float_or_none(row.get("iv")),
        "delta": float_or_none(row.get("delta")),
        "gamma": float_or_none(row.get("gamma")),
        "vega": float_or_none(row.get("vega")),
        "theta": float_or_none(row.get("theta")),
        "oi": int(float_or_none(row.get("oi")) or 0),
        "volume": int(float_or_none(row.get("volume")) or 0),
        "stale": bool(row.get("stale")),
        "wide_spread": bool(row.get("wide_spread")),
        "iv_solve_status": str(row.get("iv_solve_status") or ""),
    }


def first(params: dict[str, list[str]], name: str, default: str) -> str:
    values = params.get(name)
    return values[0] if values else default


def truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def age_seconds_from_utc(value: Any) -> int | None:
    if not value:
        return None
    try:
        text = str(value).strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        stamp = datetime.fromisoformat(text)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)
        return max(0, int(delta.total_seconds()))
    except (TypeError, ValueError):
        return None


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-_")
    return slug[:72] or f"trade-{uuid4().hex[:12]}"


def normalize_vol_mode(value: Any) -> str:
    mode = str(value or "parallel").strip().lower()
    if mode in {"parallel", "sticky_strike", "sticky_delta"}:
        return mode
    return "parallel"


def float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def third_friday(year: int, month: int) -> date:
    first_day = date(year, month, 1)
    first_friday = first_day + timedelta(days=(4 - first_day.weekday()) % 7)
    return first_friday + timedelta(days=14)


def strike_step(spot: float) -> float:
    if spot < 1500:
        return 10.0
    if spot < 7000:
        return 25.0
    if spot < 15000:
        return 50.0
    return 100.0


def ncdf(value: float) -> float:
    return 0.5 * math.erfc(-value / math.sqrt(2.0))


def black_scholes(spot: float, strike: float, t_years: float, vol: float, right: str) -> float:
    rate = 0.03
    if t_years <= 0 or vol <= 0:
        return max(0.0, spot - strike) if right == "C" else max(0.0, strike - spot)
    vol_sqrt = vol * math.sqrt(t_years)
    if vol_sqrt <= 0:
        return 0.0
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol * vol) * t_years) / vol_sqrt
    d2 = d1 - vol_sqrt
    discount = math.exp(-rate * t_years)
    if right == "C":
        return max(0.0, spot * ncdf(d1) - strike * discount * ncdf(d2))
    return max(0.0, strike * discount * ncdf(-d2) - spot * ncdf(-d1))


def bs_delta(spot: float, strike: float, t_years: float, vol: float, right: str) -> float:
    if t_years <= 0 or vol <= 0:
        if right == "C":
            return 1.0 if spot > strike else 0.0
        return -1.0 if spot < strike else 0.0
    vol_sqrt = vol * math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (0.03 + 0.5 * vol * vol) * t_years) / vol_sqrt
    return ncdf(d1) if right == "C" else ncdf(d1) - 1.0
