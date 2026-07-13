"""Default parameter sets for the SSVI simulation engine."""

from dataclasses import dataclass
from dataclasses import field


@dataclass(frozen=True)
class RegimeOUParams:
    """OU process parameters for one regime."""

    kappa: float = 15.0       # mean reversion speed
    mu: float = 0.16           # long-run mean
    eta: float = 0.40          # vol of vol (OU noise scale)


@dataclass(frozen=True)
class RegimeParams:
    """Full parameter set for one regime."""

    A: RegimeOUParams = field(default_factory=lambda: RegimeOUParams())
    R: RegimeOUParams = field(default_factory=lambda: RegimeOUParams(
        kappa=12.0, mu=-0.06, eta=0.20,
    ))
    T: RegimeOUParams = field(default_factory=lambda: RegimeOUParams(
        kappa=10.0, mu=0.02, eta=0.15,
    ))
    sigma_S: float = 0.15      # spot vol (GBM diffusion)
    rho_SA: float = -0.70      # spot vs ATM vol correlation
    rho_SR: float = 0.30       # spot vs skew correlation
    rho_AR: float = -0.50      # ATM vol vs skew correlation
    # T is independent of S, A, R (all ρ = 0)


_LOW_VOL_REGIME = RegimeParams(
    A=RegimeOUParams(kappa=15.0, mu=0.16, eta=0.40),
    R=RegimeOUParams(kappa=12.0, mu=-0.06, eta=0.20),
    T=RegimeOUParams(kappa=10.0, mu=0.02, eta=0.15),
    sigma_S=0.15,
    rho_SA=-0.70,
    rho_SR=0.30,
    rho_AR=-0.50,
)

_HIGH_VOL_REGIME = RegimeParams(
    A=RegimeOUParams(kappa=25.0, mu=0.32, eta=0.60),
    R=RegimeOUParams(kappa=20.0, mu=-0.12, eta=0.30),
    T=RegimeOUParams(kappa=15.0, mu=0.04, eta=0.20),
    sigma_S=0.30,
    rho_SA=-0.80,
    rho_SR=0.40,
    rho_AR=-0.60,
)


@dataclass(frozen=True)
class SimulationParams:
    """Top-level simulation parameter container."""

    low_vol: RegimeParams = _LOW_VOL_REGIME
    high_vol: RegimeParams = _HIGH_VOL_REGIME
    theta_low: float = 0.18    # A_t below this → low vol regime
    theta_high: float = 0.22   # A_t above this → high vol regime
    ssvi_eta: float = 2.0      # SSVI η parameter
    ssvi_gamma: float = 0.5    # SSVI γ parameter
    ssvi_rho: float = -0.7     # SSVI ρ (skew parameter, constant across expiries)
    risk_free_rate: float = 0.03
    spread_bps: float = 0.0    # transaction cost in bps (default 0)
    # Event regression defaults (SPX)
    beta_R: float = -0.35      # skew response: ΔR = β_R × ΔA
    beta_T: float = -0.10      # term response: ΔT = β_T × ΔA


# Public singleton
DEFAULT_PARAMS = SimulationParams()
