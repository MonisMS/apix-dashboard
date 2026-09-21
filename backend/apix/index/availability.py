"""Disappearance, sold-out, and how much they could be moving the index.

THE PROBLEM
-----------
`availability` is written as the constant `'AVAILABLE'` by the adapter and no
row has ever been anything else. Our source returns the flights it can sell; it
does not report the ones it cannot. So a flight that sold out and a flight the
source simply failed to return are **the same event** to us: it stops appearing.

That matters because the CPI Manual (8.63) warns that disappearance is
price-correlated -- items vanish *because* of what happened to their price. If
that is true here, dropping or imputing the vanished flights biases the index,
and the direction of the bias depends on why they vanished.

We cannot observe the cause. What we can do is measure the association, and
bound how much it could be worth. That is what this module does.

WHAT THE DATA ACTUALLY SAYS (measured 12 Sep 2026, 2 transitions)
------------------------------------------------------------------
                     vanished   log diff   median vanished/survived   significant
    10 -> 11 Sep     70 (4.8%)   +10.6%        9,958 / 8,828             yes
    11 -> 12 Sep     69 (4.7%)    -0.1%        8,465 / 8,850             no

The first transition says flights that vanished were dearer, and the difference
is unlikely to be chance. The second says there is no difference at all, and by
median the vanished flights were *cheaper*. **The direction is not consistent.**

Note what the choice of statistic does here: on 11->12 Sep the arithmetic-mean
ratio reads +1.2% while the log difference is -0.1% and the median is negative.
A handful of very expensive fares drag the mean. Quoting +1.2% as a finding
would be reading an outlier as a pattern, which is why the log difference is the
headline and the arithmetic ratio is reported beside it.

So the honest reading is: with two transitions, no cause can be attributed, and
nothing here supports the textbook sell-out story in which the cheapest buckets
go first. A source that truncates its result list would look exactly like this,
and so would genuine sell-outs of the last expensive seats.

WHAT WE DO ABOUT IT
-------------------
Nothing clever, and nothing invented. Vanished items are imputed from their
cell's observed movement, which is the Manual's rule. This module publishes the
disappearance rate, the price differential, and an analytic bound on what the
bias could be if the vanished flights would have moved differently from the
survivors -- so the size of the unknown is a number on the dashboard rather
than a caveat in a footnote.

**Until the scraper reports real availability, no sold-out claim may be made.**
`observed_availability()` reports how much of the data carries an actually
observed availability value. It is currently zero.
"""
import math
import statistics
from typing import Mapping, Sequence


def _split(prev: Sequence, cur: Sequence) -> tuple:
    a = {o.item: o.total_fare for o in prev}
    b = {o.item: o.total_fare for o in cur}
    vanished = {k: a[k] for k in a.keys() - b.keys()}
    survived = {k: a[k] for k in a.keys() & b.keys()}
    appeared = {k: b[k] for k in b.keys() - a.keys()}
    return vanished, survived, appeared


def _welch(x: Sequence[float], y: Sequence[float]) -> dict:
    """Welch's t on log prices -- unequal variances, no normality assumed of levels.

    Logs because fares are multiplicative: a 'flights that vanished were 13%
    dearer' claim is a ratio claim, and a ratio claim belongs in log space.
    """
    if len(x) < 2 or len(y) < 2:
        return {"t": None, "df": None, "significant_5pct": None}
    lx = [math.log(v) for v in x]
    ly = [math.log(v) for v in y]
    mx, my = statistics.fmean(lx), statistics.fmean(ly)
    vx, vy = statistics.variance(lx), statistics.variance(ly)
    nx, ny = len(lx), len(ly)
    se = math.sqrt(vx / nx + vy / ny)
    if se == 0:
        return {"t": None, "df": None, "significant_5pct": None}
    t = (mx - my) / se
    df = (vx / nx + vy / ny) ** 2 / (
        (vx / nx) ** 2 / (nx - 1) + (vy / ny) ** 2 / (ny - 1))
    return {
        "t": round(t, 3), "df": round(df, 1),
        # 1.96 is the large-sample 5% two-sided bound; df here is in the hundreds.
        "significant_5pct": abs(t) > 1.96,
    }


