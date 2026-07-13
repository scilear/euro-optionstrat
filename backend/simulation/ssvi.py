"""SSVI surface parameterisation, pricing, and calibration.

References
----------
Gatheral, J. & Jacquier, A. (2014). Arbitrage-free SVI volatility surfaces.
Quantitative Finance, 14(1), 59-71.

Uses the SSVI form: w(k, τ) = θ_τ ⋅ (1 + ρ⋅φ(θ_τ)⋅k + √((φ(θ_τ)⋅k + ρ)² + (1-ρ²))) / 2
where φ(θ) = η / θ^γ.

NOTE: SSVI with constant ρ across expiries is a v1 simplification.
Real markets exhibit a term structure of skew (ρ varies with τ).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit


@njit(cache=True)
def _ncdf(x: float) -> float:
    """Standard normal CDF via error function (numba-compatible)."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


@njit(cache=True)
def _bs_price(
    spot: float, strike: float, t_years: float,
    vol: float, right: int,
) -> float:
    """Black-Scholes price, numba-compatible.

    Parameters
    ----------
    spot, strike : float
    t_years : float
        Time to expiry in years.
    vol : float
        Annualised implied volatility.
    right : int
        0 = call, 1 = put.

    Returns
    -------
    float
        Option premium.
    """
    rate = 0.03
    if t_years <= 0 or vol <= 0:
        if right == 0:
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)
    vol_sqrt = vol * math.sqrt(t_years)
    if vol_sqrt <= 0:
        return 0.0
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol * vol) * t_years) / vol_sqrt
    d2 = d1 - vol_sqrt
    discount = math.exp(-rate * t_years)
    if right == 0:
        return max(0.0, spot * _ncdf(d1) - strike * discount * _ncdf(d2))
    return max(0.0, strike * discount * _ncdf(-d2) - spot * _ncdf(-d1))


@njit(cache=True)
def _bs_iv(price: float, spot: float, strike: float, t_years: float, right: int) -> float:
    """Invert Black-Scholes for implied volatility (bisection, numba-compatible)."""
    if t_years <= 0 or price <= 0:
        return 0.0
    intrinsic = max(0.0, spot - strike) if right == 0 else max(0.0, strike - spot)
    if price <= intrinsic + 1e-12:
        return 0.001
    lo, hi = 0.001, 3.0
    for _ in range(64):
        mid = (lo + hi) / 2
        p = _bs_price(spot, strike, t_years, mid, right)
        if p > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


@njit(cache=True)
def ssvi_total_variance(
    k: float, theta: float, rho: float, eta: float, gamma: float,
) -> float:
    """SSVI total variance w(k, τ) for a single (k, θ) pair.

    Parameters
    ----------
    k : float
        Log-moneyness = ln(K/S).
    theta : float
        ATM total variance = σ_ATM²(τ) × τ.
    rho, eta, gamma : float
        SSVI parameters.

    Returns
    -------
    float
        Total variance w(k, τ).
    """
    if theta <= 0:
        return 0.0
    phi = eta / (theta ** gamma)
    sqrt_term = math.sqrt((phi * k + rho) ** 2 + (1 - rho * rho))
    return 0.5 * theta * (1 + rho * phi * k + sqrt_term)


@njit(cache=True)
def ssvi_iv(
    k: float, tau: float, theta: float,
    rho: float, eta: float, gamma: float,
) -> float:
    """SSVI implied volatility for a single (k, τ) pair.

    Returns
    -------
    float
        Annualised implied volatility.
    """
    if tau <= 0:
        return 0.0
    w = ssvi_total_variance(k, theta, rho, eta, gamma)
    if w <= 0:
        return 0.0
    return math.sqrt(w / tau)


@njit(cache=True)
def _theta_at_tau(
    A_t: float, T_t: float, tau: float,
    sigma_S: float = 0.15,
) -> float:
    """ATM total variance θ(τ) from A_t (30d IV) and T_t (60d-30d IV spread).

    IV(30d) = A_t
    IV(60d) = A_t + T_t
    For τ < 30d: IV linearly ramps from sigma_S at τ=0 to A_t at 30d.
    For 30d ≤ τ ≤ 60d: IV linearly interpolated.
    For τ > 60d: IV flat at IV(60d).

    Returns θ(τ) = IV(τ)² × τ.
    """
    TAU_30 = 30.0 / 365.0
    TAU_60 = 60.0 / 365.0

    if tau <= 0:
        return 0.0

    iv_30d = max(A_t, 0.01)
    iv_60d = max(A_t + T_t, 0.01)

    if tau <= TAU_30:
        # Ramp from sigma_S to A_t
        frac = tau / TAU_30
        iv = sigma_S + (iv_30d - sigma_S) * frac
    elif tau <= TAU_60:
        # Linear between 30d and 60d IV
        frac = (tau - TAU_30) / (TAU_60 - TAU_30)
        iv = iv_30d + (iv_60d - iv_30d) * frac
    else:
        # Flat after 60d
        iv = iv_60d

    iv = max(iv, 0.005)
    return iv * iv * tau


