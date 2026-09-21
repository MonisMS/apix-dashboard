"""Outlier screening, on log price relatives.

The problem statement asks for a cleaning pipeline that "removes outliers". This
is that component. Two things about it matter more than the code:

**It screens movements, not levels.** A Rs 32,000 DEL-SXR fare is not an outlier;
a Rs 32,000 fare that was Rs 6,000 yesterday is. Screening on the level would
delete expensive routes, which is a coverage decision wearing a quality costume.

**Nothing is deleted.** A screened observation is quarantined: it leaves the
matched sample and the cell is imputed from its siblings' movement instead. The
row stays in `fare_observation` forever and the flag is reproducible from the
same inputs.

---

MEASURED ON OUR OWN DATA, 12 Sep 2026, 2,791 matched relatives:

    min -1.333   p1 -0.905   p5 -0.503   median +0.000   p95 +0.279
    p99 +0.549   max +1.084
    median 0.0000   MAD 0.0652   ->  1.4826 * MAD = 0.0966

That median of exactly zero is the whole story: most flights do not reprice from
one day to the next, so the median absolute deviation is dominated by a mass of
no-change observations and collapses to 0.065 -- while genuine day-to-day moves
run to -50% / +28% at the 5th and 95th percentiles.

A median/MAD screen calibrated on that scale is therefore far too tight:

    k=3  ->  448 flagged (16.1%)   any move beyond -25% / +34%
    k=4  ->  298 flagged (10.7%)   any move beyond -32% / +47%
    k=5  ->  190 flagged  (6.8%)   any move beyond -38% / +62%

Quarantining 6.8% of matched flights for moving more than a third in a day would
not be cleaning. Airfares move like that; that volatility is the phenomenon the
index exists to measure. Screening it out biases the index toward zero change,
which is the most insidious failure a price index has -- it looks stable and is
wrong.

**So MAD screening ships implemented but OFF by default.** The hard bound is on.
It flags 4 of 2,791 relatives (0.14%) -- moves of more than 3x in a day, which
are far outside anything the rest of the distribution supports and are much more
likely to be a source defect than a fare.

Both are config, and `sensitivity()` reports what each does to the published
number, so the choice is visible rather than buried.
"""
import math
import statistics
from typing import Mapping, Sequence

from .config import EXTREME_LOG_REL, MAD_K, MAD_MIN_POOL
from .model import Flag, ItemKey, Observation


def log_relatives(prev: Sequence[Observation],
                  cur: Sequence[Observation]) -> dict:
    """{ItemKey: ln(p_t / p_{t-1})} over items present in both periods."""
    a = {o.item: o.total_fare for o in prev}
    b = {o.item: o.total_fare for o in cur}
    out = {}
    for k in a.keys() & b.keys():
        if a[k] > 0 and b[k] > 0:
            out[k] = math.log(b[k] / a[k])
    return out


def screen_extreme(rels: Mapping[ItemKey, float],
                   threshold: float = EXTREME_LOG_REL) -> dict:
    """Tier A: a hard bound on implausible single-day moves.

    Deliberately not distributional. It asks "could this be a real fare at all",
    not "is this unusual for this route". At ln(3) it catches a fare that tripled
    or fell to a third overnight.
    """
    return {k: r for k, r in rels.items() if abs(r) > threshold}


def _pools(rels: Mapping[ItemKey, float], level: str) -> dict:
    pools = {}
    for k, r in rels.items():
        if level == "route_lead":
            key = (k.origin, k.destination, k.lead_time_days)
        elif level == "route":
            key = (k.origin, k.destination)
        else:
            key = ()
        pools.setdefault(key, {})[k] = r
    return pools


def screen_mad(rels: Mapping[ItemKey, float], k: float = MAD_K,
               min_pool: int = MAD_MIN_POOL) -> dict:
    """Tier B: robust distributional screen, median +/- k * 1.4826 * MAD.

    Robust on purpose: the contaminating observations are inside the sample used
    to set the threshold, so a mean/SD rule would be dragged out by the very
    points it is meant to catch.

    Pools escalate (route, lead) -> (route) -> (all) until one is large enough.
    A pool where MAD is zero yields no flags: if every flight in it moved
    identically there is no dispersion to be an outlier against, and treating the
    whole pool as outliers would be nonsense.

    OFF by default. See the module docstring for the measurement that decided it.
    """
    flagged = {}
    for level in ("route_lead", "route", "all"):
        remaining = {i: r for i, r in rels.items() if i not in flagged}
        if not remaining:
            break
        for _, pool in _pools(remaining, level).items():
            if len(pool) < min_pool:
                continue        # too small to judge; falls through to a wider pool
            vals = list(pool.values())
            med = statistics.median(vals)
            mad = statistics.median([abs(v - med) for v in vals])
            if mad == 0:
                continue
            scale = k * 1.4826 * mad
            for item, r in pool.items():
                if abs(r - med) > scale:
                    flagged[item] = r
    return flagged


