"""Management rules, event handling, and transaction costs."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any


@dataclass
class MarketEvent:
    """A scheduled market event (e.g. news, data release) that shocks vol.

    Parameters
    ----------
    day_offset : int
        Which day of the simulation to apply the event.
    delta_A : float
        Shock to A_t (ATM IV at 30d) in absolute vol points.
        E.g. 0.05 means A_t increases by 5 vol points.
    beta_R : float
        Skew response coefficient: delta_R = beta_R * delta_A.
        Default from SPX regression: beta_R = -0.35.
    beta_T : float
        Term response coefficient: delta_T = beta_T * delta_A.
        Default from SPX regression: beta_T = -0.10.
    description : str, optional
        Human-readable event label.
    """

    day_offset: int
    delta_A: float
    beta_R: float = -0.35
    beta_T: float = -0.10
    description: str = ""


@dataclass
class ManagementRule:
    """A rule that triggers a management action.

    Parameters
    ----------
    trigger_type : str
        'spot_pct', 'vol_pct', 'pnl_target', 'pnl_stop', 'date'.
    trigger_value : float
        Threshold value for the trigger.
    action : str
        'close_all', 'close_leg', 'roll', 'hedge'.
    target_leg_idx : int, optional
        Leg index to act on. -1 = all.
    """

    trigger_type: str = "pnl_stop"
    trigger_value: float = -0.50  # 50% loss
    action: str = "close_all"
    target_leg_idx: int = -1


def apply_event(
    state: dict[str, float],
    event: MarketEvent,
    regime: int,
) -> dict[str, float]:
    """Apply a scheduled MarketEvent to the volatility state.

    Shocks A_t by delta_A, then applies regression-based shocks
    to R_t and T_t.

    Parameters
    ----------
    state : dict
        Current simulation state with keys A, R, T.
    event : MarketEvent
        The event to apply.
    regime : int
        Current regime (0=low, 1=high).

    Returns
    -------
    dict with updated A, R, T values.
    """
    new_state = dict(state)
    delta_A = event.delta_A

    new_state["A"] = max(0.05, min(1.0, state["A"] + delta_A))
    new_state["R"] = state["R"] + event.beta_R * delta_A
    new_state["T"] = max(0.0, state["T"] + event.beta_T * delta_A)

    return new_state


def compute_transaction_cost(
    qty: float,
    price: float,
    multiplier: float,
    spread_bps: float,
) -> float:
    """Compute transaction cost for a trade.

    cost = abs(qty) * price * multiplier * spread_bps / 10000

    Parameters
    ----------
    qty : float
        Number of contracts (can be fractional).
    price : float
        Option premium per contract.
    multiplier : float
        Contract multiplier.
    spread_bps : float
        Bid-ask spread in basis points.

    Returns
    -------
    float
        Total transaction cost (always non-negative).
    """
    return abs(qty) * price * multiplier * spread_bps / 10000.0


def evaluate_management_rules(
    current_pnl: float,
    initial_net_cost: float,
    current_step: int,
    rules: list[ManagementRule],
    leg_prices: list[float],
    leg_states: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Evaluate management rules and return actions to execute.

    Parameters
    ----------
    current_pnl : float
        Current P&L of the strategy.
    initial_net_cost : float
        Net cost at entry (positive = debit).
    current_step : int
        Current simulation step index.
    rules : list of ManagementRule
        Active rules.
    leg_prices : list of float
        Current prices per leg.
    leg_states : list of dict
        Per-leg state (active, qty remaining, etc.).

    Returns
    -------
    list of dict, each with keys: action, leg_idx, reason.
    """
    actions = []
    for rule in rules:
        triggered = False
        reason = ""

        if rule.trigger_type == "pnl_stop":
            if initial_net_cost != 0:
                loss_pct = current_pnl / abs(initial_net_cost)
                if loss_pct <= rule.trigger_value:
                    triggered = True
                    reason = f"P&L stop at {loss_pct:.1%} (threshold {rule.trigger_value:.1%})"

        elif rule.trigger_type == "pnl_target":
            if initial_net_cost != 0:
                gain_pct = current_pnl / abs(initial_net_cost)
                if gain_pct >= rule.trigger_value:
                    triggered = True
                    reason = f"P&L target at {gain_pct:.1%} (threshold {rule.trigger_value:.1%})"

        if triggered:
            actions.append({
                "action": rule.action,
                "leg_idx": rule.target_leg_idx,
                "reason": reason,
            })

    return actions
