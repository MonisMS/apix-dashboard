"""One-time load of the SQLite series into Neon.

    APIX_PG_URL=postgresql://... python3 -m apix.store.backfill_pg \
        --sqlite /home/monis/sih2026/apix/data/apix.db

Row ids are preserved, because observation_flag and index_observation will
reference them later. The identity sequences are advanced afterwards, so the
first new insert does not collide.

Idempotent: rows conflicting on the natural key are skipped, so a re-run after
a partial load finishes the job rather than duplicating it.
"""
import argparse
import datetime
import sqlite3
import sys

from . import pg

UTC = datetime.timezone.utc

OBS_COLS = [
    "id", "origin", "destination", "departure_date", "lead_time_days",
    "carrier", "flight_number", "fare_class", "total_fare", "currency",
    "base_fare", "taxes", "udf", "convenience_fee", "availability",
    "seats_left", "source", "source_url", "collected_at", "is_observed",
    "notes", "departure_time", "dep_band", "is_nonstop", "stops", "run_id",
    "fuel_charge_yq", "is_observed_fare_class", "is_observed_availability",
]
OBS_BOOL = {"is_observed", "is_nonstop", "is_observed_fare_class",
            "is_observed_availability"}
OBS_TS = {"collected_at"}
OBS_DATE = {"departure_date"}

RUN_COLS = [
    "id", "run_id", "origin", "destination", "lead_time_days",
    "departure_date", "source", "status", "n_quotes", "elapsed_ms", "error",
    "started_at",
]
RUN_TS = {"started_at"}
RUN_DATE = {"departure_date"}


def _ts(v):
    """Naive-UTC text -> aware UTC datetime. The DB stores no offset."""
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    s = str(v).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    raise ValueError(f"unparseable timestamp: {v!r}")


def _date(v):
    if v is None:
        return None
    if isinstance(v, datetime.date) and not isinstance(v, datetime.datetime):
        return v
    return datetime.date.fromisoformat(str(v)[:10])


def _convert(row, cols, bools, tss, dates):
    out = []
    for c in cols:
        v = row[c]
        if c in bools:
            out.append(None if v is None else bool(v))
        elif c in tss:
            out.append(_ts(v))
        elif c in dates:
            out.append(_date(v))
        else:
            out.append(v)
    return tuple(out)


def load_table(sq, con, table, cols, bools, tss, dates, batch=5000, keep_ids=True):
    """Copy rows from SQLite into Neon.

    keep_ids matters more than it looks.

    A one-time backfill preserves row ids, because observation_flag and
    index_observation reference fare_observation(id) and those links have to
    survive the move.

    A daily sync must NOT. The collector writes into a fresh scratch database
    whose ids restart at 1, so preserving them would collide with existing
    Neon rows on the primary key -- and ON CONFLICT DO NOTHING would then
    discard the new fares while reporting success. Instead the id is omitted,
    Postgres assigns a new one, and deduplication happens where it should:
    on the natural key.
    """
    sq.row_factory = sqlite3.Row
    if not keep_ids:
        cols = [c for c in cols if c != "id"]
    total = sq.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    collist = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))

    done = 0
    cur = sq.execute(f"SELECT {collist} FROM {table} ORDER BY id")
    with con.cursor() as pgcur:
        while True:
            rows = cur.fetchmany(batch)
            if not rows:
                break
            values = [_convert(r, cols, bools, tss, dates) for r in rows]
            # ON CONFLICT DO NOTHING mirrors SQLite's INSERT OR IGNORE and
            # makes a re-run safe; executemany keeps that behaviour, which a
            # bare COPY could not.
            pgcur.executemany(
                f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
                f"ON CONFLICT DO NOTHING",
                values,
            )
            done += len(rows)
            print(f"    {table}: {done}/{total}", end="\r", flush=True)
    con.commit()
    print(f"    {table}: {done}/{total} loaded      ")


def present_in_neon(sq, con, table, cols) -> tuple[int, int]:
    """How many of the SQLite rows can be found in Neon, by natural key.

    Counting rows per table would be wrong for a daily sync -- Neon holds the
    whole history and the scratch database holds one day -- so the check is a
    subset test: every row we just tried to load must be findable.
    """
    key = [c for c in cols if c != "id"]
    rows = sq.execute(f"SELECT {', '.join(key)} FROM {table}").fetchall()
    if not rows:
        return 0, 0
    found = 0
    for r in rows:
        where = " AND ".join(
            f"{c} IS NOT DISTINCT FROM %s" for c in key
        )
        vals = _convert(r, key,
                        OBS_BOOL if table == "fare_observation" else set(),
                        OBS_TS if table == "fare_observation" else RUN_TS,
                        OBS_DATE if table == "fare_observation" else RUN_DATE)
        hit = con.execute(
            f"SELECT 1 FROM {table} WHERE {where} LIMIT 1", vals).fetchone()
        if hit:
            found += 1
    return found, len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    ap.add_argument(
        "--preserve-ids", action="store_true",
        help="One-time full backfill: keep SQLite row ids so flag/observation "
             "links survive. Omit for the daily sync from a scratch database.")
    ap.add_argument("--no-verify", action="store_true",
                    help="Skip the per-row subset check (slow on a full load).")
    args = ap.parse_args()

    sq = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True)
    sq.row_factory = sqlite3.Row

    mode = "full (preserving ids)" if args.preserve_ids else "incremental"
    with pg.connect() as con:
        print(f"  loading raw tables -- {mode} ...")
        load_table(sq, con, "fare_observation", OBS_COLS, OBS_BOOL, OBS_TS,
                   OBS_DATE, keep_ids=args.preserve_ids)
        load_table(sq, con, "collection_run", RUN_COLS, set(), RUN_TS,
                   RUN_DATE, keep_ids=args.preserve_ids)

        if args.preserve_ids:
            # Explicit ids were supplied; advance the sequences or the next
            # insert collides on the primary key.
            for t in ("fare_observation", "collection_run"):
                con.execute(
                    f"SELECT setval(pg_get_serial_sequence('{t}','id'), "
                    f"COALESCE((SELECT MAX(id) FROM {t}), 1))")
        con.commit()

        print("  verifying ...")
        failed = False
        for t, cols in (("fare_observation", OBS_COLS), ("collection_run", RUN_COLS)):
            n_pg = con.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
            if args.no_verify:
                print(f"    {t}: neon={n_pg} (subset check skipped)")
                continue
            found, n_sq = present_in_neon(sq, con, t, cols)
            ok = found == n_sq
            failed |= not ok
            print(f"    {t}: {found}/{n_sq} source rows present in Neon "
                  f"(neon total {n_pg})  {'ok' if ok else 'MISSING ROWS'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
