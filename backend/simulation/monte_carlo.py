"""Monte Carlo path simulation and option repricing.

Generates correlated paths for S, A, R, T using the exact OU update,
then reprices all legs along each path at each step.
"""

from __future__ import annotations

import numpy as np
from numba import njit

from .ou_process import exact_ou_step
from .ou_process import regime_params_to_tuple
from .params import SimulationParams
from .ssvi import price_legs_along_paths


@njit(cache=True)
def _generate_correlated_paths(
    S0: float,
    A0: float,
    R0: float,
    T0: float,
    regime0: int,
    params_low: tuple[float, ...],
    params_high: tuple[float, ...],
    theta_low: float,
    theta_high: float,
    n_paths: int,
    n_steps: int,
    dt: float,
    r: float,
    seed: int,
) -> np.ndarray:
    """Generate all paths using exact OU + GBM.

    Returns array of shape (n_paths, n_steps + 1, 5):
        [:, :, 0] = S
        [:, :, 1] = A
        [:, :, 2] = R
        [:, :, 3] = T
        [:, :, 4] = regime (0 or 1)
    """
    np.random.seed(seed)
    n_state = n_steps + 1
    paths = np.empty((n_paths, n_state, 5), dtype=np.float64)

    # Initialise
    for p in range(n_paths):
        paths[p, 0, 0] = S0
        paths[p, 0, 1] = A0
        paths[p, 0, 2] = R0
        paths[p, 0, 3] = T0
        paths[p, 0, 4] = regime0

    for step in range(n_steps):
        # Pre-generate all random numbers for this step
        Z = np.random.normal(0.0, 1.0, size=(n_paths, 4))

        for p in range(n_paths):
            S_cur = paths[p, step, 0]
            A_cur = paths[p, step, 1]
            R_cur = paths[p, step, 2]
            T_cur = paths[p, step, 3]
            reg_cur = int(round(paths[p, step, 4]))

            S_nxt, A_nxt, R_nxt, T_nxt, reg_nxt = exact_ou_step(
                S_cur, A_cur, R_cur, T_cur, reg_cur,
                params_low, params_high,
                theta_low, theta_high,
                dt, Z[p], r,
            )

            paths[p, step + 1, 0] = S_nxt
            paths[p, step + 1, 1] = A_nxt
            paths[p, step + 1, 2] = R_nxt
            paths[p, step + 1, 3] = T_nxt
            paths[p, step + 1, 4] = reg_nxt

    return paths


@njit(cache=True)
def _compute_path_pnl(
    prices: np.ndarray,  # (n_paths, n_steps+1, n_legs)
    entry_costs: np.ndarray,  # (n_legs,) entry cost per leg
    qty: np.ndarray,  # (n_legs,) position size
    side: np.ndarray,  # (n_legs,) 0=buy, 1=sell
    multiplier: float,
    management_costs: np.ndarray,  # (n_paths, n_steps+1) cumulative mgmt cost
) -> np.ndarray:
    """Compute cumulative P&L per path at each step.

    P&L is measured relative to initial_prices (SSVI model price at t=0),
    not the trade's actual entry price, so the simulation starts at zero
    P&L regardless of SSVI vs market price mismatch.

    Returns (n_paths, n_steps+1) P&L array.
    """
    n_paths = prices.shape[0]
    n_steps_plus_1 = prices.shape[1]
    n_legs = prices.shape[2]

    pnl = np.zeros((n_paths, n_steps_plus_1), dtype=np.float64)

    for p in range(n_paths):
        cum_pnl = 0.0
        for t in range(n_steps_plus_1):
            step_pnl = 0.0
            for leg_i in range(n_legs):
                price = prices[p, t, leg_i]
                if side[leg_i] == 0:
                    # bought: P&L = current - entry
                    step_pnl += (price - entry_costs[leg_i]) * qty[leg_i] * multiplier
                else:
                    # sold: P&L = entry - current
                    step_pnl += (entry_costs[leg_i] - price) * qty[leg_i] * multiplier
            cum_pnl = step_pnl - management_costs[p, t]
            pnl[p, t] = cum_pnl

    return pnl


