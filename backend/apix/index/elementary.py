"""Stage 1 -- the elementary index.  Jevons, geometric, unweighted.

    I_t = GM_i( p_t^i / p_{t-1}^i ) * I_{t-1}

MoSPI, Expert Group Report on Comprehensive Updation of CPI (Jan 2026):
  4.6.1.1, p. 50 -- derives exactly this from the long-index form, and calls the
  result the "short index" because it needs only the current month's prices, the
  previous month's prices and the previous month's index.
  3.11, p. 14 -- "For compilation of elementary level indices, Jevon's short
  index formula will be used instead of long index method."

IMF/ILO CPI Manual 2020, eq. 9.1:
  "the unweighted geometric mean of the price relatives, which is identical to
  the ratio of the unweighted geometric mean prices."

Both forms are implemented below and a test pins them equal.  That identity is
what makes Jevons transitive (Manual 8.383), which in turn is what lets the
chained short-term index equal the direct fixed-base index -- our free
correctness check.

Nothing in this module does I/O.
"""
import math
from typing import Mapping, Sequence

from .model import CellKey, CellLink, ItemKey, Observation


def geometric_mean(xs: Sequence[float]) -> float:
    """exp(mean(ln x)).  Raises on empty input or any x <= 0.

    It never returns a sentinel: a geometric mean of nothing is not 1.0, and a
    zero price is a data defect that must surface here rather than silently
    zero out a cell.  See config.HARD_MAX_FARE / the ingest guards.
    """
    if not xs:
        raise ValueError("geometric mean of an empty sequence")
    total = 0.0
    for x in xs:
        if not math.isfinite(x) or x <= 0:
            raise ValueError(f"geometric mean requires finite positive values, got {x!r}")
        total += math.log(x)
    return math.exp(total / len(xs))


def jevons_from_relatives(relatives: Sequence[float]) -> float:
    """Jevons as the geometric mean of price relatives -- Manual eq. 9.1, form 1."""
    return geometric_mean(relatives)


def jevons_from_prices(prev: Sequence[float], cur: Sequence[float]) -> float:
    """Jevons as the ratio of geometric mean prices -- Manual eq. 9.1, form 2.

    Present so a test can assert it equals form 1.  Only valid on a MATCHED
    sample, i.e. prev[i] and cur[i] are the same item.
    """
    if len(prev) != len(cur):
        raise ValueError("ratio-of-means form requires a matched sample")
    return geometric_mean(cur) / geometric_mean(prev)


def jevons_link(prev: Mapping[ItemKey, float],
                cur: Mapping[ItemKey, float]) -> tuple:
    """Short-term link for one cell, over items present in BOTH periods.

    Returns (link, n_matched).  Raises ValueError when nothing matches -- the
    caller must decide to impute (impute.py), never default to 1.0.  A silent
    1.0 is carry-forward by another name, and the Manual prohibits that.
    """
    relatives = [cur[k] / prev[k] for k in prev.keys() & cur.keys()]
    if not relatives:
        raise ValueError("no matched items between the two periods")
    return geometric_mean(relatives), len(relatives)


def chain(previous_index: float, link: float) -> float:
    """I_t = link * I_{t-1}.  MoSPI EG 4.6.1.1, final line of the derivation."""
    if previous_index <= 0 or link <= 0:
        raise ValueError("index and link must be positive")
    return previous_index * link


def cell_links(prev_obs: Sequence[Observation],
               cur_obs: Sequence[Observation],
               screened: frozenset = frozenset(),
               thin_threshold: int = 3) -> dict:
    """Build one CellLink per cell that has a matched sample.

    Three populations, handled differently and deliberately:

      matched  (in t-1 and t)  -> enters the link
      entering (in t only)     -> EXCLUDED from the link, but present in the
                                  current sample so it matches at t+1.  A new
                                  item must never generate a price change on
                                  the day it first appears.
      exiting  (in t-1 only)   -> left for impute.py; never silently dropped.

    `screened` holds ItemKeys removed by the outlier screen; they are treated as
    missing, which routes them to imputation and preserves the sample.

    Cells with no matched items are absent from the result -- the caller is
    expected to impute them, and the absence is what triggers that.
    """
    prev_by_cell: dict = {}
    cur_by_cell: dict = {}
    for o in prev_obs:
        if o.item in screened:
            continue
        prev_by_cell.setdefault(o.cell, {})[o.item] = o.total_fare
    for o in cur_obs:
        if o.item in screened:
            continue
        cur_by_cell.setdefault(o.cell, {})[o.item] = o.total_fare

    out: dict = {}
    for cell, prev_items in prev_by_cell.items():
        cur_items = cur_by_cell.get(cell)
        if not cur_items:
            continue
        matched = prev_items.keys() & cur_items.keys()
        if not matched:
            continue
        link, n = jevons_link(prev_items, cur_items)
        n_screened = sum(1 for i in screened
                         if (i.origin, i.destination, i.lead_time_days, i.carrier)
                         == (cell.origin, cell.destination, cell.lead_time_days, cell.carrier))
        out[cell] = CellLink(
            link=link,
            n_matched=n,
            n_prev=len(prev_items),
            n_cur=len(cur_items),
            n_screened=n_screened,
            quality="THIN" if n < thin_threshold else "OK",
        )
    return out