@njit(cache=True)
def option_price_ssvi(
    spot: float, strike: float, tau: float,
    right: int,
    A_t: float, T_t: float,
    eta: float, gamma: float, rho: float,
    sigma_S: float = 0.15,
) -> float:
    """Price a European option under the SSVI surface.

    Parameters
    ----------
    spot, strike : float
    tau : float
        Time to expiry in years.
    right : int
        0 = call, 1 = put.
    A_t : float
        ATM implied volatility at 30d.
    T_t : float
        Term structure: IV(60d) - IV(30d).
    eta, gamma, rho : float
        SSVI parameters.
    sigma_S : float
        Instantaneous spot vol (used for short-expiry IV ramp).

    Returns
    -------
    float
        Option premium.
    """
    if tau <= 0:
        if right == 0:
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)

    theta = _theta_at_tau(A_t, T_t, tau, sigma_S)
    if theta <= 0:
        if right == 0:
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)

    k = math.log(strike / spot) if spot > 0 and strike > 0 else 0.0
    vol = ssvi_iv(k, tau, theta, rho, eta, gamma)
    return _bs_price(spot, strike, tau, vol, right)


# --- Vectorised / array versions for simulation loops ---

@njit(cache=True)
def ssvi_iv_array(
    k: np.ndarray, tau: float, theta: float,
    rho: float, eta: float, gamma: float,
) -> np.ndarray:
    """Vectorised SSVI IV for multiple k values at one expiry."""
    n = len(k)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        out[i] = ssvi_iv(k[i], tau, theta, rho, eta, gamma)
    return out


@njit(cache=True)
def price_legs_along_paths(
    S_paths: np.ndarray,          # (n_paths, n_steps+1)
    A_paths: np.ndarray,          # (n_paths, n_steps+1)
    T_paths: np.ndarray,          # (n_paths, n_steps+1)
    legs_strike: np.ndarray,      # (n_legs,) strikes
    legs_right: np.ndarray,       # (n_legs,) 0=C, 1=P, 2=stock
    legs_expiry_step: np.ndarray, # (n_legs,) expiry step index
    eta: float,
    gamma: float,
    rho: float,
    sigma_S: float,
    dt: float,
    current_step: int,
    n_paths: int,
    n_legs: int,
) -> np.ndarray:
    """Price all legs at one simulation step for all paths.

    right encoding: 0=Call, 1=Put, 2=Stock.
    Stock legs just return the spot price (not an option price).

    Returns
    -------
    np.ndarray of shape (n_paths, n_legs) with current market values.
    """
    if current_step < 0:
        return np.zeros((n_paths, n_legs), dtype=np.float64)

    result = np.empty((n_paths, n_legs), dtype=np.float64)

    for leg_idx in range(n_legs):
        strike = legs_strike[leg_idx]
        right = legs_right[leg_idx]
        expiry_step = legs_expiry_step[leg_idx]
        steps_left = max(0, expiry_step - current_step)
        tau = steps_left * dt
        is_stock = right == 2

        for path_idx in range(n_paths):
            S = S_paths[path_idx, current_step]
            if S <= 0:
                result[path_idx, leg_idx] = 0.0
                continue

            if is_stock:
                # Stock leg: current market value = spot price
                result[path_idx, leg_idx] = S
                continue

            if tau <= 0:
                # Expired → intrinsic
                if right == 0:
                    result[path_idx, leg_idx] = max(0.0, S - strike)
                else:
                    result[path_idx, leg_idx] = max(0.0, strike - S)
                continue

            A_t = A_paths[path_idx, current_step]
            T_t = T_paths[path_idx, current_step]
            result[path_idx, leg_idx] = option_price_ssvi(
                S, strike, tau, right, A_t, T_t, eta, gamma, rho, sigma_S,
            )
    return result


# --- Calibration (scipy, not numba) ---

def calibrate_ssvi(
    strikes: np.ndarray,
    ivs: np.ndarray,
    spot: float,
    initial_guess: tuple[float, float, float] | None = None,
) -> dict[str, float]:
    """Fit SSVI parameters (η, γ, ρ) to a cross-sectional IV smile.

    Parameters
    ----------
    strikes : np.ndarray
        Option strikes.
    ivs : np.ndarray
        Observed implied volatilities.
    spot : float
        Current underlying price.
    initial_guess : tuple, optional
        (eta, gamma, rho) starting point. Defaults to (2.0, 0.5, -0.7).

    Returns
    -------
    dict with keys 'eta', 'gamma', 'rho'.
    """
    from scipy.optimize import least_squares

    if initial_guess is None:
        eta0, gamma0, rho0 = 2.0, 0.5, -0.7
    else:
        eta0, gamma0, rho0 = initial_guess

    # Infer theta from ATM IV (nearest to spot)
    atm_idx = np.argmin(np.abs(strikes - spot))
    theta = ivs[atm_idx] ** 2 * (30 / 365)  # rough estimate at 30d

    k = np.log(strikes / spot)

    def residuals(params):
        eta, gamma, rho = params
        w_fit = np.array([
            ssvi_total_variance(ki, theta, rho, eta, gamma) for ki in k
        ])
        iv_fit = np.sqrt(np.maximum(w_fit, 1e-12) / (30 / 365))
        return iv_fit - ivs

    bounds = (
        [0.1, 0.01, -0.99],
        [10.0, 1.0, 0.99],
    )

    result = least_squares(residuals, [eta0, gamma0, rho0], bounds=bounds)

    return {
        "eta": float(result.x[0]),
        "gamma": float(result.x[1]),
        "rho": float(result.x[2]),
    }
