"""Chaining, the reference window, and re-referencing without revising history.

The immutable object is the LINK. A level is a view: level = factor x product of
links. That is what lets the base window grow from three days to twenty-eight
without revising a single historical number -- re-referencing produces a new
vintage with a new factor, and every link stays exactly as it was published.

Three periods, named separately because conflating them is the usual source of
confusion (IMF TA Recommendation 1 makes the same point about the word "base"):

  weight reference   b : DGCA CY2025 passengers x base-window mean fares
  price reference    0 : the base window
  index reference      : the base window, where the series equals 100
"""
import math
import statistics
from typing import Mapping, NamedTuple, Sequence

from .aggregate import young_level
from .config import (PROVISIONAL_IMPUTED_WEIGHT, PROVISIONAL_WINDOW_MIN_DAYS,
                     REFUSE_IMPUTED_WEIGHT, THIN_CELL_THRESHOLD)
from .elementary import cell_links
from .impute import impute_missing_cells, redistribute
from .model import CellKey, CellLink, Point
from .repro import point_digest


class DayResult(NamedTuple):
    date: str
    raw_level: float
    link: float
    cell_levels: dict
    links: dict
    n_cells: int
    n_imputed: int
    n_thin: int
    n_dead: int
    n_items_matched: int
    n_items_prev: int
    n_items_screened: int
    weight_imputed: float
    adjustments: list
    # The weight map actually in force on this day. Identical to the frozen set
    # until a cell is retired, after which redistribution changes it. Carrying it
    # per day is what lets a sub-series renormalise against the right shares
    # instead of stale ones.
    weights: dict = {}


def build_raw_series(obs_by_day: Mapping[str, Sequence],
                     weights: Mapping[CellKey, float],
                     screened: Mapping[str, frozenset] = None,
                     max_consecutive: int = 5,
                     thin_threshold: int = THIN_CELL_THRESHOLD) -> list:
    """Chain the whole panel. Returns [DayResult], anchored at 100 on day 1.

    The anchor is arbitrary and internal; `reference_factor` moves it to the
    published base afterwards.
    """
    screened = screened or {}
    days = sorted(obs_by_day)
    if len(days) < 2:
        raise ValueError("need at least two collection days to form a link")

    expected = list(weights)
    cell_levels = {c: 100.0 for c in expected}
    run_length: dict = {}
    out = [DayResult(days[0], 100.0, 1.0, dict(cell_levels), {}, len(expected),
                     0, 0, 0, 0, 0, 0, 0.0, [], dict(weights))]

    live_weights = dict(weights)
    for prev_day, day in zip(days, days[1:]):
        links = cell_links(obs_by_day[prev_day], obs_by_day[day],
                           screened=screened.get(day, frozenset()),
                           thin_threshold=thin_threshold)
        # Only cells that carry weight participate; a cell observed today but
        # absent from the frozen weight set is tracked with weight 0 and gains
        # weight at the next rebasing. That is the standard CPI answer.
        links = {c: l for c, l in links.items() if c in live_weights}

        links, dead = impute_missing_cells(links, list(live_weights), run_length,
                                           max_consecutive)
        for c in list(live_weights):
            if c in links and links[c].is_imputed:
                run_length[c] = run_length.get(c, 0) + 1
            elif c in links:
                run_length[c] = 0

        adjustments = []
        if dead:
            live_weights, adjustments = redistribute(live_weights, dead)
            for c in dead:
                cell_levels.pop(c, None)
                run_length.pop(c, None)

        new_levels = {}
        for c in live_weights:
            link = links.get(c)
            if link is None:
                raise KeyError(f"cell {c!r} has neither observation nor imputation")
            new_levels[c] = cell_levels[c] * link.link

        level = young_level(new_levels, live_weights)
        prev_level = out[-1].raw_level
        w_imputed = sum(live_weights[c] for c in live_weights
                        if links[c].is_imputed)

        out.append(DayResult(
            date=day,
            raw_level=level,
            link=level / prev_level,
            cell_levels=dict(new_levels),
            links=links,
            n_cells=len(live_weights),
            n_imputed=sum(1 for c in live_weights if links[c].is_imputed),
            n_thin=sum(1 for c in live_weights if links[c].quality == "THIN"),
            n_dead=len(dead),
            n_items_matched=sum(l.n_matched for l in links.values()),
            n_items_prev=sum(l.n_prev for l in links.values()),
            n_items_screened=len(screened.get(day, ())),
            weight_imputed=w_imputed,
            adjustments=adjustments,
            weights=dict(live_weights),
        ))
        cell_levels = new_levels
    return out


