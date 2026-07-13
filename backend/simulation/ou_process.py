"""Regime-dependent Ornstein-Uhlenbeck process with hysteresis.

The ATM vol (A_t), skew (R_t), and term slope (T_t) each follow a
mean-reverting OU process with regime-dependent parameters.

Regime switching is deterministic based on A_t vs hysteresis thresholds:
  A_t < theta_low  -> low vol regime
  A_t > theta_high -> high vol regime
  theta_low <= A_t <= theta_high -> stay in current regime (hysteresis band)

The spot S follows GBM with regime-dependent sigma_S, correlated with A, R, T.

Exact conditional update used for OU (closed-form, zero discretisation bias):
  X_{t+1} = mu + (X_t - mu) e^{-kappa dt} + eta sqrt((1 - e^{-2 kappa dt}) / (2 kappa)) * Z
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

from .params import RegimeParams


@njit(cache=True)
def _build_cholesky(
    rho_sa: float, rho_sr: float, rho_ar: float,
) -> np.ndarray:
    """Build 4x4 lower-triangular Cholesky factor.

    Variables ordered: [S, A, R, T].
    T is independent (rho = 0 with S, A, R).
    """
    L = np.zeros((4, 4), dtype=np.float64)
    L[0, 0] = 1.0
    L[1, 0] = rho_sa
    L[1, 1] = math.sqrt(max(0.0, 1.0 - rho_sa * rho_sa))
    L[2, 0] = rho_sr
    denom = max(L[1, 1], 1e-12)
    L[2, 1] = (rho_ar - rho_sa * rho_sr) / denom
    L[2, 2] = math.sqrt(max(0.0, 1.0 - L[2, 0] ** 2 - L[2, 1] ** 2))
    L[3, 3] = 1.0
    return L


@njit(cache=True)
def _ou_exact_update(
    x: float, mu: float, kappa: float, eta: float, dt: float, z: float,
) -> float:
    """Exact conditional update for an OU process.

    Returns X_{t+dt} | X_t = x.
    """
    exp_k = math.exp(-kappa * dt)
    mean = mu + (x - mu) * exp_k
    var = (1.0 - exp_k * exp_k) / (2.0 * max(kappa, 1e-12))
    vol = eta * math.sqrt(var)
    return mean + vol * z


@njit(cache=True)
def exact_ou_step(
    S: float,
    A: float,
    R: float,
    T: float,
    regime: int,
    params_low: tuple[float, ...],
    params_high: tuple[float, ...],
    theta_low: float,
    theta_high: float,
    dt: float,
    Z: np.ndarray,
    r: float,
) -> tuple[float, float, float, float, int]:
    """Advance one step of the correlated OU + GBM system.

    Parameters
    ----------
    S, A, R, T : float — current state.
    regime : int — 0=low, 1=high.
    params_low, params_high : 13-tuples (kappa_A, mu_A, eta_A, kappa_R, mu_R,
        eta_R, kappa_T, mu_T, eta_T, sigma_S, rho_SA, rho_SR, rho_AR).
    theta_low, theta_high : float — hysteresis thresholds.
    dt : float — time step in years.
    Z : ndarray (4,) — independent standard normal variates.
    r : float — risk-free rate.

    Returns
    -------
    (S_next, A_next, R_next, T_next, regime_next)
    """
    if regime == 0:
        kap_A, mu_A, eta_A = params_low[0], params_low[1], params_low[2]
        sigma_S = params_low[9]
        rho_SA, rho_SR, rho_AR = params_low[10], params_low[11], params_low[12]
    else:
        kap_A, mu_A, eta_A = params_high[0], params_high[1], params_high[2]
        sigma_S = params_high[9]
        rho_SA, rho_SR, rho_AR = params_high[10], params_high[11], params_high[12]

    L = _build_cholesky(rho_SA, rho_SR, rho_AR)
    corr_Z = L @ Z

    # S: GBM
    S_next = S * math.exp((r - 0.5 * sigma_S * sigma_S) * dt + sigma_S * math.sqrt(dt) * corr_Z[0])

    # A: exact OU, clamped
    A_next = _ou_exact_update(A, mu_A, kap_A, eta_A, dt, corr_Z[1])
    A_next = max(0.05, min(1.0, A_next))

    # Regime hysteresis
    if A_next < theta_low:
        regime_next = 0
    elif A_next > theta_high:
        regime_next = 1
    else:
        regime_next = regime

    # R: exact OU with new regime params
    if regime_next == 0:
        kap_R, mu_R, eta_R = params_low[3], params_low[4], params_low[5]
    else:
        kap_R, mu_R, eta_R = params_high[3], params_high[4], params_high[5]
    R_next = _ou_exact_update(R, mu_R, kap_R, eta_R, dt, corr_Z[2])

    # T: exact OU with new regime params (independent Z)
    if regime_next == 0:
        kap_T, mu_T, eta_T = params_low[6], params_low[7], params_low[8]
    else:
        kap_T, mu_T, eta_T = params_high[6], params_high[7], params_high[8]
    T_next = _ou_exact_update(T, mu_T, kap_T, eta_T, dt, corr_Z[3])

    return S_next, A_next, R_next, T_next, regime_next


def regime_params_to_tuple(params: RegimeParams) -> tuple[float, ...]:
    """Flatten RegimeParams to a 13-tuple for numba."""
    return (
        params.A.kappa, params.A.mu, params.A.eta,
        params.R.kappa, params.R.mu, params.R.eta,
        params.T.kappa, params.T.mu, params.T.eta,
        params.sigma_S,
        params.rho_SA, params.rho_SR, params.rho_AR,
    )


def initial_state(
    spot: float,
    A_t: float | None = None,
    R_t: float | None = None,
    T_t: float | None = None,
    regime: int = 0,
) -> dict[str, float]:
    """Build initial simulation state."""
    return {
        "S": spot,
        "A": A_t if A_t is not None else 0.20,
        "R": R_t if R_t is not None else -0.06,
        "T": T_t if T_t is not None else 0.02,
        "regime": regime,
    }
