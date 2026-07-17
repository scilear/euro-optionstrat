"""HTTP server and request handlers for euro_optionstrat."""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler
from http.server import ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs
from urllib.parse import urlparse

from .chain_service import OptionChainService
from .constants import STATIC_DIR
from .models import ChainError
from .models import SimulationError
from .models import TemplateStoreError
from .models import TradeStoreError
from .simulation import SimulationManager
from .stores import TemplateStore
from .stores import TradeStore
from .utils import first
from .utils import truthy

# ── CSFF module (optional — graceful degradation) ────────────────────
try:
    from .csff_handler import CsffHandler
    _csff = CsffHandler()
    print("[csff] CSFF module loaded", file=sys.stderr)
except Exception as _csff_exc:
    _csff = None
    print(f"[csff] CSFF module unavailable: {_csff_exc}", file=sys.stderr)


class EuroOptionStratServer(ThreadingHTTPServer):
    """HTTP server carrying app configuration."""

    def __init__(
        self,
        server_address: tuple[str, int],
        service: OptionChainService,
        trade_store: TradeStore,
        template_store: TemplateStore,
    ) -> None:
        super().__init__(server_address, EuroOptionStratHandler)
        self.service = service
        self.trade_store = trade_store
        self.template_store = template_store
        self.simulation_manager = SimulationManager()


