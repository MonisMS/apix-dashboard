"""Storage for APIx fare observations.

Design rules, learned from auditing a rival build that broke all of them:
  1. Only store what we observed. Never fabricate a field to fill a column.
  2. total_fare is the observed number. Fee components stay NULL unless the
     source actually gave them to us.
  3. Every row records where it came from and whether it was observed.
  4. A UNIQUE key prevents the same quote being counted twice.
  5. Timestamps are real dates, not strings.
"""
import sqlite3, pathlib, datetime, os

# APIX_DB lets CI smoke-test the whole path into a throwaway file, so a
# plumbing check can never add a stray scrape to the real price series.
DB = pathlib.Path(os.getenv("APIX_DB")
                  or pathlib.Path(__file__).parent / "data" / "apix.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS fare_observation (
    id                INTEGER PRIMARY KEY,
    -- what was priced
    origin            TEXT    NOT NULL,
    destination       TEXT    NOT NULL,
    departure_date    DATE    NOT NULL,
    lead_time_days    INTEGER NOT NULL,   -- 1, 7, 15, 30 or 45
    carrier           TEXT,
    flight_number     TEXT,               -- NULL if source didn't give one
    fare_class        TEXT,
    -- the money (total_fare is the ONLY guaranteed-observed amount)
    total_fare        REAL    NOT NULL,
    currency          TEXT    NOT NULL DEFAULT 'INR',
    base_fare         REAL,               -- NULL unless source broke it out
    taxes             REAL,
    udf               REAL,
    convenience_fee   REAL,
    -- availability: sold-out is NOT the same as absent
    availability      TEXT,               -- AVAILABLE / SOLD_OUT / UNKNOWN
    seats_left        INTEGER,
    -- provenance
    source            TEXT    NOT NULL,   -- adapter name
    source_url        TEXT,
    collected_at      TIMESTAMP NOT NULL,
    is_observed       INTEGER NOT NULL DEFAULT 1,  -- 0 only if modelled
    notes             TEXT,
    UNIQUE (origin, destination, departure_date, lead_time_days,
            carrier, flight_number, total_fare, source, collected_at)
);
CREATE INDEX IF NOT EXISTS ix_route   ON fare_observation(origin, destination);
CREATE INDEX IF NOT EXISTS ix_dep     ON fare_observation(departure_date);
CREATE INDEX IF NOT EXISTS ix_lead    ON fare_observation(lead_time_days);
CREATE INDEX IF NOT EXISTS ix_coll    ON fare_observation(collected_at);

