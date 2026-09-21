"""Imputation of missing prices.  Carry-forward is prohibited.

MoSPI, Expert Group Report 4.6.4.3, p. 56:
    Imputed Price_t = Price_{t-1} * Avg( Price_t / Price_{t-1} )
disambiguated to a GEOMETRIC mean by their own worked Example 2 (p. 58), where
the imputed price is 83 * 1.0103 = 83.8514.

Their rules, 4.6.4.3:
  - "Imputation should be transparent and rule-based."
  - "Imputation should continue in the subsequent months also if actual prices
    remain unavailable, and replace when actual prices reappear."
  - Not for permanently missing items -- those are replaced via overlap.

IMF/ILO CPI Manual 2020 8.54:
    "carrying forward the last observed price ... In general, to carry forward
    is not an acceptable procedure or solution to the problem."
8.55: imputing by the average change of available prices is numerically
equivalent to omitting the item for that period, but is preferred because the
sample is not depleted when the price returns.

THE CARRY-FORWARD BAN IS STRUCTURAL.  There is no function in this module that
takes a previous price and returns it.  The only entry point multiplies.
"""
from typing import Mapping, Optional, Sequence

from .model import CellKey, CellLink


def impute_price(previous_price: float, link: float) -> float:
    """Imputed price = previous price * the cell's own short-term movement.

    The only way to produce an imputed price in this codebase.  Note there is
    deliberately no `carry_forward(previous_price)` alongside it: a function
    that returned `previous_price` unchanged would implement exactly what the
    Manual prohibits, so it does not exist.
    """
    if previous_price <= 0:
        raise ValueError("previous price must be positive")
    if link <= 0:
        raise ValueError("link must be positive")
    return previous_price * link


def parent_keys(cell: CellKey) -> tuple:
    """Fallback ladder for a cell with no matched items of its own."""
    return (("ROUTE_LEAD", cell.route_lead),
            ("ROUTE", cell.route),
            ("ALL", ()))


def _pool_link(links: Mapping[CellKey, CellLink], level: str, key) -> Optional[float]:
    """Unweighted geometric mean of the observed links in a parent aggregate.

    Only NON-IMPUTED children contribute -- imputing from imputations would
    compound an assumption and hide how far the estimate has drifted from data.
    """
    import math
    vals = []
    for c, cl in links.items():
        if cl.is_imputed:
            continue
        if level == "ROUTE_LEAD" and c.route_lead != key:
            continue
        if level == "ROUTE" and c.route != key:
            continue
        vals.append(math.log(cl.link))
    if not vals:
        return None
    return math.exp(sum(vals) / len(vals))


def impute_missing_cells(links: dict,
                         expected_cells: Sequence[CellKey],
                         run_length: Mapping[CellKey, int],
                         max_consecutive: int) -> tuple:
    """Fill cells that have no matched sample this period.

    Returns (links_with_imputations, dead_cells).  A cell that has been imputed
    for more than `max_consecutive` consecutive periods is declared DEAD and
    returned separately: its weight must be redistributed explicitly by the
    caller and the redistribution recorded, not absorbed here.
    """
    dead = []
    for cell in expected_cells:
        if cell in links:
            continue
        if run_length.get(cell, 0) >= max_consecutive:
            dead.append(cell)
            continue
        imputed = None
        source = None
        for level, key in parent_keys(cell):
            imputed = _pool_link(links, level, key)
            if imputed is not None:
                source = level
                break
        if imputed is None:
            # Nothing anywhere moved this period -- cannot impute from data.
            dead.append(cell)
            continue
        links[cell] = CellLink(
            link=imputed,
            n_matched=0,
            n_prev=0,
            n_cur=0,
            is_imputed=True,
            imputation_source=source,
            imputation_run_len=run_length.get(cell, 0) + 1,
            quality="IMPUTED",
        )
    return links, dead


def redistribute(weights: dict, dead: Sequence[CellKey]) -> tuple:
    """Move a dead cell's weight to its surviving siblings in the same (route, lead).

    Returns (new_weights, adjustments) where adjustments is a list of records to
    be written verbatim into index_run.config_json.  Nothing here is silent.
    """
    weights = dict(weights)
    adjustments = []
    for cell in dead:
        w = weights.pop(cell, 0.0)
        if w <= 0:
            continue
        siblings = [c for c in weights if c.route_lead == cell.route_lead]
        scope = "ROUTE_LEAD"
        if not siblings:
            siblings = [c for c in weights if c.route == cell.route]
            scope = "ROUTE"
        if not siblings:
            siblings = list(weights)
            scope = "ALL"
        if not siblings:
            raise ValueError("every cell is dead; nothing to redistribute onto")
        total = sum(weights[c] for c in siblings)
        for c in siblings:
            weights[c] += w * (weights[c] / total)
        adjustments.append({"dead_cell": list(cell), "weight_moved": w, "scope": scope,
                            "n_recipients": len(siblings)})
    return weights, adjustments
