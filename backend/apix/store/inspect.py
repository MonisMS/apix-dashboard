"""Show what is actually in Neon.

    APIX_PG_URL=postgresql://... python3 -m apix.store.inspect
    APIX_PG_URL=postgresql://... python3 -m apix.store.inspect --sql "SELECT ..."

Read-only. Useful for answering "did the publish actually land?" without
opening the console.
"""
import argparse
import sys

from . import pg

TABLES = [
    "fare_observation", "collection_run",
    "index_run", "weight_set", "weight", "series", "index_point",
    "elementary_index", "index_observation", "observation_flag",
    "collection_day_stat", "sweep_exclusion", "pg_schema_version",
]


def _print_rows(rows):
    if not rows:
        print("  (no rows)")
        return
    cols = list(rows[0].keys())
    widths = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
    print("  " + " | ".join(c.ljust(widths[c]) for c in cols))
    print("  " + "-+-".join("-" * widths[c] for c in cols))
    for r in rows:
        print("  " + " | ".join(str(r[c]).ljust(widths[c]) for c in cols))


def overview(con):
    print("=== row counts ===")
    for t in TABLES:
        # Each count gets its own savepoint. In psycopg a failed statement
        # aborts the enclosing transaction, so without this a single missing
        # table would make every later count report "(missing)" and the
        # vintage queries below raise outright -- failing the workflow's
        # summary step over one absent table.
        try:
            with con.transaction():
                n = con.execute(f"SELECT COUNT(*)::int AS n FROM {t}").fetchone()["n"]
            print(f"  {t:<22} {n:>7}")
        except Exception:
            print(f"  {t:<22} (missing)")

    print("\n=== vintages ===")
    _print_rows(con.execute(
        "SELECT id, status, run_uid, is_provisional, n_collection_days, "
        "       round(reference_factor::numeric, 8) AS factor "
        "FROM index_run ORDER BY id DESC LIMIT 5").fetchall())

    run = con.execute(
        "SELECT id FROM index_run WHERE status='PUBLISHED'").fetchone()
    if not run:
        print("\n  no PUBLISHED vintage")
        return
    rid = run["id"]

    print("\n=== headline series (APIX.ALL) ===")
    _print_rows(con.execute(
        "SELECT period_start, round(level::numeric,4) AS level, "
        "       n_cells, n_cells_imputed, left(repro_hash, 20) AS hash "
        "FROM index_point WHERE index_run_id=%s AND series_id='APIX.ALL' "
        "ORDER BY period_start", (rid,)).fetchall())

    print("\n=== series catalogue (by kind) ===")
    _print_rows(con.execute(
        "SELECT kind, COUNT(*)::int AS n, "
        "       round(SUM(weight_share)::numeric, 6) AS total_share "
        "FROM series WHERE index_run_id=%s GROUP BY kind ORDER BY kind",
        (rid,)).fetchall())

    print("\n=== top routes by weight ===")
    _print_rows(con.execute(
        "SELECT s.series_id, round(s.weight_share::numeric,6) AS share, "
        "       round(p.level::numeric,2) AS latest_level "
        "FROM series s "
        "LEFT JOIN index_point p ON p.index_run_id=s.index_run_id "
        "  AND p.series_id=s.series_id "
        "  AND p.period_start=(SELECT MAX(period_start) FROM index_point "
        "                      WHERE index_run_id=s.index_run_id AND series_id=s.series_id) "
        "WHERE s.index_run_id=%s AND s.kind='route' "
        "ORDER BY s.weight_share DESC LIMIT 8", (rid,)).fetchall())

    print("\n=== collection days ===")
    _print_rows(con.execute(
        "SELECT obs_date, n_cells, first_ist, last_ist, array_length(run_ids,1) AS n_runs "
        "FROM collection_day_stat WHERE index_run_id=%s ORDER BY obs_date",
        (rid,)).fetchall())

    print("\n=== screening flags ===")
    _print_rows(con.execute(
        "SELECT flag, COUNT(*)::int AS n FROM observation_flag "
        "WHERE index_run_id=%s GROUP BY flag", (rid,)).fetchall())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sql", help="run an arbitrary read-only query instead")
    args = ap.parse_args()

    with pg.connect() as con:
        con.execute("SET TRANSACTION READ ONLY")
        if args.sql:
            _print_rows(con.execute(args.sql).fetchall())
        else:
            overview(con)
    return 0


if __name__ == "__main__":
    sys.exit(main())
