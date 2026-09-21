"""Reading observations out of the database and choosing which sweep counts.

Two things happen here that do not belong in the maths layer:

1. **Per-cell sweep selection.** 10 September 2026 is not one sweep; it is the
   union of four partial runs (20 + 25 + 15 + 20 fetches). There is no single
   complete sweep that day, so selection has to happen per (date, route, lead)
   cell rather than per day -- a day-level rule would discard 40 of that day's
   60 cells.

2. **Genuineness screening.** A run that fetches faster than the collector's own
   rate limit cannot be live collection and is excluded from selection.

   Measured 12 Sep 2026, all six runs to date: 4.4-5.7 s per fetch, except run
   `2971dedf0649` at 0.95 s (25 fetches in 22.8 s). An earlier audit note
   described that run as "25 fetches in 1.0 second" and concluded it was a
   replay -- that is wrong; it is merely the fastest run, and it passes. The
   screen is kept as a guard for the future, not because today's data trips it.
   Nothing is excluded at present and `SweepReport.excluded_runs` is empty.

Storage records what happened. This module decides what it means. Nothing is
ever deleted from fare_observation.
"""
import datetime
import sqlite3
from typing import Mapping, NamedTuple, Optional, Sequence

from .config import INDEX_SOURCE, LEAD_TIMES
from .model import ItemKey, Observation

# A run whose fetches arrive faster than this cannot be live collection:
# collect.py sleeps 1.5 s between calls.
MIN_SECONDS_PER_FETCH = 0.5


class SweepReport(NamedTuple):
    n_rows_in: int
    n_rows_selected: int
    runs_per_day: dict
    excluded_runs: dict          # run_id -> reason
    cells_per_day: dict


def _run_genuineness(con) -> dict:
    """Classify every collection run. Returns {run_id: reason_or_None}."""
    rows = con.execute(
        "SELECT run_id, COUNT(*) n, MIN(started_at) t0, MAX(started_at) t1 "
        "FROM collection_run GROUP BY run_id").fetchall()
    verdicts = {}
    for run_id, n, t0, t1 in rows:
        if n < 2:
            verdicts[run_id] = None
            continue
        span = (datetime.datetime.fromisoformat(t1)
                - datetime.datetime.fromisoformat(t0)).total_seconds()
        if span / max(n - 1, 1) < MIN_SECONDS_PER_FETCH:
            verdicts[run_id] = (f"{n} fetches in {span:.1f}s -- faster than the "
                                f"collector's own rate limit; treated as a replay")
        else:
            verdicts[run_id] = None
    return verdicts


def load_observations(con, leads: Sequence[int] = LEAD_TIMES,
                      source: str = INDEX_SOURCE) -> tuple:
    """Return ({obs_date: [Observation]}, SweepReport).

    Standing filters are the frozen product specification: **one price source**,
    observed rows only, economy, non-stop, INR. The source filter is not a
    preference -- see config.INDEX_SOURCE for the day it was needed.

    `is_nonstop` is now a real column -- the old `notes LIKE 'nonstop%'` test
    parsed free text, so an adapter changing its note string would have
    silently emptied the index.
    """
    con.row_factory = sqlite3.Row
    verdicts = _run_genuineness(con)
    excluded = {r: why for r, why in verdicts.items() if why}

    rows = con.execute(
        """SELECT id, origin, destination, lead_time_days, carrier, flight_number,
                  dep_band, total_fare, collected_at, run_id,
                  substr(collected_at,1,10) AS obs_date
           FROM fare_observation
           WHERE is_observed = 1
             AND source = ?
             AND fare_class = 'Economy'
             AND is_nonstop = 1
             AND currency = 'INR'
             AND dep_band IS NOT NULL
             AND carrier IS NOT NULL
             AND flight_number IS NOT NULL
             AND total_fare > 0
           ORDER BY collected_at""", (source,)).fetchall()

    leads = set(leads)
    n_in = len(rows)

    # Pick, per (date, route, lead), the latest genuine run that covered it.
    best_run: dict = {}
    for r in rows:
        if r["lead_time_days"] not in leads:
            continue
        if excluded.get(r["run_id"]):
            continue
        key = (r["obs_date"], r["origin"], r["destination"], r["lead_time_days"])
        prev = best_run.get(key)
        if prev is None or r["collected_at"] > prev[0]:
            best_run[key] = (r["collected_at"], r["run_id"])

    out: dict = {}
    runs_per_day: dict = {}
    for r in rows:
        if r["lead_time_days"] not in leads:
            continue
        if excluded.get(r["run_id"]):
            continue
        key = (r["obs_date"], r["origin"], r["destination"], r["lead_time_days"])
        chosen = best_run.get(key)
        if not chosen or r["run_id"] != chosen[1]:
            continue          # superseded by a later sweep of this same cell
        out.setdefault(r["obs_date"], []).append(Observation(
            obs_date=r["obs_date"],
            item=ItemKey(r["origin"], r["destination"], r["lead_time_days"],
                         r["carrier"], r["flight_number"]),
            dep_band=r["dep_band"],
            total_fare=float(r["total_fare"]),
            observation_id=r["id"],
            run_id=r["run_id"],
        ))
        runs_per_day.setdefault(r["obs_date"], set()).add(r["run_id"])

    report = SweepReport(
        n_rows_in=n_in,
        n_rows_selected=sum(len(v) for v in out.values()),
        runs_per_day={d: sorted(v) for d, v in sorted(runs_per_day.items())},
        excluded_runs=excluded,
        cells_per_day={d: len({o.cell for o in v}) for d, v in sorted(out.items())},
    )
    return out, report


def collection_hour_spread(con) -> dict:
    """First and last collection time per day.

    The index compares a fare collected at 00:06 with one collected at 15:01 and
    calls the difference a price movement. Part of it is the clock. Publish the
    spread so the reader can see it rather than discovering it.
    """
    rows = con.execute(
        "SELECT substr(collected_at,1,10) d, MIN(collected_at), MAX(collected_at) "
        "FROM fare_observation GROUP BY d ORDER BY d").fetchall()
    return {d: (lo[11:16], hi[11:16]) for d, lo, hi in rows}