class EuroOptionStratHandler(SimpleHTTPRequestHandler):
    """Static file server plus small JSON API."""

    server: EuroOptionStratServer

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self) -> None:
        """Route GET requests."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if parsed.path == "/api/indices":
            if truthy(first(params, "refresh", "0")):
                self.server.service.reload_index_presets()
            self._send_json({"indices": self.server.service.get_indices()})
            return

        if parsed.path == "/api/expiries":
            ticker = first(params, "ticker", "").strip().upper() or None
            self._send_json({"expiries": self.server.service.get_expiries(ticker)})
            return

        if parsed.path == "/api/chain":
            self._handle_chain(parsed.query)
            return

        if parsed.path == "/api/clear-cache":
            self.server.service.clear_cache()
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/trades":
            self._send_json({"trades": self.server.trade_store.list_trades()})
            return

        if parsed.path == "/api/trade":
            self._handle_load_trade(parsed.query)
            return

        if parsed.path == "/api/templates":
            self._send_json({"templates": self.server.template_store.list_templates()})
            return

        if parsed.path == "/api/template":
            self._handle_load_template(parsed.query)
            return

        if parsed.path == "/api/simulate":
            self._handle_simulate_status(parsed.query)
            return

        if parsed.path.startswith("/csff/"):
            self._handle_csff("GET")
            return

        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        """Route POST requests."""
        parsed = urlparse(self.path)
        if parsed.path == "/api/trades":
            self._handle_save_trade()
            return
        if parsed.path == "/api/trade-snapshot":
            self._handle_append_trade_snapshot()
            return
        if parsed.path == "/api/templates":
            self._handle_save_template()
            return
        if parsed.path == "/api/simulate":
            self._handle_simulate_submit()
            return
        if parsed.path == "/api/ib-prices":
            self._handle_ib_prices()
            return
        if parsed.path.startswith("/csff/"):
            self._handle_csff("POST")
            return
        self._send_json({"error": f"Unknown endpoint: {parsed.path}"}, status=404)

    def log_message(self, fmt: str, *args: Any) -> None:
        """Keep server logs compact."""
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def _handle_chain(self, query: str) -> None:
        params = parse_qs(query)
        ticker = first(params, "ticker", "SX5E")
        expiry = first(params, "expiry", "")
        no_ib = truthy(first(params, "no_ib", "0"))
        mock = truthy(first(params, "mock", "0"))
        fallback_mock = truthy(first(params, "fallback_mock", "1"))

        try:
            chain = self.server.service.get_chain(ticker, expiry, no_ib, mock)
        except ChainError as exc:
            if not mock:
                cached_chain = self.server.service.get_cached_chain_response(ticker, str(exc))
                if cached_chain is not None:
                    self._send_json(cached_chain)
                    return
            if not mock and fallback_mock:
                try:
                    chain = self.server.service.get_chain(ticker, expiry, no_ib, True)
                    chain["fallback_mock"] = True
                    chain["live_error"] = str(exc)
                    self._send_json(chain)
                    return
                except ChainError as fallback_exc:
                    self._send_json({"error": str(fallback_exc)}, status=502)
                    return
            self._send_json({"error": str(exc)}, status=502)
            return
        self._send_json(chain)

    def _handle_load_trade(self, query: str) -> None:
        params = parse_qs(query)
        trade_id = first(params, "id", "")
        try:
            trade = self.server.trade_store.load_trade(trade_id)
        except TradeStoreError as exc:
            self._send_json({"error": str(exc)}, status=404)
            return
        self._send_json({"trade": trade})

    def _handle_save_trade(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            trade = self.server.trade_store.save_trade(payload)
        except (json.JSONDecodeError, TradeStoreError, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        self._send_json({"trade": trade})

    def _handle_append_trade_snapshot(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            result = self.server.trade_store.append_snapshot(payload)
        except (json.JSONDecodeError, TradeStoreError, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        self._send_json(result)

    def _handle_load_template(self, query: str) -> None:
        params = parse_qs(query)
        template_id = first(params, "id", "")
        try:
            template = self.server.template_store.load_template(template_id)
        except TemplateStoreError as exc:
            self._send_json({"error": str(exc)}, status=404)
            return
        self._send_json({"template": template})

    def _handle_save_template(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            template = self.server.template_store.save_template(payload)
        except (json.JSONDecodeError, TemplateStoreError, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        self._send_json({"template": template})

    def _handle_simulate_submit(self) -> None:
        """POST /api/simulate — submit a simulation job."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
        except (json.JSONDecodeError, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return

        spot = payload.get("spot")
        legs = payload.get("legs", [])
        multiplier = payload.get("multiplier", 100)
        n_paths = int(payload.get("n_paths", 10000))
        horizon_days = int(payload.get("horizon_days", 60))
        take_profit = payload.get("take_profit")
        stop_loss = payload.get("stop_loss")
        A_t = payload.get("A_t")
        R_t = payload.get("R_t")
        T_t = payload.get("T_t")
        seed = payload.get("seed")

        if not spot or not legs:
            self._send_json({"error": "Missing required field: spot, legs"}, status=400)
            return

        try:
            job_id = self.server.simulation_manager.submit(
                spot=float(spot),
                legs=legs,
                multiplier=float(multiplier),
                n_paths=max(100, min(100000, n_paths)),
                horizon_days=max(1, min(365, horizon_days)),
                take_profit=float(take_profit) if take_profit is not None else None,
                stop_loss=float(stop_loss) if stop_loss is not None else None,
                A_t=float(A_t) if A_t is not None else None,
                R_t=float(R_t) if R_t is not None else None,
                T_t=float(T_t) if T_t is not None else None,
                seed=int(seed) if seed is not None else None,
            )
            self._send_json({"job_id": job_id, "status": "queued"})
        except (ValueError, SimulationError) as exc:
            self._send_json({"error": str(exc)}, status=400)

    def _handle_simulate_status(self, query: str) -> None:
        """GET /api/simulate — list jobs or get one job's status."""
        params = parse_qs(query)
        job_id = first(params, "job_id", "")
        include_results = truthy(first(params, "results", "0"))

        if job_id:
            try:
                status = self.server.simulation_manager.get_status(job_id)
                if status["status"] == "done" and include_results:
                    result = self.server.simulation_manager.get_result(job_id)
                    status["result"] = result
                self._send_json(status)
            except (KeyError, RuntimeError) as exc:
                self._send_json({"status": "error", "error": str(exc)})
        else:
            jobs = self.server.simulation_manager.list_jobs()
            self._send_json({"jobs": jobs})

    def _handle_ib_prices(self) -> None:
        """POST /api/ib-prices — fetch live IB bid/ask/Greeks for selected legs."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
        except (json.JSONDecodeError, ValueError) as exc:
            self._send_json({"error": str(exc)}, status=400)
            return

        ticker = payload.get("ticker", "")
        legs = payload.get("legs", [])
        if not ticker or not legs:
            self._send_json({"error": "Missing ticker or legs"}, status=400)
            return

        try:
            prices = self.server.service.get_ib_prices(ticker, legs)
            self._send_json({"prices": prices})
        except ChainError as exc:
            self._send_json({"error": str(exc)}, status=502)

    # ── CSFF dispatch ────────────────────────────────────────────────

    def _handle_csff(self, method: str) -> None:
        if _csff is None:
            self._send_json({"error": "csff_unavailable", "detail": "CSFF module not loaded"}, status=503)
            return
        body = None
        if method == "POST":
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        status_code, data, content_type = _csff.dispatch(method, self.path, body)
        if content_type == "application/json":
            self._send_json(data, status=status_code)
        else:
            payload = data.encode("utf-8") if isinstance(data, str) else data
            self.send_response(status_code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