def reference_factor(days: Sequence[DayResult], window: Sequence[str]) -> float:
    """100 / mean raw level over the reference window.

    The base is a WINDOW, not a day, so one unusual day cannot anchor the whole
    series. With three collection days the window is all three.
    """
    levels = [d.raw_level for d in days if d.date in window]
    if not levels:
        raise ValueError("reference window matched no collection days")
    return 100.0 / statistics.fmean(levels)


def reference_label(window: Sequence[str], provisional: bool) -> str:
    """The string that must appear on every export, axis and API response.

    Never "2026=100". Never a bare "= 100". A reader must be able to see at a
    glance that this is a three-day provisional reference, not a CPI base year.
    """
    w = sorted(window)
    span = w[0] if len(w) == 1 else f"{w[0]} to {w[-1]}"
    tail = ", provisional reference window" if provisional else ""
    return f"APIx ({span} average = 100{tail})"


def to_points(days: Sequence[DayResult], factor: float,
              series_id: str = "APIX.ALL") -> list:
    """Apply the reference factor and emit published points."""
    points = []
    for i, d in enumerate(days):
        w_imp = d.weight_imputed
        quality = []
        if w_imp > REFUSE_IMPUTED_WEIGHT:
            raise ValueError(
                f"{d.date}: {w_imp:.1%} of weight is imputed, above the "
                f"{REFUSE_IMPUTED_WEIGHT:.0%} refusal threshold. An index computed "
                "mostly from imputations is a forecast; it will not be published.")
        provisional = True          # every point is provisional at 3 days
        if w_imp > PROVISIONAL_IMPUTED_WEIGHT:
            quality.append(f"IMPUTED_WEIGHT_{w_imp:.0%}")
        if d.n_dead:
            quality.append(f"CELLS_RETIRED_{d.n_dead}")
        if i == 0:
            quality.append("ANCHOR")
        quality.append("BASE_WINDOW_PROVISIONAL")

        points.append(Point(
            series_id=series_id, freq="D",
            period_start=d.date, period_end=d.date,
            level=round(d.raw_level * factor, 4),
            link=None if i == 0 else round(d.link, 8),
            n_cells=d.n_cells, n_cells_imputed=d.n_imputed,
            n_cells_thin=d.n_thin, n_cells_dead=d.n_dead,
            n_items_matched=d.n_items_matched, n_items_prev=d.n_items_prev,
            n_items_screened=d.n_items_screened,
            weight_covered=1.0, weight_imputed=round(w_imp, 6),
            n_days=1, is_provisional=provisional, quality=tuple(quality),
            repro_hash=point_digest(d.date, series_id, "D", factor,
                                    d.links, d.weights or {}),
        ))
    return points


def direct_index(obs_by_day: Mapping[str, Sequence],
                 weights: Mapping[CellKey, float]) -> float:
    """Fixed-base index from first to last day, ignoring intermediate days.

    Jevons is transitive (Manual 8.383), so on a constant sample this must equal
    the chained series exactly. Any difference IS our chain drift, and it is
    attributable entirely to sample churn. audit.py reports it.
    """
    days = sorted(obs_by_day)
    links = cell_links(obs_by_day[days[0]], obs_by_day[days[-1]])
    common = {c: l for c, l in links.items() if c in weights}
    if not common:
        raise ValueError("no cells survive from the first day to the last")
    share = sum(weights[c] for c in common)
    renorm = {c: weights[c] / share for c in common}
    levels = {c: 100.0 * l.link for c, l in common.items()}
    return young_level(levels, renorm)