def disappearance(obs_by_day: Mapping[str, Sequence]) -> dict:
    """Per-transition disappearance rate and price differential."""
    days = sorted(obs_by_day)
    out = []
    for a, b in zip(days, days[1:]):
        vanished, survived, appeared = _split(obs_by_day[a], obs_by_day[b])
        if not vanished or not survived:
            continue
        v, s = list(vanished.values()), list(survived.values())
        ratio = statistics.fmean(v) / statistics.fmean(s)
        # The headline differential is computed in LOG space, because that is
        # the quantity the significance test operates on and because fares are
        # multiplicative. The arithmetic-mean ratio is reported alongside and
        # can disagree sharply -- on 11->12 Sep it reads +1.2% while the median
        # says vanished flights were CHEAPER, because a handful of very high
        # fares drag the mean. Quoting the arithmetic ratio as the finding would
        # be reading an outlier as a pattern.
        log_ratio = math.exp(
            statistics.fmean(math.log(x) for x in v)
            - statistics.fmean(math.log(x) for x in s))
        out.append({
            "from": a, "to": b,
            "n_prev": len(vanished) + len(survived),
            "n_vanished": len(vanished),
            "n_survived": len(survived),
            "n_appeared": len(appeared),
            "vanish_rate": round(len(vanished) / (len(vanished) + len(survived)), 4),
            "mean_fare_vanished": round(statistics.fmean(v), 2),
            "mean_fare_survived": round(statistics.fmean(s), 2),
            "median_fare_vanished": round(statistics.median(v), 2),
            "median_fare_survived": round(statistics.median(s), 2),
            "price_differential_pct": round((log_ratio - 1) * 100, 2),
            "arithmetic_mean_differential_pct": round((ratio - 1) * 100, 2),
            "test": _welch(v, s),
        })

    diffs = [d["price_differential_pct"] for d in out]
    stable = bool(diffs) and (all(d > 0 for d in diffs) or all(d < 0 for d in diffs))
    return {
        "transitions": out,
        "n_transitions": len(out),
        "mean_vanish_rate": round(statistics.fmean(
            d["vanish_rate"] for d in out), 4) if out else None,
        "differential_range_pct": [min(diffs), max(diffs)] if diffs else None,
        "direction_consistent": stable,
        "reading": _reading(out),
    }


def _reading(transitions) -> str:
    if not transitions:
        return "Not enough transitions to say anything."
    diffs = [t["price_differential_pct"] for t in transitions]
    sig = [t["test"]["significant_5pct"] for t in transitions]
    direction = ("dearer" if statistics.fmean(diffs) > 0 else "cheaper")
    consistent = all(d > 0 for d in diffs) or all(d < 0 for d in diffs)
    parts = [
        f"Over {len(transitions)} transition(s), flights that stopped appearing "
        f"were on average {abs(statistics.fmean(diffs)):.1f}% {direction} than "
        f"those that stayed."
    ]
    if not consistent:
        parts.append("The direction is not consistent between transitions.")
    elif len(transitions) < 5:
        parts.append(
            f"The direction is consistent but rests on only {len(transitions)} "
            f"transition(s), which is not enough to attribute a cause.")
    if any(sig):
        parts.append(
            "At least one transition shows a difference unlikely to be chance "
            "(Welch's t on log fares), so this is an association worth bounding, "
            "not noise to ignore.")
    parts.append(
        "Cause is unobservable: a sell-out and a source that truncated its "
        "result list look identical from here.")
    return " ".join(parts)


