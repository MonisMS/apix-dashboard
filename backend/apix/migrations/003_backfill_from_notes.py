"""Backfill departure_time, dep_band, is_nonstop and run_id from existing data.

No re-collection is needed and none is possible -- a fare is a live quote and
yesterday's price cannot be recovered by any method. Everything here is
recovered from what we already stored:

  * departure_time / is_nonstop  <- the `notes` free text, which the collector
    has written as "nonstop; dep YYYY-MM-DD HH:MM" for every row.
  * dep_band                     <- derived from departure_time via spec.band(),
    then STORED, so that changing the band cut points later cannot silently
    rewrite history.
  * run_id                       <- matched against collection_run on
    (origin, destination, lead, departure_date, source), choosing the run whose
    started_at is the latest at or before the observation's collected_at. This
    is what makes per-cell sweep selection possible: 10 Sep 2026 is the union of
    four partial runs and has no single complete sweep.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent))
from apix.index.spec import band, parse_departure, parse_nonstop  # noqa: E402


def migrate(con):
    rows = con.execute(
        "SELECT id, notes, origin, destination, lead_time_days, departure_date, "
        "       source, collected_at FROM fare_observation").fetchall()

    runs = con.execute(
        "SELECT run_id, origin, destination, lead_time_days, departure_date, "
        "       source, started_at FROM collection_run ORDER BY started_at").fetchall()

    by_cell = {}
    for r in runs:
        key = (r[1], r[2], r[3], r[4], r[5])
        by_cell.setdefault(key, []).append((r[6], r[0]))   # (started_at, run_id)

    updates = []
    unmatched = 0
    for oid, notes, o, d, lead, dep_date, source, collected_at in rows:
        dep_time = parse_departure(notes)
        nonstop = parse_nonstop(notes)
        b = band(dep_time)

        run_id = None
        for started, rid in by_cell.get((o, d, lead, dep_date, source), []):
            if started <= collected_at:
                run_id = rid          # latest run at or before this observation
            else:
                break
        if run_id is None:
            unmatched += 1
        updates.append((dep_time, b, nonstop, 0 if nonstop else None, run_id, oid))

    con.executemany(
        "UPDATE fare_observation SET departure_time=?, dep_band=?, is_nonstop=?, "
        "stops=?, run_id=? WHERE id=?", updates)

    filled = con.execute(
        "SELECT COUNT(*) FROM fare_observation WHERE dep_band IS NOT NULL").fetchone()[0]
    with_run = con.execute(
        "SELECT COUNT(*) FROM fare_observation WHERE run_id IS NOT NULL").fetchone()[0]
    total = len(rows)
    print(f"\n      {total} rows: dep_band on {filled}, run_id on {with_run}", end="")
    if unmatched:
        print(f", {unmatched} unmatched to a run", end="")

    if filled != total:
        raise RuntimeError(
            f"dep_band missing on {total - filled} rows -- the notes format "
            "changed, or an adapter stopped writing it. Fix the parse before "
            "continuing; a null band would silently drop those rows from every cell.")