-- One row per attempted (route, lead time) fetch, success or failure.
-- This is what lets us report honest coverage instead of pretending 100%.
CREATE TABLE IF NOT EXISTS collection_run (
    id             INTEGER PRIMARY KEY,
    run_id         TEXT NOT NULL,
    origin         TEXT NOT NULL,
    destination    TEXT NOT NULL,
    lead_time_days INTEGER NOT NULL,
    departure_date DATE NOT NULL,
    source         TEXT NOT NULL,
    status         TEXT NOT NULL,   -- OK / NO_DATA / BLOCKED / ERROR
    n_quotes       INTEGER NOT NULL DEFAULT 0,
    elapsed_ms     INTEGER,
    error          TEXT,
    started_at     TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_run ON collection_run(run_id);
"""

def connect():
    """Open the database, creating and migrating it if necessary.

    SCHEMA below is the v1 baseline -- the shape the first observations were
    collected into. Everything since is a numbered migration, so a brand-new
    database is created at v1 and then brought forward by the same steps that
    the real one went through. Without this a fresh DB (the CI smoke test, a
    teammate's clone) would be born at v1 and every write of a post-v1 column
    would fail.
    """
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, detect_types=sqlite3.PARSE_DECLTYPES)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    con.commit()
    try:
        from . import migrate
    except ImportError:
        import migrate
    migrate.migrate(DB, verbose=False)
    return con

def save_quotes(con, quotes, run_id=None):
    """Insert observations. Duplicates are ignored, never double-counted.

    `run_id` ties every row to the sweep that fetched it. The index layer needs
    it: a collection day can be the union of several partial sweeps (2026-09-10
    was four), so choosing which sweep counts has to happen per cell, and that
    is impossible without knowing which sweep a row came from.

    Rows also carry departure_time / dep_band / is_nonstop directly now, rather
    than leaving the index to parse them back out of the free-text `notes`. An
    adapter that changed its note string used to silently empty the index.
    """
    # collect.py runs as `python apix/collect.py` and does a bare `import db`,
    # so this module is sometimes a top-level module and sometimes apix.db.
    # Support both rather than forcing a change to the collector, which is the
    # one thing that must keep working every day.
    try:
        from .index.spec import band, parse_departure, parse_nonstop
    except ImportError:
        from index.spec import band, parse_departure, parse_nonstop

    n = 0
    for q in quotes:
        row = dict(q)
        row.setdefault("run_id", run_id)
        # Prefer a value the adapter observed; fall back to the note text.
        dep_time = row.get("departure_time") or parse_departure(row.get("notes"))
        row["departure_time"] = dep_time
        row["dep_band"] = row.get("dep_band") or band(dep_time)
        if row.get("is_nonstop") is None:
            row["is_nonstop"] = parse_nonstop(row.get("notes"))
        row.setdefault("stops", 0 if row["is_nonstop"] else None)
        row.setdefault("fuel_charge_yq", None)
        # fare_class and availability are asserted by the adapter, not observed.
        row.setdefault("is_observed_fare_class", 0)
        row.setdefault("is_observed_availability", 0)
        try:
            cur = con.execute("""INSERT OR IGNORE INTO fare_observation
                (origin,destination,departure_date,lead_time_days,carrier,
                 flight_number,fare_class,total_fare,currency,base_fare,taxes,
                 udf,convenience_fee,availability,seats_left,source,source_url,
                 collected_at,is_observed,notes,departure_time,dep_band,
                 is_nonstop,stops,run_id,fuel_charge_yq,
                 is_observed_fare_class,is_observed_availability)
                VALUES (:origin,:destination,:departure_date,:lead_time_days,
                 :carrier,:flight_number,:fare_class,:total_fare,:currency,
                 :base_fare,:taxes,:udf,:convenience_fee,:availability,
                 :seats_left,:source,:source_url,:collected_at,:is_observed,
                 :notes,:departure_time,:dep_band,:is_nonstop,:stops,:run_id,
                 :fuel_charge_yq,:is_observed_fare_class,
                 :is_observed_availability)""", row)
            # cur.rowcount is per-statement: 1 if this row inserted, 0 if it was
            # ignored as a duplicate. The old code used con.total_changes, which
            # is cumulative for the connection and so is truthy forever after
            # the first insert -- it reported every subsequent row as new.
            n += cur.rowcount
        except sqlite3.Error as e:
            print(f"  ! insert failed: {e}")
    con.commit()
    return n

def log_run(con, **kw):
    con.execute("""INSERT INTO collection_run
        (run_id,origin,destination,lead_time_days,departure_date,source,
         status,n_quotes,elapsed_ms,error,started_at)
        VALUES (:run_id,:origin,:destination,:lead_time_days,:departure_date,
         :source,:status,:n_quotes,:elapsed_ms,:error,:started_at)""", kw)
    con.commit()

def summary(con):
    c = con.cursor()
    obs = c.execute("SELECT COUNT(*) FROM fare_observation").fetchone()[0]
    days = c.execute("SELECT COUNT(DISTINCT DATE(collected_at)) FROM fare_observation").fetchone()[0]
    routes = c.execute("SELECT COUNT(DISTINCT origin||destination) FROM fare_observation").fetchone()[0]
    rng = c.execute("SELECT MIN(DATE(collected_at)), MAX(DATE(collected_at)) FROM fare_observation").fetchone()
    return {"observations": obs, "collection_days": days, "routes": routes,
            "first": rng[0], "last": rng[1]}

if __name__ == "__main__":
    con = connect()
    print(f"Database ready: {DB}")
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print(f"Tables: {tables}")
    print(f"Current state: {summary(con)}")
