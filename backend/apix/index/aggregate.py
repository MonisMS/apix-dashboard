"""Stage 2 -- higher-level aggregation.  Young, arithmetic, weighted.

    I = sum_j ( w_j * I_j )      with   sum_j w_j = 1

MoSPI, Expert Group Report (Jan 2026):
  4.6.2.4, p. 53 -- "higher-level CPI indices are compiled as the weighted
  ARITHMETIC mean of item-level indices, using expenditure shares as weights",
  given as   Combined Index = (w1*I1 + w2*I2) / (w1 + w2).
  4.6.2.2 -- Young's Index = sum w_b^i (p_t^i / p_0^i), where
  w_b^i = p_b^i q_b^i / sum_k p_b^k q_b^k, i.e. an EXPENDITURE share.

IMF/ILO CPI Manual 2020, eq. 9.11:
  P^{0:t} = sum_j w_j^b * P_j^{0:t},  sum w = 1.
  "If the period b weights are used directly in the index as expenditure shares
  in period 0, the index is known a Young index."

This is the stage the previous implementation got wrong: it collapsed both
stages into one weighted GEOMETRIC mean.  Geometric <= arithmetic always, so the
error was systematic rather than noise -- measured at 96.143 against a correct
96.309 on 11 Sep 2026.

Nothing in this module does I/O.
"""
from typing import Mapping

from .config import WEIGHT_SUM_TOLERANCE
from .model import CellKey, CellLink


def young_level(cell_levels: Mapping[CellKey, float],
                weights: Mapping[CellKey, float],
                tolerance: float = WEIGHT_SUM_TOLERANCE) -> float:
    """Weighted ARITHMETIC mean of index levels.

    Asserts the weights sum to 1 and refuses to renormalise silently.  The old
    implementation divided by whatever weight happened to match that day, which
    quietly changed the weight base every day -- an undeclared imputation.  Any
    redistribution must be done explicitly, upstream, and recorded.
    """
    if not cell_levels:
        raise ValueError("no cell levels to aggregate")
    total_w = 0.0
    acc = 0.0
    for cell, level in cell_levels.items():
        w = weights.get(cell)
        if w is None:
            raise KeyError(f"no weight for cell {cell!r}; "
                           "unweighted cells must be excluded explicitly, not defaulted")
        if level <= 0:
            raise ValueError(f"non-positive index level for {cell!r}: {level}")
        acc += w * level
        total_w += w
    if abs(total_w - 1.0) > tolerance:
        raise ValueError(
            f"weights sum to {total_w!r}, not 1.0 (tolerance {tolerance}). "
            "Redistribute explicitly and record it; never renormalise here.")
    return acc


def young_step(prev_levels: Mapping[CellKey, float],
               links: Mapping[CellKey, CellLink],
               weights: Mapping[CellKey, float]) -> tuple:
    """Advance every cell by its own link, then aggregate.  Returns (level, new_levels).

    This is aggregate-then-chain.  CPI Manual 8.113 says chain-then-aggregate
    gives an identical answer; we implement this order because it makes each
    cell's own index level a first-class, storable number, which is what the
    route drill-down needs.  test_aggregate.py pins the two orders equal.
    """
    new_levels = {}
    for cell, prev in prev_levels.items():
        link = links.get(cell)
        if link is None:
            raise KeyError(f"no link for cell {cell!r}; impute it before aggregating")
        new_levels[cell] = prev * link.link
    return young_level(new_levels, weights), new_levels


def aggregate_subset(cell_levels: Mapping[CellKey, float],
                     weights: Mapping[CellKey, float],
                     predicate) -> tuple:
    """Sub-index over the cells matching `predicate`, weights renormalised within.

    Returns (level, share_of_total_weight).  The share must be published
    alongside: a sub-index built this way does NOT aggregate back to the
    headline unless the subset partitions the basket, and saying so is better
    than letting someone discover it.
    """
    subset = {c: l for c, l in cell_levels.items() if predicate(c)}
    if not subset:
        raise ValueError("predicate matched no cells")
    share = sum(weights[c] for c in subset)
    if share <= 0:
        raise ValueError("subset carries zero weight")
    renormalised = {c: weights[c] / share for c in subset}
    return young_level(subset, renormalised), share