def run_simulation(
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
    sigma_S: float = 0.15,
) -> dict:
    """Run the full Monte Carlo simulation.

    Parameters
    ----------
    spot : float
        Current underlying price.
    legs : list of dict
        Strategy legs. Each dict: {strike, right: "C"/"P", side: "buy"/"sell",
        qty, entry, expiry (date string), ...}.
    multiplier : float
        Contract multiplier.
    params : SimulationParams, optional
        Parameter set. Defaults to SPX params.
    n_paths : int
        Number of simulation paths (default 10k).
    horizon_days : int
        Simulation horizon in calendar days (default 60).
    dt_days : int
        Time step in days (default 1).
    take_profit : float, optional
        P&L take-profit target in dollars. Computes TP hit probability.
    stop_loss : float, optional
        P&L stop-loss target in dollars. Computes SL hit probability.
    A_t : float, optional
        ATM IV at 30d. Defaults to 0.20.
    R_t : float, optional
        Skew: 25d put IV - 25d call IV. Defaults to -0.06.
    T_t : float, optional
        Term: IV(60d) - IV(30d). Defaults to 0.02.
    seed : int, optional
        Random seed for reproducibility.
    sigma_S : float
        Instantaneous spot vol for short-expiry IV ramp (default 0.15).

    Returns
    -------
    dict with keys: paths, pnl_distribution, metrics, ...
    """
    if params is None:
        params = SimulationParams()

    if n_paths <= 0:
        from .metrics import _empty_dist
        return {
            "pnl_sample": [],
            "pnl_distribution": _empty_dist(),
            "path_ordering": {
                "max_drawdown_mean": 0.0,
                "max_drawdown_std": 0.0,
                "max_drawdown_max": 0.0,
                "first_touch_up_pct": 0.0,
                "first_touch_down_pct": 0.0,
                "tp_hit_prob": 0.0,
                "sl_hit_prob": 0.0,
            },
            "seed": 0,
            "n_paths": 0,
            "n_steps": 0,
        }

    if seed is None:
        import random
        seed = random.randint(0, 2 ** 31 - 1)

    r = params.risk_free_rate
    dt = dt_days / 365.0
    n_steps = max(1, horizon_days // dt_days)

    params_low = regime_params_to_tuple(params.low_vol)
    params_high = regime_params_to_tuple(params.high_vol)

    S0 = spot
    TAU_30 = 30.0 / 365.0

    if A_t is None:
        # Calibrate A_t from the leg closest to ATM
        from datetime import datetime as _dt, timezone as _tz
        _now = _dt.now(_tz.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        _best_leg, _best_dist = None, float("inf")
        for _l in legs:
            _s = float(_l.get("strike", 0))
            if _s <= 0:
                continue
            _d = abs(_s - S0)
            if _d < _best_dist:
                _best_dist = _d
                _best_leg = _l
        if _best_leg is not None and float(_best_leg.get("iv", 0)) > 0:
            _iv = float(_best_leg["iv"])
            try:
                _ed = _dt.strptime(_best_leg["expiry"], "%Y-%m-%d").replace(tzinfo=_tz.utc)
                _tau = max(1, (_ed - _now).days) / 365.0
            except (ValueError, TypeError):
                _tau = TAU_30
            if _tau >= TAU_30:
                A_t = _iv
            else:
                _frac = _tau / TAU_30
                A_t = sigma_S + (_iv - sigma_S) / max(_frac, 0.01)
            A_t = max(0.05, min(1.0, A_t))
        else:
            A_t = 0.20

    A0 = A_t if A_t is not None else 0.20
    R0 = R_t if R_t is not None else -0.06
    T0 = T_t if T_t is not None else 0.02
    regime0 = 0 if A0 < params.theta_high else 1

    # Generate paths
    paths = _generate_correlated_paths(
        S0, A0, R0, T0, regime0,
        params_low, params_high,
        params.theta_low, params.theta_high,
        n_paths, n_steps, dt, r, seed,
    )

    S_paths = paths[:, :, 0]
    A_paths = paths[:, :, 1]
    R_paths = paths[:, :, 2]
    T_paths = paths[:, :, 3]

    # Prepare leg arrays
    from datetime import datetime, timezone
    from datetime import timedelta

    n_legs = len(legs)
    legs_strike = np.array([float(l["strike"]) for l in legs], dtype=np.float64)
    legs_right = np.array([
        2 if l["right"].upper() == "U" else (0 if l["right"].upper() == "C" else 1)
        for l in legs
    ], dtype=np.int64)
    legs_qty = np.array([int(l["qty"]) for l in legs], dtype=np.float64)
    legs_side = np.array([0 if l["side"] == "buy" else 1 for l in legs], dtype=np.int64)
    legs_entry = np.array([float(l["entry"]) for l in legs], dtype=np.float64)

    # Compute expiry step index for each leg
    now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    legs_expiry_step = np.empty(n_legs, dtype=np.int64)
    for i, leg in enumerate(legs):
        expiry_str = leg.get("expiry", "")
        if not expiry_str or leg.get("right", "").upper() == "U":
            legs_expiry_step[i] = n_steps  # stock leg: lives entire horizon
        else:
            try:
                exp_date = datetime.strptime(expiry_str, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc,
                )
                days_to_expiry = max(0, (exp_date - now).days)
                step = min(n_steps, days_to_expiry // dt_days)
                legs_expiry_step[i] = step
            except (ValueError, TypeError):
                legs_expiry_step[i] = n_steps

    # Price legs at each step
    n_state = n_steps + 1
    prices = np.zeros((n_paths, n_state, n_legs), dtype=np.float64)

    for step in range(n_state):
        prices[:, step, :] = price_legs_along_paths(
            S_paths, A_paths, T_paths,
            legs_strike, legs_right, legs_expiry_step,
            params.ssvi_eta, params.ssvi_gamma, params.ssvi_rho,
            sigma_S, dt, step, n_paths, n_legs,
        )

    # Fix post-expiry: European options lock in intrinsic at expiry,
    # do NOT fluctuate with spot after settlement
    for leg_i in range(n_legs):
        exp_step = int(legs_expiry_step[leg_i])
        for step in range(exp_step + 1, n_state):
            prices[:, step, leg_i] = prices[:, exp_step, leg_i]

    # Management costs (simplified v1: no active management)
    mgmt_costs = np.zeros((n_paths, n_state), dtype=np.float64)

    # Compute P&L relative to SSVI initial price (not trade entry price)
    # This ensures zero P&L at step 0 regardless of SSVI vs market price mismatch
    initial_prices = prices[0, 0, :].copy()
    pnl = _compute_path_pnl(prices, initial_prices, legs_qty, legs_side, multiplier, mgmt_costs)

    # Compute path ordering (caps pnl in-place via TP/SL)
    from .metrics import compute_pnl_distribution
    from .metrics import compute_path_ordering_metrics

    ordering = compute_path_ordering_metrics(
        pnl, n_paths, n_steps,
        take_profit=take_profit,
        stop_loss=stop_loss,
    )

    # Final P&L distribution from (possibly capped) paths
    final_pnl = pnl[:, -1]
    dist = compute_pnl_distribution(final_pnl)

    # Return only summary stats + a small sample of final P&L values
    sample_size = min(500, n_paths)
    step = max(1, n_paths // sample_size)
    pnl_sample = [float(final_pnl[i]) for i in range(0, n_paths, step)]

    return {
        "pnl_sample": pnl_sample[:sample_size],
        "pnl_distribution": dist,
        "path_ordering": ordering,
        "seed": seed,
        "n_paths": n_paths,
        "n_steps": n_steps,
    }
