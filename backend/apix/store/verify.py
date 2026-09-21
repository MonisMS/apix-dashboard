"""Recompute every published repro_hash from what is actually stored in Neon.

    APIX_PG_URL=postgresql://... python3 -m apix.store.verify

This is the claim the project makes about itself, checked mechanically: the
digest on a published point can be regenerated from the elementary links and
weights sitting in the database, by anyone, without re-running the collector.

It reads only elementary_index and index_run -- never the engine -- so it fails
if the stored substrate and the stored digest disagree, which is exactly the
failure a silent type or rounding bug would cause. Non-zero exit on mismatch,
so the daily Action goes red.
"""
import sys

from typing import NamedTuple

from ..index.model import CellKey
from ..index.repro import point_digest
from . import pg


class StoredLink(NamedTuple):
    """What canonical_payload reads off a link: the ratio and the imputed flag.

    An imputed link and an observed link of the same value are deliberately
    different inputs to the digest, so the flag has to travel with the value.
    """
    link: float
    is_imputed: bool


def verify(con, run_id=None) -> int:
    run = con.execute(
        "SELECT id, run_uid, reference_factor, status FROM index_run "
        "WHERE id = COALESCE(%s, (SELECT id FROM index_run WHERE status='PUBLISHED'))",
        (run_id,)).fetchone()
    if not run:
        print("  no published vintage to verify")
        return 1

    factor = run["reference_factor"]
    print(f"  vintage {run['id']}  {run['run_uid']}  [{run['status']}]")

    rows = con.execute(
        "SELECT obs_date, origin, destination, lead_time_days, carrier, dep_band, "
        "       link, weight, is_imputed "
        "FROM elementary_index WHERE index_run_id = %s", (run["id"],)).fetchall()

    # Rebuild the two maps point_digest hashes, exactly as the engine held them.
    # Both are PER DAY: chain.to_points hashes d.weights, the live weights in
    # force that day, not the static base weights -- retiring a dead cell
    # redistributes weight, so the two diverge as soon as that happens.
    links_by_day: dict = {}
    weights_by_day: dict = {}
    for r in rows:
        day = str(r["obs_date"])
        cell = CellKey(r["origin"], r["destination"], r["lead_time_days"],
                       r["carrier"], r["dep_band"])
        if r["link"] is not None:
            links_by_day.setdefault(day, {})[cell] = StoredLink(
                r["link"], bool(r["is_imputed"]))
        if r["weight"] is not None:
            weights_by_day.setdefault(day, {})[cell] = r["weight"]

    points = con.execute(
        "SELECT period_start, repro_hash FROM index_point "
        "WHERE index_run_id = %s AND series_id = 'APIX.ALL' ORDER BY period_start",
        (run["id"],)).fetchall()

    bad = 0
    for p in points:
        day = str(p["period_start"])
        got = point_digest(day, "APIX.ALL", "D", factor,
                           links_by_day.get(day, {}), weights_by_day.get(day, {}))
        ok = got == p["repro_hash"]
        if not ok:
            bad += 1
            print(f"    {day}  MISMATCH")
            print(f"      stored     {p['repro_hash']}")
            print(f"      recomputed {got}")
        else:
            print(f"    {day}  ok  {p['repro_hash'][:26]}...")

    if bad:
        print(f"\n  FAILED: {bad} of {len(points)} digests do not reproduce.")
        return 1
    print(f"\n  PASS: all {len(points)} headline digests reproduce from stored rows.")
    return 0


def main() -> int:
    with pg.connect() as con:
        con.execute("SET TRANSACTION READ ONLY")
        return verify(con)


if __name__ == "__main__":
    sys.exit(main())
