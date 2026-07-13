"""SSVI Monte Carlo Simulation Engine.

Public API
----------
run_simulation(spot, legs, multiplier, ...) -> dict
    Run the full Monte Carlo simulation and return results.

SimulationManager
    Optional async job manager with ThreadPoolExecutor.
"""

from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .monte_carlo import run_simulation
from .params import DEFAULT_PARAMS
from .params import SimulationParams


class SimulationManager:
    """Manages async simulation jobs using a thread pool.

    Usage:
        manager = SimulationManager(max_workers=2)
        job_id = manager.submit(spot=5300, legs=[...], multiplier=100)
        status = manager.get_status(job_id)  # {"status": "running", ...}
        result = manager.get_result(job_id)  # raises if not done
    """

    def __init__(self, max_workers: int = 2) -> None:
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def submit(
        self,
        spot: float,
        legs: list[dict],
        multiplier: float,
        params: SimulationParams | None = None,
        n_paths: int = 10000,
        horizon_days: int = 60,
        dt_days: int = 1,
        take_profit: float | None = None,
        stop_loss: float | None = None,
        A_t: float | None = None,
        R_t: float | None = None,
        T_t: float | None = None,
        seed: int | None = None,
    ) -> str:
        """Submit a simulation job. Returns job_id immediately."""
        job_id = uuid.uuid4().hex[:16]

        with self._lock:
            self._jobs[job_id] = {
                "status": "queued",
                "progress_pct": 0.0,
                "result": None,
                "error": None,
                "created_at": time.time(),
            }

        future = self._executor.submit(
            self._run_job,
            job_id, spot, legs, multiplier, params,
            n_paths, horizon_days, dt_days,
            take_profit, stop_loss, A_t, R_t, T_t, seed,
        )
        future.add_done_callback(self._on_job_done)

        return job_id

    def get_status(self, job_id: str) -> dict[str, Any]:
        """Get job status without blocking."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return {"status": "not_found"}
            return {
                "status": job["status"],
                "progress_pct": job["progress_pct"],
                "error": job["error"],
            }

    def get_result(self, job_id: str) -> dict[str, Any]:
        """Get job result. Raises KeyError if not found/not done."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(f"Job {job_id} not found")
            result = job.get("result")
            if result is None:
                error = job.get("error")
                if error:
                    raise RuntimeError(error)
                raise RuntimeError(f"Job {job_id} not yet completed (status={job['status']})")
            return result

    def list_jobs(self) -> list[dict[str, Any]]:
        """List all known jobs (status and age only)."""
        now = time.time()
        with self._lock:
            return [
                {
                    "job_id": jid,
                    "status": info["status"],
                    "age_seconds": int(now - info["created_at"]),
                }
                for jid, info in self._jobs.items()
            ]

    def _run_job(
        self,
        job_id: str,
        spot: float,
        legs: list[dict],
        multiplier: float,
        params: SimulationParams | None,
        n_paths: int,
        horizon_days: int,
        dt_days: int,
        take_profit: float | None,
        stop_loss: float | None,
        A_t: float | None,
        R_t: float | None,
        T_t: float | None,
        seed: int | None,
    ) -> dict:
        with self._lock:
            self._jobs[job_id]["status"] = "running"
            self._jobs[job_id]["progress_pct"] = 0.0

        result = run_simulation(
            spot=spot,
            legs=legs,
            multiplier=multiplier,
            params=params or DEFAULT_PARAMS,
            n_paths=n_paths,
            horizon_days=horizon_days,
            dt_days=dt_days,
            take_profit=take_profit,
            stop_loss=stop_loss,
            A_t=A_t,
            R_t=R_t,
            T_t=T_t,
            seed=seed,
        )

        with self._lock:
            self._jobs[job_id]["status"] = "done"
            self._jobs[job_id]["progress_pct"] = 100.0
            self._jobs[job_id]["result"] = result

        return result

    def _on_job_done(self, future: Any) -> None:
        try:
            future.result()
        except Exception as exc:
            # Find the job_id for this future
            for jid, info in list(self._jobs.items()):
                if info["status"] == "running" and info["error"] is None:
                    with self._lock:
                        self._jobs[jid]["status"] = "error"
                        self._jobs[jid]["error"] = str(exc)
                    break


# Convenience public API
def simulate(
    spot: float,
    legs: list[dict],
    multiplier: float,
    params: SimulationParams | None = None,
    n_paths: int = 10000,
    horizon_days: int = 60,
    dt_days: int = 1,
    take_profit: float | None = None,
    stop_loss: float | None = None,
    A_t: float | None = None,
    R_t: float | None = None,
    T_t: float | None = None,
    seed: int | None = None,
) -> dict:
    """Run simulation synchronously and return results."""
    return run_simulation(
        spot=spot,
        legs=legs,
        multiplier=multiplier,
        params=params or DEFAULT_PARAMS,
        n_paths=n_paths,
        horizon_days=horizon_days,
        dt_days=dt_days,
        take_profit=take_profit,
        stop_loss=stop_loss,
        A_t=A_t,
        R_t=R_t,
        T_t=T_t,
        seed=seed,
    )


__all__ = [
    "simulate",
    "SimulationManager",
    "SimulationParams",
    "DEFAULT_PARAMS",
    "run_simulation",
]
