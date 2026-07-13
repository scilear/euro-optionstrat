"""P&L distribution, path ordering metrics, and validation.

All functions are pure Python/numpy (no numba) — called once per simulation,
not in the inner loop. Results are plain Python types, JSON-serializable.
"""

from __future__ import annotations

import math

import numpy as np

from .ssvi import ssvi_total_variance
from .ssvi import _theta_at_tau


def compute_pnl_distribution(final_pnl: np.ndarray) -> dict:
    """Compute full P&L distribution statistics.

    Parameters
    ----------
    final_pnl : ndarray of shape (n_paths,)

    Returns
    -------
    dict with mean, median, std, skew, excess_kurtosis,
    var_95, var_90, var_50, cvar_95, max_profit, max_loss,
    profit_prob, deciles (list of 11 floats).
    """
    n = len(final_pnl)
    if n == 0:
        return _empty_dist()

    mean = float(np.mean(final_pnl))
    std = float(np.std(final_pnl))
    median = float(np.median(final_pnl))

    if std > 0 and n > 2:
        z = (final_pnl - mean) / std
        skew = float(np.mean(z ** 3))
        kurt = float(np.mean(z ** 4) - 3.0)
    else:
        skew = 0.0
        kurt = 0.0

    var_95 = float(np.percentile(final_pnl, 5))
    var_90 = float(np.percentile(final_pnl, 10))
    var_50 = float(np.percentile(final_pnl, 50))

    tail_mask = final_pnl <= var_95
    cvar_95 = float(np.mean(final_pnl[tail_mask])) if tail_mask.any() else var_95

    max_profit = float(np.max(final_pnl))
    max_loss = float(np.min(final_pnl))
    profit_prob = float(np.mean(final_pnl > 0))

    deciles = [float(v) for v in np.percentile(final_pnl, range(0, 101, 10))]

    return {
        "mean": mean,
        "median": median,
        "std": std,
        "skew": round(skew, 4),
        "excess_kurtosis": round(kurt, 4),
        "var_95": var_95,
        "var_90": var_90,
        "var_50": var_50,
        "cvar_95": cvar_95,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "profit_prob": round(profit_prob, 4),
        "deciles": deciles,
    }


def _empty_dist() -> dict:
    return {
        "mean": 0.0,
        "median": 0.0,
        "std": 0.0,
        "skew": 0.0,
        "excess_kurtosis": 0.0,
        "var_95": 0.0,
        "var_90": 0.0,
        "var_50": 0.0,
        "cvar_95": 0.0,
        "max_profit": 0.0,
        "max_loss": 0.0,
        "profit_prob": 0.0,
        "deciles": [0.0] * 11,
    }