def screen(obs_by_day: Mapping[str, Sequence[Observation]], cfg) -> tuple:
    """Screen every consecutive pair of days.

    Returns ({date: frozenset(ItemKey)}, [Flag], report). The frozenset feeds
    straight into `chain.build_raw_series(screened=...)`; the flags are for the
    record; the report is what the dashboard shows.
    """
    days = sorted(obs_by_day)
    screened, flags = {}, []
    per_day = {}

    for prev_day, day in zip(days, days[1:]):
        rels = log_relatives(obs_by_day[prev_day], obs_by_day[day])
        extreme = screen_extreme(rels, cfg.extreme_log_rel) if cfg.screen_extreme else {}
        mad = screen_mad(rels, cfg.mad_k, cfg.mad_min_pool) if cfg.screen_mad else {}

        by_id = {o.item: o.observation_id for o in obs_by_day[day]}
        for item, r in extreme.items():
            flags.append(Flag(by_id.get(item, -1), "EXTREME_MOVE",
                              f"ln relative {r:+.4f} ({math.exp(r) - 1:+.1%}) "
                              f"exceeds the hard bound"))
        for item, r in mad.items():
            if item in extreme:
                continue
            flags.append(Flag(by_id.get(item, -1), "MAD_OUTLIER",
                              f"ln relative {r:+.4f} outside k={cfg.mad_k} MAD band"))

        both = set(extreme) | set(mad)
        screened[day] = frozenset(both)
        per_day[day] = {
            "n_relatives": len(rels),
            "n_extreme": len(extreme),
            "n_mad": len(set(mad) - set(extreme)),
            "n_screened": len(both),
            "share_screened": round(len(both) / len(rels), 6) if rels else 0.0,
        }

    report = {
        "enabled": {"hard_bound": cfg.screen_extreme, "mad": cfg.screen_mad},
        "hard_bound": {
            "threshold_log": round(cfg.extreme_log_rel, 6),
            "threshold_ratio": round(math.exp(cfg.extreme_log_rel), 2),
            "description": f"a fare that changed by more than "
                           f"{math.exp(cfg.extreme_log_rel):.0f}x in one day",
        },
        "mad": {
            "k": cfg.mad_k, "min_pool": cfg.mad_min_pool,
            "pools": "(route, lead) then (route) then (all)",
            "why_default_off":
                "The median day-to-day move is exactly zero -- most flights do not "
                "reprice -- so MAD collapses to about 0.065 while genuine moves run "
                "to -50%/+28% at p5/p95. At k=5 the band would quarantine 6.8% of "
                "matched flights for moving more than about a third in a day. That is "
                "ordinary airfare behaviour, and screening it out would bias the index "
                "toward zero change.",
        },
        "treatment": "Screened observations are quarantined, not deleted: they leave "
                     "the matched sample and the cell is imputed from its siblings' "
                     "movement. No row is ever removed from fare_observation.",
        "per_day": per_day,
        "n_flags": len(flags),
    }
    return screened, flags, report


def sensitivity(obs_by_day, weights, cfg, build_fn) -> dict:
    """Recompute the series under each screening regime and report the spread.

    Publishing this matters more than the choice itself. If the index barely
    moves across regimes, that robustness is a stronger claim than any single
    defensible threshold; if it moves a lot, we have found the thing most in
    need of fixing.
    """
    import dataclasses
    out = {}
    regimes = {
        "none": dict(screen_extreme=False, screen_mad=False),
        "hard_bound_only": dict(screen_extreme=True, screen_mad=False),
        "hard_bound_and_mad": dict(screen_extreme=True, screen_mad=True),
    }
    for name, flags in regimes.items():
        c = dataclasses.replace(cfg, **flags)
        scr, _, rep = screen(obs_by_day, c)
        try:
            results = build_fn(obs_by_day, weights, screened=scr)
            out[name] = {
                "final_raw_level": round(results[-1].raw_level, 6),
                "n_screened": sum(v["n_screened"] for v in rep["per_day"].values()),
                "n_cells_imputed_final": results[-1].n_imputed,
            }
        except Exception as e:
            out[name] = {"error": f"{type(e).__name__}: {e}"}
    base = out.get("none", {}).get("final_raw_level")
    for name, v in out.items():
        if base and "final_raw_level" in v:
            v["diff_from_unscreened_pct"] = round(
                (v["final_raw_level"] / base - 1) * 100, 6)
    return out
