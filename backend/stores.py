"""Persistence stores for trades and templates."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from .constants import TEMPLATE_FIELDS
from .constants import TRADE_FIELDS
from .constants import TRADE_ID_RE
from .models import TemplateStoreError
from .models import TradeStoreError
from .utils import float_or_none
from .utils import normalize_vol_mode
from .utils import slugify
from .utils import utc_now


class TradeStore:
    """File-per-trade persistence for option combinations."""

    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self.legacy_csv_path = storage_path if storage_path.suffix.lower() == ".csv" else None
        self.trades_dir = (
            storage_path.parent / "trades"
            if self.legacy_csv_path is not None
            else storage_path
        )
        self._ensure_store()

    def list_trades(self) -> list[dict[str, Any]]:
        """Return saved trade summaries."""
        summaries: list[dict[str, Any]] = []
        for trade in self._read_all_trade_docs():
            pnl_history = trade.get("pnl_history") if isinstance(trade, dict) else None
            latest_snapshot = (
                pnl_history[-1]
                if isinstance(pnl_history, list) and pnl_history and isinstance(pnl_history[-1], dict)
                else None
            )
            summaries.append(
                {
                    "trade_id": str(trade.get("trade_id") or ""),
                    "trade_name": str(trade.get("trade_name") or trade.get("trade_id") or ""),
                    "ticker": str(trade.get("ticker") or ""),
                    "currency": str(trade.get("currency") or "EUR"),
                    "multiplier": float_or_none(trade.get("multiplier")) or 1,
                    "selected_expiry": str(trade.get("selected_expiry") or ""),
                    "leg_count": len(trade.get("legs") or []),
                    "created_at_utc": str(trade.get("created_at_utc") or ""),
                    "updated_at_utc": str(trade.get("updated_at_utc") or ""),
                    "opened_at_utc": str(trade.get("opened_at_utc") or ""),
                    "opening_net_cost": float_or_none(trade.get("opening_net_cost")),
                    "latest_pnl": float_or_none(
                        latest_snapshot.get("pnl_mark_to_close") if latest_snapshot else None
                    ),
                    "latest_snapshot_utc": str(
                        latest_snapshot.get("timestamp_utc") if latest_snapshot else ""
                    ),
                    "snapshot_count": len(pnl_history) if isinstance(pnl_history, list) else 0,
                }
            )
        return sorted(summaries, key=lambda row: row["updated_at_utc"], reverse=True)

    def load_trade(self, trade_id: str) -> dict[str, Any]:
        """Load one saved trade by id."""
        trade_id = self._clean_trade_id(trade_id)
        trade = self._read_trade_doc(trade_id)
        if trade is None:
            raise TradeStoreError(f"Saved trade not found: {trade_id}")
        return self._normalize_trade_doc(trade)

    def save_trade(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace a saved trade."""
        existing_ids = {doc.get("trade_id") for doc in self._read_all_trade_docs() if doc.get("trade_id")}

        provided_trade_id = str(payload.get("trade_id") or "").strip()
        if provided_trade_id:
            trade_id = self._clean_trade_id(provided_trade_id)
        else:
            base_trade_id = self._clean_trade_id(slugify(str(payload.get("trade_name") or "trade")))
            trade_id = self._next_trade_id(base_trade_id, existing_ids)

        existing = self._read_trade_doc(trade_id)
        now = utc_now()
        created_at = str(existing.get("created_at_utc") or now) if existing else now

        legs_payload = payload.get("legs") or []
        if not isinstance(legs_payload, list) or not legs_payload:
            raise TradeStoreError("Cannot save a trade with no legs")
        legs = [self._normalize_leg_payload(leg) for leg in legs_payload]

        multiplier = float_or_none(payload.get("multiplier")) or 1
        opening_net_cost = (
            float_or_none(existing.get("opening_net_cost"))
            if existing
            else self._opening_net_cost(legs, multiplier)
        )
        opened_at = str(existing.get("opened_at_utc") or now) if existing else now

        existing_history = existing.get("pnl_history") if existing else []
        pnl_history: list[dict[str, Any]] = []
        if isinstance(existing_history, list):
            for row in existing_history:
                if isinstance(row, dict):
                    pnl_history.append(
                        {
                            "timestamp_utc": str(row.get("timestamp_utc") or now),
                            "pnl_mark_to_close": float_or_none(row.get("pnl_mark_to_close")) or 0.0,
                            "spot": float_or_none(row.get("spot")),
                            "source": str(row.get("source") or ""),
                            "selected_expiry": str(row.get("selected_expiry") or ""),
                        }
                    )
        if not pnl_history:
            pnl_history = [
                {
                    "timestamp_utc": opened_at,
                    "pnl_mark_to_close": 0.0,
                    "spot": float_or_none(payload.get("opened_spot")),
                    "source": "opened",
                    "selected_expiry": str(payload.get("selected_expiry") or ""),
                }
            ]

        trade_doc = {
            "trade_id": trade_id,
            "trade_name": str(payload.get("trade_name") or trade_id),
            "ticker": str(payload.get("ticker") or "").upper(),
            "currency": str(payload.get("currency") or "EUR").upper(),
            "multiplier": multiplier,
            "selected_expiry": str(payload.get("selected_expiry") or ""),
            "range_pct": float_or_none(payload.get("range_pct")) or 12,
            "iv_shift_pct": float_or_none(payload.get("iv_shift_pct")) or 0,
            "spot_shift_pct": float_or_none(payload.get("spot_shift_pct")) or 0,
            "vol_mode": normalize_vol_mode(payload.get("vol_mode") or "parallel"),
            "date_offset": float_or_none(payload.get("date_offset")) or 0,
            "created_at_utc": created_at,
            "updated_at_utc": now,
            "opened_at_utc": opened_at,
            "opening_net_cost": opening_net_cost,
            "legs": legs,
            "pnl_history": pnl_history,
        }

        self._write_trade_doc(trade_doc)
        return self.load_trade(trade_id)

    def append_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Append one mark-to-close snapshot for a saved trade."""
        trade_id = self._clean_trade_id(str(payload.get("trade_id") or ""))
        trade = self._read_trade_doc(trade_id)
        if trade is None:
            raise TradeStoreError(f"Saved trade not found: {trade_id}")

        now = utc_now()
        timestamp_utc = str(payload.get("timestamp_utc") or now)
        pnl_mark = float_or_none(payload.get("pnl_mark_to_close"))
        if pnl_mark is None:
            raise TradeStoreError("trade snapshot requires pnl_mark_to_close")
        snapshot = {
            "timestamp_utc": timestamp_utc,
            "pnl_mark_to_close": pnl_mark,
            "spot": float_or_none(payload.get("spot")),
            "source": str(payload.get("source") or ""),
            "selected_expiry": str(payload.get("selected_expiry") or ""),
        }

        history = trade.get("pnl_history") if isinstance(trade.get("pnl_history"), list) else []
        if history and isinstance(history[-1], dict):
            last = history[-1]
            last_ts = str(last.get("timestamp_utc") or "")
            last_pnl = float_or_none(last.get("pnl_mark_to_close"))
            if last_ts == snapshot["timestamp_utc"] and last_pnl == snapshot["pnl_mark_to_close"]:
                return {"trade": self._normalize_trade_doc(trade), "snapshot": last}

        history.append(snapshot)
        if len(history) > 5000:
            history = history[-5000:]
        trade["pnl_history"] = history
        trade["updated_at_utc"] = now
        self._write_trade_doc(trade)
        return {"trade": self._normalize_trade_doc(trade), "snapshot": snapshot}

    def _normalize_leg_payload(self, leg: Any) -> dict[str, Any]:
        if not isinstance(leg, dict):
            raise TradeStoreError("Invalid leg payload")
        side = str(leg.get("side") or "buy").lower()
        if side not in {"buy", "sell"}:
            raise TradeStoreError("Trade leg side must be buy or sell")
        right = str(leg.get("right") or "").upper()
        if right not in {"C", "P", "U"}:
            raise TradeStoreError("Trade leg right must be C, P, or U")
        qty = int(float_or_none(leg.get("qty")) or 0)
        if qty < 1:
            raise TradeStoreError("Trade leg qty must be >= 1")
        return {
            "id": str(leg.get("id") or uuid4()),
            "side": side,
            "qty": qty,
            "right": right,
            "expiry": str(leg.get("expiry") or ""),
            "strike": float_or_none(leg.get("strike")) or 0.0,
            "entry": float_or_none(leg.get("entry")) or 0.0,
            "iv": float_or_none(leg.get("iv")),
            "delta": float_or_none(leg.get("delta")),
        }

    def _normalize_trade_doc(self, doc: dict[str, Any]) -> dict[str, Any]:
        legs = [self._normalize_leg_payload(leg) for leg in doc.get("legs") or []]
        history_raw = doc.get("pnl_history") if isinstance(doc.get("pnl_history"), list) else []
        history: list[dict[str, Any]] = []
        for row in history_raw:
            if not isinstance(row, dict):
                continue
            history.append(
                {
                    "timestamp_utc": str(row.get("timestamp_utc") or ""),
                    "pnl_mark_to_close": float_or_none(row.get("pnl_mark_to_close")) or 0.0,
                    "spot": float_or_none(row.get("spot")),
                    "source": str(row.get("source") or ""),
                    "selected_expiry": str(row.get("selected_expiry") or ""),
                }
            )
        history.sort(key=lambda row: row.get("timestamp_utc") or "")

        return {
            "trade_id": str(doc.get("trade_id") or ""),
            "trade_name": str(doc.get("trade_name") or doc.get("trade_id") or ""),
            "ticker": str(doc.get("ticker") or ""),
            "currency": str(doc.get("currency") or "EUR"),
            "multiplier": float_or_none(doc.get("multiplier")) or 1,
            "selected_expiry": str(doc.get("selected_expiry") or ""),
            "range_pct": float_or_none(doc.get("range_pct")) or 12,
            "iv_shift_pct": float_or_none(doc.get("iv_shift_pct")) or 0,
            "spot_shift_pct": float_or_none(doc.get("spot_shift_pct")) or 0,
            "vol_mode": normalize_vol_mode(doc.get("vol_mode") or "parallel"),
            "date_offset": float_or_none(doc.get("date_offset")) or 0,
            "created_at_utc": str(doc.get("created_at_utc") or ""),
            "updated_at_utc": str(doc.get("updated_at_utc") or ""),
            "opened_at_utc": str(doc.get("opened_at_utc") or ""),
            "opening_net_cost": float_or_none(doc.get("opening_net_cost")),
            "legs": legs,
            "pnl_history": history,
        }

    def _opening_net_cost(self, legs: list[dict[str, Any]], multiplier: float) -> float:
        return sum(
            (
                (1 if leg.get("side") == "buy" else -1)
                * (float_or_none(leg.get("entry")) or 0.0)
                * int(float_or_none(leg.get("qty")) or 1)
                * multiplier
            )
            for leg in legs
        )

    def _trade_path(self, trade_id: str) -> Path:
        return self.trades_dir / f"{trade_id}.json"

    def _read_trade_doc(self, trade_id: str) -> dict[str, Any] | None:
        path = self._trade_path(trade_id)
        try:
            if not path.exists():
                return None
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return payload if isinstance(payload, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def _write_trade_doc(self, trade_doc: dict[str, Any]) -> None:
        trade_id = self._clean_trade_id(str(trade_doc.get("trade_id") or ""))
        path = self._trade_path(trade_id)
        self.trades_dir.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(trade_doc, handle, indent=2)
        self._export_csv()

    def _export_csv(self) -> None:
        """Regenerate legacy CSV from all per-trade JSON files."""
        csv_path = self.legacy_csv_path
        if csv_path is None:
            return
        try:
            docs = self._read_all_trade_docs()
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=TRADE_FIELDS, extrasaction="ignore")
                writer.writeheader()
                for doc in docs:
                    header_row = {
                        "trade_id": str(doc.get("trade_id") or ""),
                        "trade_name": str(doc.get("trade_name") or doc.get("trade_id") or ""),
                        "ticker": str(doc.get("ticker") or ""),
                        "currency": str(doc.get("currency") or "EUR"),
                        "multiplier": float_or_none(doc.get("multiplier")) or 1,
                        "selected_expiry": str(doc.get("selected_expiry") or ""),
                        "range_pct": float_or_none(doc.get("range_pct")) or 12,
                        "iv_shift_pct": float_or_none(doc.get("iv_shift_pct")) or 0,
                        "spot_shift_pct": float_or_none(doc.get("spot_shift_pct")) or 0,
                        "vol_mode": normalize_vol_mode(doc.get("vol_mode") or "parallel"),
                        "date_offset": float_or_none(doc.get("date_offset")) or 0,
                        "created_at_utc": str(doc.get("created_at_utc") or ""),
                        "updated_at_utc": str(doc.get("updated_at_utc") or ""),
                    }
                    legs = doc.get("legs") or []
                    if legs:
                        for leg in legs:
                            row = dict(header_row)
                            row.update(
                                {
                                    "leg_id": str(leg.get("id") or ""),
                                    "side": str(leg.get("side") or "buy"),
                                    "qty": int(float_or_none(leg.get("qty")) or 1),
                                    "right": str(leg.get("right") or "").upper(),
                                    "expiry": str(leg.get("expiry") or ""),
                                    "strike": float_or_none(leg.get("strike")) or 0.0,
                                    "entry": float_or_none(leg.get("entry")) or 0.0,
                                    "iv": float_or_none(leg.get("iv")),
                                    "delta": float_or_none(leg.get("delta")),
                                }
                            )
                            writer.writerow(row)
                    else:
                        writer.writerow(header_row)
        except OSError:
            return

    def _read_all_trade_docs(self) -> list[dict[str, Any]]:
        self._ensure_store()
        docs: list[dict[str, Any]] = []
        for path in sorted(self.trades_dir.glob("*.json")):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                if isinstance(payload, dict) and payload.get("trade_id"):
                    docs.append(payload)
            except (OSError, json.JSONDecodeError):
                continue
        return docs

    def _ensure_store(self) -> None:
        self.trades_dir.mkdir(parents=True, exist_ok=True)
        if self.legacy_csv_path is None:
            return
        if any(self.trades_dir.glob("*.json")):
            return
        if not self.legacy_csv_path.exists() or self.legacy_csv_path.stat().st_size == 0:
            return
        try:
            with self.legacy_csv_path.open("r", newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                grouped: dict[str, list[dict[str, str]]] = {}
                for row in reader:
                    trade_id = str(row.get("trade_id") or "").strip()
                    if trade_id:
                        grouped.setdefault(trade_id, []).append(row)
            for trade_id, rows in grouped.items():
                first = rows[0]
                legs = [
                    {
                        "id": str(row.get("leg_id") or uuid4()),
                        "side": str(row.get("side") or "buy"),
                        "qty": int(float_or_none(row.get("qty")) or 1),
                        "right": str(row.get("right") or "").upper(),
                        "expiry": str(row.get("expiry") or ""),
                        "strike": float_or_none(row.get("strike")) or 0.0,
                        "entry": float_or_none(row.get("entry")) or 0.0,
                        "iv": float_or_none(row.get("iv")),
                        "delta": float_or_none(row.get("delta")),
                    }
                    for row in rows
                ]
                multiplier = float_or_none(first.get("multiplier")) or 1
                doc = {
                    "trade_id": trade_id,
                    "trade_name": str(first.get("trade_name") or trade_id),
                    "ticker": str(first.get("ticker") or "").upper(),
                    "currency": str(first.get("currency") or "EUR").upper(),
                    "multiplier": multiplier,
                    "selected_expiry": str(first.get("selected_expiry") or ""),
                    "range_pct": float_or_none(first.get("range_pct")) or 12,
                    "iv_shift_pct": float_or_none(first.get("iv_shift_pct")) or 0,
                    "spot_shift_pct": float_or_none(first.get("spot_shift_pct")) or 0,
                    "vol_mode": normalize_vol_mode(first.get("vol_mode") or "parallel"),
                    "date_offset": float_or_none(first.get("date_offset")) or 0,
                    "created_at_utc": str(first.get("created_at_utc") or utc_now()),
                    "updated_at_utc": str(first.get("updated_at_utc") or utc_now()),
                    "opened_at_utc": str(first.get("created_at_utc") or utc_now()),
                    "opening_net_cost": self._opening_net_cost(legs, multiplier),
                    "legs": legs,
                    "pnl_history": [
                        {
                            "timestamp_utc": str(first.get("created_at_utc") or utc_now()),
                            "pnl_mark_to_close": 0.0,
                            "spot": None,
                            "source": "migrated",
                            "selected_expiry": str(first.get("selected_expiry") or ""),
                        }
                    ],
                }
                self._write_trade_doc(doc)
        except OSError:
            return

    def _clean_trade_id(self, trade_id: str) -> str:
        trade_id = slugify(trade_id)
        if not TRADE_ID_RE.match(trade_id):
            raise TradeStoreError(f"Invalid trade id: {trade_id!r}")
        return trade_id

    def _next_trade_id(self, base_trade_id: str, existing_ids: set[str]) -> str:
        if base_trade_id not in existing_ids:
            return base_trade_id
        suffix = 2
        while True:
            candidate = f"{base_trade_id}-{suffix}"
            if candidate not in existing_ids:
                return candidate
            suffix += 1


class TemplateStore:
    """File-per-template persistence for relative option templates."""

    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self.legacy_csv_path = storage_path if storage_path.suffix.lower() == ".csv" else None
        self.templates_dir = (
            storage_path.parent / "templates"
            if self.legacy_csv_path is not None
            else storage_path
        )
        self._ensure_store()

    def list_templates(self) -> list[dict[str, Any]]:
        summaries = []
        for doc in self._read_all_template_docs():
            normalized = self._normalize_template_doc(doc)
            summaries.append(
                {
                    "template_id": normalized["template_id"],
                    "template_name": normalized["template_name"],
                    "ticker": normalized["ticker"],
                    "currency": normalized["currency"],
                    "multiplier": normalized["multiplier"],
                    "strike_mode": normalized["strike_mode"],
                    "underlying_scope": normalized["underlying_scope"],
                    "leg_count": len(normalized["legs"]),
                    "created_at_utc": normalized["created_at_utc"],
                    "updated_at_utc": normalized["updated_at_utc"],
                }
            )
        return sorted(summaries, key=lambda row: row["updated_at_utc"], reverse=True)

    def load_template(self, template_id: str) -> dict[str, Any]:
        template_id = self._clean_template_id(template_id)
        doc = self._read_template_doc(template_id)
        if doc is None:
            raise TemplateStoreError(f"Saved template not found: {template_id}")
        return self._normalize_template_doc(doc)

    def save_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        existing_ids = {
            doc.get("template_id") for doc in self._read_all_template_docs() if doc.get("template_id")
        }
        provided_template_id = str(payload.get("template_id") or "").strip()
        if provided_template_id:
            template_id = self._clean_template_id(provided_template_id)
        else:
            base_template_id = self._clean_template_id(slugify(str(payload.get("template_name") or "template")))
            template_id = self._next_template_id(base_template_id, existing_ids)

        now = utc_now()
        existing = self._read_template_doc(template_id)
        created_at = str(existing.get("created_at_utc") or now) if existing else now

        legs_payload = payload.get("legs") or []
        if not isinstance(legs_payload, list) or not legs_payload:
            raise TemplateStoreError("Cannot save a template with no legs")
        legs = [self._normalize_template_leg_payload(leg) for leg in legs_payload]

        strike_mode = str(payload.get("strike_mode") or "pts").strip().lower()
        if strike_mode not in {"pts", "pct", "delta"}:
            raise TemplateStoreError("Template strike_mode must be 'pts', 'pct', or 'delta'")

        underlying_scope = str(payload.get("underlying_scope") or "ticker").strip().lower()
        if underlying_scope not in {"ticker", "any"}:
            raise TemplateStoreError("Template underlying_scope must be 'ticker' or 'any'")

        template_doc = {
            "template_id": template_id,
            "template_name": str(payload.get("template_name") or template_id),
            "ticker": str(payload.get("ticker") or "").upper(),
            "currency": str(payload.get("currency") or "EUR").upper(),
            "multiplier": float_or_none(payload.get("multiplier")) or 1,
            "strike_mode": strike_mode,
            "underlying_scope": underlying_scope,
            "saved_spot": float_or_none(payload.get("saved_spot")),
            "selected_dte": int(float_or_none(payload.get("selected_dte")) or 0),
            "range_pct": float_or_none(payload.get("range_pct")) or 12,
            "iv_shift_pct": float_or_none(payload.get("iv_shift_pct")) or 0,
            "spot_shift_pct": float_or_none(payload.get("spot_shift_pct")) or 0,
            "vol_mode": normalize_vol_mode(payload.get("vol_mode") or "parallel"),
            "date_offset": float_or_none(payload.get("date_offset")) or 0,
            "created_at_utc": created_at,
            "updated_at_utc": now,
            "legs": legs,
        }

        self._write_template_doc(template_doc)
        return self.load_template(template_id)

    def _normalize_template_leg_payload(self, leg: Any) -> dict[str, Any]:
        if not isinstance(leg, dict):
            raise TemplateStoreError("Invalid template leg payload")
        expiry_dte = int(float_or_none(leg.get("expiry_dte")) or 0)
        qty = int(float_or_none(leg.get("qty")) or 0)
        right = str(leg.get("right") or "").upper()
        side = str(leg.get("side") or "").lower()
        if expiry_dte < 0:
            raise TemplateStoreError("Template leg expiry_dte must be >= 0")
        if qty < 1:
            raise TemplateStoreError("Template leg qty must be >= 1")
        if right not in {"C", "P", "U"}:
            raise TemplateStoreError("Template leg right must be C, P, or U")
        if side not in {"buy", "sell"}:
            raise TemplateStoreError("Template leg side must be buy or sell")
        return {
            "id": str(leg.get("id") or uuid4()),
            "side": side,
            "qty": qty,
            "right": right,
            "expiry_dte": expiry_dte,
            "strike_offset": float_or_none(leg.get("strike_offset")) or 0.0,
            "entry": float_or_none(leg.get("entry")) or 0.0,
            "iv": float_or_none(leg.get("iv")),
            "delta": float_or_none(leg.get("delta")),
        }

    def _normalize_template_doc(self, doc: dict[str, Any]) -> dict[str, Any]:
        underlying_scope = str(doc.get("underlying_scope") or "ticker").strip().lower()
        if underlying_scope not in {"ticker", "any"}:
            underlying_scope = "ticker"

        strike_mode = str(doc.get("strike_mode") or "pts").strip().lower()
        if strike_mode not in {"pts", "pct", "delta"}:
            strike_mode = "pts"

        legs = [self._normalize_template_leg_payload(leg) for leg in doc.get("legs") or []]

        return {
            "template_id": str(doc.get("template_id") or ""),
            "template_name": str(doc.get("template_name") or doc.get("template_id") or ""),
            "ticker": str(doc.get("ticker") or ""),
            "currency": str(doc.get("currency") or "EUR"),
            "multiplier": float_or_none(doc.get("multiplier")) or 1,
            "strike_mode": strike_mode,
            "underlying_scope": underlying_scope,
            "saved_spot": float_or_none(doc.get("saved_spot")),
            "selected_dte": int(float_or_none(doc.get("selected_dte")) or 0),
            "range_pct": float_or_none(doc.get("range_pct")) or 12,
            "iv_shift_pct": float_or_none(doc.get("iv_shift_pct")) or 0,
            "spot_shift_pct": float_or_none(doc.get("spot_shift_pct")) or 0,
            "vol_mode": normalize_vol_mode(doc.get("vol_mode") or "parallel"),
            "date_offset": float_or_none(doc.get("date_offset")) or 0,
            "created_at_utc": str(doc.get("created_at_utc") or ""),
            "updated_at_utc": str(doc.get("updated_at_utc") or ""),
            "legs": legs,
        }

    def _template_path(self, template_id: str) -> Path:
        return self.templates_dir / f"{template_id}.json"

    def _read_template_doc(self, template_id: str) -> dict[str, Any] | None:
        path = self._template_path(template_id)
        try:
            if not path.exists():
                return None
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return payload if isinstance(payload, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def _write_template_doc(self, doc: dict[str, Any]) -> None:
        template_id = self._clean_template_id(str(doc.get("template_id") or ""))
        path = self._template_path(template_id)
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(doc, handle, indent=2)
        self._export_csv()

    def _export_csv(self) -> None:
        """Regenerate legacy CSV from all per-template JSON files."""
        csv_path = self.legacy_csv_path
        if csv_path is None:
            return
        try:
            docs = self._read_all_template_docs()
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=TEMPLATE_FIELDS, extrasaction="ignore")
                writer.writeheader()
                for doc in docs:
                    header_row = {
                        "template_id": str(doc.get("template_id") or ""),
                        "template_name": str(doc.get("template_name") or doc.get("template_id") or ""),
                        "ticker": str(doc.get("ticker") or ""),
                        "currency": str(doc.get("currency") or "EUR"),
                        "multiplier": float_or_none(doc.get("multiplier")) or 1,
                        "strike_mode": str(doc.get("strike_mode") or "pts"),
                        "underlying_scope": str(doc.get("underlying_scope") or "ticker"),
                        "saved_spot": float_or_none(doc.get("saved_spot")),
                        "selected_dte": int(float_or_none(doc.get("selected_dte")) or 0),
                        "range_pct": float_or_none(doc.get("range_pct")) or 12,
                        "iv_shift_pct": float_or_none(doc.get("iv_shift_pct")) or 0,
                        "spot_shift_pct": float_or_none(doc.get("spot_shift_pct")) or 0,
                        "vol_mode": normalize_vol_mode(doc.get("vol_mode") or "parallel"),
                        "date_offset": float_or_none(doc.get("date_offset")) or 0,
                        "created_at_utc": str(doc.get("created_at_utc") or ""),
                        "updated_at_utc": str(doc.get("updated_at_utc") or ""),
                    }
                    legs = doc.get("legs") or []
                    if legs:
                        for leg in legs:
                            row = dict(header_row)
                            row.update(
                                {
                                    "leg_id": str(leg.get("id") or ""),
                                    "side": str(leg.get("side") or "buy"),
                                    "qty": int(float_or_none(leg.get("qty")) or 1),
                                    "right": str(leg.get("right") or "").upper(),
                                    "expiry_dte": int(float_or_none(leg.get("expiry_dte")) or 0),
                                    "strike_offset": float_or_none(leg.get("strike_offset")) or 0.0,
                                    "entry": float_or_none(leg.get("entry")) or 0.0,
                                    "iv": float_or_none(leg.get("iv")),
                                    "delta": float_or_none(leg.get("delta")),
                                }
                            )
                            writer.writerow(row)
                    else:
                        writer.writerow(header_row)
        except OSError:
            return

    def _read_all_template_docs(self) -> list[dict[str, Any]]:
        self._ensure_store()
        docs: list[dict[str, Any]] = []
        for path in sorted(self.templates_dir.glob("*.json")):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                if isinstance(payload, dict) and payload.get("template_id"):
                    docs.append(payload)
            except (OSError, json.JSONDecodeError):
                continue
        return docs

    def _ensure_store(self) -> None:
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        if self.legacy_csv_path is None:
            return
        if any(self.templates_dir.glob("*.json")):
            return
        if not self.legacy_csv_path.exists() or self.legacy_csv_path.stat().st_size == 0:
            return
        try:
            with self.legacy_csv_path.open("r", newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                grouped: dict[str, list[dict[str, str]]] = {}
                for row in reader:
                    template_id = str(row.get("template_id") or "").strip()
                    if template_id:
                        grouped.setdefault(template_id, []).append(row)
            for template_id, rows in grouped.items():
                first = rows[0]
                legs = [
                    {
                        "id": str(row.get("leg_id") or uuid4()),
                        "side": str(row.get("side") or "buy"),
                        "qty": int(float_or_none(row.get("qty")) or 1),
                        "right": str(row.get("right") or "").upper(),
                        "expiry_dte": int(float_or_none(row.get("expiry_dte")) or 0),
                        "strike_offset": float_or_none(row.get("strike_offset")) or 0.0,
                        "entry": float_or_none(row.get("entry")) or 0.0,
                        "iv": float_or_none(row.get("iv")),
                        "delta": float_or_none(row.get("delta")),
                    }
                    for row in rows
                ]
                doc = {
                    "template_id": template_id,
                    "template_name": str(first.get("template_name") or template_id),
                    "ticker": str(first.get("ticker") or "").upper(),
                    "currency": str(first.get("currency") or "EUR").upper(),
                    "multiplier": float_or_none(first.get("multiplier")) or 1,
                    "strike_mode": str(first.get("strike_mode") or "pts"),
                    "underlying_scope": str(first.get("underlying_scope") or "ticker"),
                    "saved_spot": float_or_none(first.get("saved_spot")),
                    "selected_dte": int(float_or_none(first.get("selected_dte")) or 0),
                    "range_pct": float_or_none(first.get("range_pct")) or 12,
                    "iv_shift_pct": float_or_none(first.get("iv_shift_pct")) or 0,
                    "spot_shift_pct": float_or_none(first.get("spot_shift_pct")) or 0,
                    "vol_mode": normalize_vol_mode(first.get("vol_mode") or "parallel"),
                    "date_offset": float_or_none(first.get("date_offset")) or 0,
                    "created_at_utc": str(first.get("created_at_utc") or utc_now()),
                    "updated_at_utc": str(first.get("updated_at_utc") or utc_now()),
                    "legs": legs,
                }
                self._write_template_doc(doc)
        except OSError:
            return

    def _clean_template_id(self, template_id: str) -> str:
        template_id = slugify(template_id)
        if not TRADE_ID_RE.match(template_id):
            raise TemplateStoreError(f"Invalid template id: {template_id!r}")
        return template_id

    def _next_template_id(self, base_template_id: str, existing_ids: set[str]) -> str:
        if base_template_id not in existing_ids:
            return base_template_id
        suffix = 2
        while True:
            candidate = f"{base_template_id}-{suffix}"
            if candidate not in existing_ids:
                return candidate
            suffix += 1