def compute_path_ordering_metrics(
    pnl: np.ndarray,
    n_paths: int,
    n_steps: int,
    take_profit: float | None = None,
    stop_loss: float | None = None,
) -> dict:
    """Compute path ordering / first-touch metrics.

    Parameters
    ----------
    pnl : ndarray, shape (n_paths, n_steps+1)
        Cumulative P&L at each step.
    n_paths : int
    n_steps : int
    take_profit : float, optional
        P&L target for take-profit in dollars.
    stop_loss : float, optional
        P&L target for stop-loss in dollars.

    Returns
    -------
    dict with max_drawdown stats, first_touch percentages, and tp/sl hit probs.
    """
    if n_paths == 0:
        return {
            "max_drawdown_mean": 0.0,
            "max_drawdown_std": 0.0,
            "max_drawdown_max": 0.0,
            "first_touch_up_pct": 0.0,
            "first_touch_down_pct": 0.0,
            "tp_hit_prob": 0.0,
            "sl_hit_prob": 0.0,
        }

    max_dd_values = np.empty(n_paths, dtype=np.float64)
    ups = 0
    downs = 0

    # TP/SL tracking
    has_tp = take_profit is not None and math.isfinite(take_profit)
    has_sl = stop_loss is not None and math.isfinite(stop_loss)
    has_tp_sl = has_tp or has_sl
    tp_hits = 0
    sl_hits = 0

    for p in range(n_paths):
        path = pnl[p, :]
        peak = path[0]
        max_dd = 0.0
        touched_target = False
        touched_stop = False
        final_val = path[n_steps]

        tp_hit = False
        sl_hit = False

        for t in range(1, n_steps + 1):
            val = path[t]

            # TP/SL first-touch check AND cap
            if has_tp_sl and not tp_hit and not sl_hit:
                if has_tp and has_sl and take_profit > stop_loss:
                    if val >= take_profit:
                        tp_hit = True
                    elif val <= stop_loss:
                        sl_hit = True
                else:
                    if has_tp and val >= take_profit:
                        tp_hit = True
                    if has_sl and val <= stop_loss:
                        sl_hit = True

            if tp_hit:
                pnl[p, t] = take_profit
                val = take_profit
                peak = max(peak, take_profit)
                final_val = take_profit
            elif sl_hit:
                pnl[p, t] = stop_loss
                val = stop_loss
                final_val = stop_loss
            else:
                if val > peak:
                    peak = val

            denom = max(abs(peak), 1.0)
            dd = (peak - val) / denom
            if dd > max_dd:
                max_dd = dd

            if not touched_target and final_val > 0 and val >= final_val * 1.5:
                touched_target = True
            if not touched_stop and final_val < 0 and abs(val) >= abs(final_val) * 1.5:
                touched_stop = True

        max_dd_values[p] = max_dd

        if touched_target and not touched_stop:
            ups += 1
        elif touched_stop and not touched_target:
            downs += 1

        if tp_hit:
            tp_hits += 1
        if sl_hit:
            sl_hits += 1

    result = {
        "max_drawdown_mean": float(np.mean(max_dd_values)),
        "max_drawdown_std": float(np.std(max_dd_values)),
        "max_drawdown_max": float(np.max(max_dd_values)),
        "first_touch_up_pct": round(ups / max(n_paths, 1) * 100, 2),
        "first_touch_down_pct": round(downs / max(n_paths, 1) * 100, 2),
    }

    if has_tp:
        result["tp_hit_prob"] = round(tp_hits / n_paths, 4)
    else:
        result["tp_hit_prob"] = 0.0
    if has_sl:
        result["sl_hit_prob"] = round(sl_hits / n_paths, 4)
    else:
        result["sl_hit_prob"] = 0.0

    return result


def count_arb_violations(
    A_paths: np.ndarray,
    T_paths: np.ndarray,
    eta: float,
    gamma: float,
    rho: float,
    sigma_S: float,
) -> dict:
    """Count SSVI arbitrage violations along simulation paths."""
    n_paths = A_paths.shape[0]
    n_steps_plus_1 = A_paths.shape[1]

    butterfly_violations = 0
    calendar_violations = 0
    n_checks = 0

    tau_short = 10.0 / 365.0
    tau_long = 30.0 / 365.0
    k_atm = 0.0
    k_otm = 0.04

    max_p = min(n_paths, 500)
    max_t = min(n_steps_plus_1, 30)

    for p in range(max_p):
        for t in range(max_t):
            A_t = float(A_paths[p, t])
            T_t = float(T_paths[p, t])

            theta_s = _theta_at_tau(A_t, T_t, tau_short, sigma_S)
            theta_l = _theta_at_tau(A_t, T_t, tau_long, sigma_S)

            w_short_atm = ssvi_total_variance(k_atm, theta_s, rho, eta, gamma)
            w_short_otm = ssvi_total_variance(k_otm, theta_s, rho, eta, gamma)
            w_long_atm = ssvi_total_variance(k_atm, theta_l, rho, eta, gamma)
            w_long_otm = ssvi_total_variance(k_otm, theta_l, rho, eta, gamma)

            if w_short_otm < w_short_atm - 0.001:
                butterfly_violations += 1
            if w_long_otm < w_long_atm - 0.001:
                butterfly_violations += 1
            if w_short_atm > w_long_atm + 0.001:
                calendar_violations += 1

            n_checks += 1

    return {
        "n_checks": n_checks,
        "butterfly_violations": butterfly_violations,
        "calendar_violations": calendar_violations,
        "violation_pct": round(
            (butterfly_violations + calendar_violations) / max(n_checks, 1) * 100, 2,
        ),
    }