def bias_bound(obs_by_day: Mapping[str, Sequence],
               weights: Mapping, excess_moves=(0.0, 5.0, 10.0, 20.0)) -> dict:
    """How far the index could be wrong because of what we cannot see.

    Vanished items are imputed at their cell's observed movement, i.e. we assume
    they would have moved like the flights that stayed. If instead they would
    have moved differently -- because they were selling out and rising, say --
    the index is wrong by roughly

        bias  ~=  (share of weight in vanished items)  x  (excess movement)

    This reports that product for a range of assumed excess movements, so the
    size of the unknown is a published number instead of a hand-wave. It is a
    sensitivity, not an estimate: we are not claiming the excess is any of these
    values, only showing what each would cost.
    """
    days = sorted(obs_by_day)
    rows = []
    for a, b in zip(days, days[1:]):
        vanished, survived, _ = _split(obs_by_day[a], obs_by_day[b])
        if not vanished:
            continue
        # Approximate each item's weight by its cell's weight spread over the
        # cell's items -- exact enough for a bound, and stated as such.
        cell_items = {}
        for o in obs_by_day[a]:
            cell_items.setdefault(o.cell, []).append(o.item)
        share = 0.0
        for cell, items in cell_items.items():
            w = weights.get(cell, 0.0)
            if not w or not items:
                continue
            n_gone = sum(1 for i in items if i in vanished)
            share += w * n_gone / len(items)
        rows.append({
            "to": b,
            "weight_share_vanished": round(share, 6),
            "index_bias_pp": {f"{x}%": round(share * x, 4) for x in excess_moves},
        })

    worst = max((r["weight_share_vanished"] for r in rows), default=0.0)
    return {
        "per_day": rows,
        "max_weight_share_vanished": round(worst, 6),
        "worst_case_bias_pp": round(worst * max(excess_moves), 4),
        "interpretation":
            f"At most {worst:.2%} of basket weight disappeared in a single day. "
            f"If those flights would have moved {max(excess_moves):.0f} percentage "
            f"points differently from the ones that stayed, the published index "
            f"would be off by about {worst * max(excess_moves):.3f} index points. "
            f"That is the size of the sold-out unknown at current coverage.",
        "note": "A sensitivity, not an estimate. We do not claim the excess "
                "movement is any of these values.",
    }


def observed_availability(con) -> dict:
    """How much of the data carries an availability value we actually observed.

    The honest gate on any sold-out claim. While this is zero, the dashboard and
    the deck must not say we detect sold-out flights.
    """
    # Two portability rules, because this runs against SQLite (the reference
    # implementation) and Postgres (the publisher) with the same code:
    #   * CASE WHEN, not SUM(COALESCE(col, 0)) -- the column is INTEGER in
    #     SQLite and boolean in Postgres, and CASE WHEN accepts both.
    #   * Every column is aliased and read by name, because sqlite3.Row and
    #     psycopg's dict_row both index by name but disagree on integers.
    row = con.execute(
        "SELECT COUNT(*) AS total, "
        "       SUM(CASE WHEN is_observed_availability THEN 1 ELSE 0 END) AS observed "
        "FROM fare_observation").fetchone()
    total, observed = row["total"], row["observed"]
    values = [r["availability"] for r in con.execute(
        "SELECT DISTINCT availability FROM fare_observation")]
    seats = con.execute(
        "SELECT COUNT(seats_left) AS n FROM fare_observation").fetchone()["n"]
    return {
        "n_observations": total,
        "n_with_observed_availability": observed or 0,
        "share_observed": round((observed or 0) / total, 6) if total else 0.0,
        "distinct_values": values,
        "n_with_seats_left": seats,
        "can_claim_sold_out_detection": bool(observed),
        "statement": (
            "Availability is asserted by the adapter, not observed. Every row "
            "reads AVAILABLE because that is what the adapter writes, not "
            "because a flight was checked and found bookable. Sold-out is "
            "therefore indistinguishable from not-collected, and no sold-out "
            "detection may be claimed."
            if not observed else
            f"{observed} of {total} rows carry an observed availability value."),
    }


def report(obs_by_day, weights, con=None) -> dict:
    out = {
        "disappearance": disappearance(obs_by_day),
        "bias_bound": bias_bound(obs_by_day, weights),
    }
    if con is not None:
        out["observed_availability"] = observed_availability(con)
    return out
