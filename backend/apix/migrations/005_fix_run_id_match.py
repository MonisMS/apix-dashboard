"""Re-do the run_id backfill using nearest-in-time matching.

Migration 003 matched an observation to "the latest run that started at or
before it". That is wrong for this collector: `collect.py` builds the quote
first and writes the `collection_run` row afterwards, so the run's `started_at`
lands a few milliseconds AFTER the observation's `collected_at`:

    observation collected_at : 2026-09-11 15:01:28.816637
    run         started_at   : 2026-09-11 15:01:28.828441

so the at-or-before test failed and only 736 of 5,141 rows were matched.

Nearest-in-time is the right rule here and is unambiguous: a run row exists per
(route, lead, departure date, source) fetch, and separate runs are hours apart,
so the closest run is always the one that produced the observation. A match
further than MAX_GAP away is left NULL rather than guessed -- an observation we
cannot attribute to a sweep must not be silently attributed to the wrong one.
"""
import datetime

MAX_GAP_SECONDS = 600      # 10 minutes; observed gaps are milliseconds


def _ts(s):
    return datetime.datetime.fromisoformat(s)


def migrate(con):
    runs = con.execute(
        "SELECT run_id, origin, destination, lead_time_days, departure_date, "
        "       source, started_at FROM collection_run").fetchall()
    by_cell = {}
    for rid, o, d, lead, dep, src, started in runs:
        by_cell.setdefault((o, d, lead, dep, src), []).append((_ts(started), rid))

    rows = con.execute(
        "SELECT id, origin, destination, lead_time_days, departure_date, source, "
        "       collected_at FROM fare_observation").fetchall()

    updates, unmatched, far = [], 0, 0
    for oid, o, d, lead, dep, src, collected in rows:
        candidates = by_cell.get((o, d, lead, dep, src))
        if not candidates:
            unmatched += 1
            updates.append((None, oid))
            continue
        c_ts = _ts(collected)
        started, rid = min(candidates, key=lambda x: abs((x[0] - c_ts).total_seconds()))
        if abs((started - c_ts).total_seconds()) > MAX_GAP_SECONDS:
            far += 1
            updates.append((None, oid))
            continue
        updates.append((rid, oid))

    con.executemany("UPDATE fare_observation SET run_id=? WHERE id=?", updates)

    total = len(rows)
    with_run = con.execute(
        "SELECT COUNT(*) FROM fare_observation WHERE run_id IS NOT NULL").fetchone()[0]
    print(f"\n      run_id on {with_run}/{total}", end="")
    if unmatched:
        print(f", {unmatched} with no run for their cell", end="")
    if far:
        print(f", {far} beyond {MAX_GAP_SECONDS}s", end="")

    if with_run < total * 0.99:
        raise RuntimeError(
            f"only {with_run}/{total} observations could be attributed to a "
            "collection run. Per-cell sweep selection depends on this, so do not "
            "continue with a partial mapping.")
