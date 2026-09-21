"""The weight tree, computed once from the base window and then frozen.

    w_cell = w_route x w_lead|route x w_within|route,lead      sum = 1

MoSPI EG 4.6.2.2 and CPI Manual eq. 9.11 both require EXPENDITURE shares:

    w_b^i = p_b^i q_b^i / sum_k p_b^k q_b^k

The previous implementation used DGCA passenger shares directly, which are
quantity shares (q), not expenditure shares (p*q). On our own data that is not a
rounding difference -- BLR-DEL moves from 9.04% to 14.67% of the basket.

Honest label: our observations are OFFERS, not transactions, so the mean fare
below is an offer-mix mean and not a yield. Call the result a
"passenger-weighted mean-fare expenditure proxy", never "expenditure".

Freezing is what makes this a Young index rather than an accidentally-
chained-weights hybrid: `chain.py` LOADS a weight set and cannot compute one.
"""
import json
import pathlib
import statistics
from typing import Mapping, Sequence

from .config import DEFAULT_LEAD_WEIGHTS, LEAD_TIMES, WEIGHT_SUM_TOLERANCE
from .model import CellKey, Observation

HERE = pathlib.Path(__file__).resolve().parent.parent
BASKET = HERE / "data" / "route_basket.json"
LEAD_WEIGHTS_FILE = HERE / "data" / "lead_weights.json"


def load_lead_weights() -> dict:
    """Lead-time weights, uniform unless a distribution has been supplied.

    Uniform is a DECLARED ASSUMPTION, not a derived distribution, and it is not
    attributed to anyone. ONS collects domestic air fares at a single window
    ("domestic prices are collected one month in advance"); their 10:45:45 split
    is long-haul only and does not map onto a 1-45 day ladder. MoSPI's own spec
    is one window at 21 days.

    A PSD- or DGCA-supplied booking-lag distribution drops into
    apix/data/lead_weights.json without a code change.
    """
    if LEAD_WEIGHTS_FILE.exists():
        raw = json.loads(LEAD_WEIGHTS_FILE.read_text())
        weights = {int(k): float(v) for k, v in raw["weights"].items()}
        if set(weights) != set(LEAD_TIMES):
            raise ValueError(f"lead_weights.json covers {sorted(weights)}, "
                             f"expected {sorted(LEAD_TIMES)}")
        total = sum(weights.values())
        return {k: v / total for k, v in weights.items()}
    return dict(DEFAULT_LEAD_WEIGHTS)


def route_expenditure_weights(base_obs: Sequence[Observation],
                              basket_path: pathlib.Path = BASKET) -> tuple:
    """w_route proportional to (DGCA passengers x base-window mean fare).

    The mean is ARITHMETIC here, deliberately, and geometric in Stage 1. The
    estimands differ: Stage 1 averages price RELATIVES, where the geometric mean
    is correct; this averages money per passenger, where expenditure is a sum of
    arithmetic quantities. Using a geometric mean here would systematically
    understate expenditure on high-dispersion routes.

    Returns (weights, detail) where detail records pax, mean fare and the
    resulting share per route so the weight set is auditable.
    """
    basket = json.loads(basket_path.read_text())
    pax = {(r["origin"], r["destination"]): r["pax_cy"] for r in basket["routes"]}

    fares: dict = {}
    for o in base_obs:
        fares.setdefault((o.item.origin, o.item.destination), []).append(o.total_fare)

    missing = [r for r in pax if r not in fares]
    exposures = {}
    for route, p in pax.items():
        if route not in fares:
            continue            # no fares collected yet on this route
        exposures[route] = p * statistics.fmean(fares[route])

    total = sum(exposures.values())
    if total <= 0:
        raise ValueError("no route exposure; cannot build weights")
    weights = {r: e / total for r, e in exposures.items()}

    detail = {
        "method": "passenger-weighted mean-fare expenditure proxy "
                  "(DGCA CY2025 pax x arithmetic mean observed fare over the base window)",
        "caveat": "observed fares are offers, not transactions; this is an offer-mix "
                  "mean, not a passenger yield",
        "routes": {f"{o}-{d}": {"pax_cy": pax[(o, d)],
                                "mean_fare_base": round(statistics.fmean(fares[(o, d)]), 2),
                                "weight": round(w, 8)}
                   for (o, d), w in sorted(weights.items(), key=lambda kv: -kv[1])},
        "routes_without_fares": [f"{o}-{d}" for o, d in sorted(missing)],
    }
    return weights, detail


def cell_weights(base_obs: Sequence[Observation],
                 route_w: Mapping[tuple, float],
                 lead_w: Mapping[int, float]) -> tuple:
    """Full cell weight tree, normalised so the whole thing sums to 1.

    Within a (route, lead), carrier-band cells are weighted by
    (mean distinct offers per day) x (mean fare) over the base window.

    Offer counts are not passenger counts. The Manual's own cover for this is
    4.67: "if no explicit weights are used ... the sample will be implicitly
    weighted by the number of observations." Making that implicit weighting
    explicit and frozen is strictly better than leaving it implicit and
    time-varying, which is what pooling the items unweighted would do. The
    upgrade path is DGCA carrier-wise capacity, and `method` records which was used.
    """
    per_cell: dict = {}
    days: dict = {}
    for o in base_obs:
        per_cell.setdefault(o.cell, []).append(o.total_fare)
        days.setdefault(o.cell, set()).add(o.obs_date)

    exposure: dict = {}
    for cell, prices in per_cell.items():
        n_days = max(len(days[cell]), 1)
        offers_per_day = len(prices) / n_days
        exposure[cell] = offers_per_day * statistics.fmean(prices)

    weights: dict = {}
    for cell, e in exposure.items():
        route = cell.route
        if route not in route_w:
            continue                      # route carries no weight this vintage
        lead = cell.lead_time_days
        if lead not in lead_w:
            continue
        siblings = [c for c in exposure if c.route == route and c.lead_time_days == lead]
        sib_total = sum(exposure[c] for c in siblings)
        if sib_total <= 0:
            continue
        weights[cell] = route_w[route] * lead_w[lead] * (e / sib_total)

    # A route may be missing some lead windows entirely; renormalise the whole
    # tree once, explicitly, and report the fact rather than hiding it.
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("no weighted cells")
    weights = {c: w / total for c, w in weights.items()}

    assert abs(sum(weights.values()) - 1.0) < WEIGHT_SUM_TOLERANCE
    detail = {
        "method": "offers-per-day x mean fare within (route, lead); CPI Manual 4.67",
        "n_cells": len(weights),
        "normalisation_factor": round(total, 8),
    }
    return weights, detail


def build(base_obs: Sequence[Observation]) -> tuple:
    """Compute the complete frozen weight tree. Returns (cell_weights, provenance)."""
    lead_w = load_lead_weights()
    route_w, route_detail = route_expenditure_weights(base_obs)
    cw, cell_detail = cell_weights(base_obs, route_w, lead_w)
    provenance = {
        "route": route_detail,
        "lead": {"method": "uniform -- a DECLARED ASSUMPTION, not derived, not "
                           "attributed to ONS or MoSPI",
                 "weights": {str(k): v for k, v in sorted(lead_w.items())}},
        "cell": cell_detail,
    }
    return cw, provenance
