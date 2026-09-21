"""Postgres twin of load.py.

Deliberately a near-duplicate rather than an abstraction over both backends:
the duplication *is* the test. apix/store/parity.py runs the whole engine
through each loader and asserts the published points -- including every
repro_hash -- come out identical. If the two ever drift, that assertion fails
loudly instead of quietly changing a published number.

Everything that could differ between SQLite and Postgres is pinned here:

  * obs_date is the UTC calendar date, matching SQLite's
    substr(collected_at,1,10) over a naive-UTC value -- NOT Asia/Kolkata.
    It is returned as a 'YYYY-MM-DD' string because Observation.obs_date is a
    string everywhere downstream and is used as a dict key.
  * ORDER BY collected_at, id gives a deterministic order. SQLite's plan
    happened to return ties in rowid order; relying on that implicitly would
    make sweep selection depend on the query planner.
  * is_observed / is_nonstop are real booleans here and 0/1 integers there.
"""
import datetime
from typing import Sequence

from .config import INDEX_SOURCE, LEAD_TIMES
from .load import MIN_SECONDS_PER_FETCH, SweepReport
from .model import ItemKey, Observation


def _run_genuineness(con) -> dict:
    rows = con.execute(
        "SELECT run_id, COUNT(*) AS n, MIN(started_at) AS t0, MAX(started_at) AS t1 "
        "FROM collection_run GROUP BY run_id").fetchall()
    verdicts = {}
    for r in rows:
        run_id, n, t0, t1 = r["run_id"], r["n"], r["t0"], r["t1"]
        if n < 2:
            verdicts[run_id] = None
            continue
        span = (t1 - t0).total_seconds()
        if span / max(n - 1, 1) < MIN_SECONDS_PER_FETCH:
            verdicts[run_id] = (f"{n} fetches in {span:.1f}s -- faster than the "
                                f"collector's own rate limit; treated as a replay")
        else:
            verdicts[run_id] = None
    return verdicts


def load_observations_pg(con, leads: Sequence[int] = LEAD_TIMES,
                         source: str = INDEX_SOURCE) -> tuple:
    """Return ({obs_date: [Observation]}, SweepReport) -- same contract as load.py."""
    verdicts = _run_genuineness(con)
    excluded = {r: why for r, why in verdicts.items() if why}

    rows = con.execute(
        """SELECT id, origin, destination, lead_time_days, carrier, flight_number,
                  dep_band, total_fare, collected_at, run_id,
                  to_char(collected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS obs_date
           FROM fare_observation
           WHERE is_observed
             AND source = %s
             AND fare_class = 'Economy'
             AND is_nonstop
             AND currency = 'INR'
             AND dep_band IS NOT NULL
             AND carrier IS NOT NULL
             AND flight_number IS NOT NULL
             AND total_fare > 0
           ORDER BY collected_at, id""", (source,)).fetchall()

    leads = set(leads)
    n_in = len(rows)

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
            continue
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

    return out, SweepReport(
        n_rows_in=n_in,
        n_rows_selected=sum(len(v) for v in out.values()),
        runs_per_day={d: sorted(v) for d, v in sorted(runs_per_day.items())},
        excluded_runs=excluded,
        cells_per_day={d: len({o.cell for o in v}) for d, v in sorted(out.items())},
    )


def collection_hour_spread_pg(con) -> dict:
    rows = con.execute(
        "SELECT to_char(collected_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d, "
        "       to_char(MIN(collected_at) AT TIME ZONE 'UTC','HH24:MI') AS lo, "
        "       to_char(MAX(collected_at) AT TIME ZONE 'UTC','HH24:MI') AS hi "
        "FROM fare_observation GROUP BY d ORDER BY d").fetchall()
    return {r["d"]: (r["lo"], r["hi"]) for r in rows}
