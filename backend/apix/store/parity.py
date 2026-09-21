"""The parity gate: does the engine produce identical output from Neon?

    APIX_PG_URL=postgresql://... python3 -m apix.store.parity \
        --sqlite /home/monis/sih2026/apix/data/apix.db

Runs the whole pipeline twice -- once over SQLite, once over Postgres -- and
compares the published points field by field, repro_hash included.

This is the only check that can prove the SQLite -> Postgres type mapping is
faithful. A float widened to numeric, a timestamp read in the wrong zone, or
obs_date derived in IST instead of UTC all produce plausible-looking numbers
and a different digest. Exit code is non-zero on any difference.
"""
import argparse
import sqlite3
import sys

from ..index import cli
from ..index.load_pg import collection_hour_spread_pg, load_observations_pg
from . import pg


def _run_sqlite(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.execute("PRAGMA query_only=1")
    return cli.compute(con)


def _run_postgres():
    """cli.compute() reads whatever loaders are bound in cli's namespace, so
    swapping them there runs the identical pipeline over a different store."""
    saved = (cli.load_observations, cli.collection_hour_spread)
    try:
        cli.load_observations = load_observations_pg
        cli.collection_hour_spread = collection_hour_spread_pg
        with pg.connect() as con:
            con.execute("SET TRANSACTION READ ONLY")
            return cli.compute(con)
    finally:
        cli.load_observations, cli.collection_hour_spread = saved


def compare(a, b) -> int:
    diffs = []

    pa, pb = a["points"], b["points"]
    if len(pa) != len(pb):
        diffs.append(f"point count: sqlite={len(pa)} neon={len(pb)}")

    for i, (x, y) in enumerate(zip(pa, pb)):
        for k in sorted(set(x) | set(y)):
            if x.get(k) != y.get(k):
                diffs.append(
                    f"point[{i}] {x.get('period_start')} field {k!r}: "
                    f"sqlite={x.get(k)!r} neon={y.get(k)!r}")

    for key in ("reference",):
        if a[key] != b[key]:
            diffs.append(f"{key}: sqlite={a[key]!r} neon={b[key]!r}")

    if len(a["_weights"]) != len(b["_weights"]):
        diffs.append(f"cell count: sqlite={len(a['_weights'])} neon={len(b['_weights'])}")
    else:
        for cell, wa in a["_weights"].items():
            wb = b["_weights"].get(cell)
            if wb != wa:
                diffs.append(f"weight {cell}: sqlite={wa!r} neon={wb!r}")

    if diffs:
        print(f"\n  FAILED -- {len(diffs)} difference(s):\n")
        for d in diffs[:40]:
            print("   ", d)
        if len(diffs) > 40:
            print(f"    ... and {len(diffs) - 40} more")
        return 1

    print(f"\n  PASS -- {len(pa)} points identical, including every repro_hash.")
    print(f"         {len(a['_weights'])} cell weights identical.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    args = ap.parse_args()

    print("  computing from SQLite ...")
    a = _run_sqlite(args.sqlite)
    print(f"    {len(a['points'])} points, {len(a['_weights'])} cells")

    print("  computing from Neon ...")
    b = _run_postgres()
    print(f"    {len(b['points'])} points, {len(b['_weights'])} cells")

    return compare(a, b)


if __name__ == "__main__":
    sys.exit(main())
