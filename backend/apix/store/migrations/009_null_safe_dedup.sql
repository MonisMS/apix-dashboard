-- Make the daily sync idempotent for rows with a NULL in the natural key.
--
-- 001_raw.sql mirrored SQLite's behaviour: NULLs are distinct in a unique
-- index, so two rows that differ only by a NULL never conflict. That was the
-- right call for the one-time backfill, which had to reproduce exactly which
-- rows SQLite had collapsed.
--
-- It is the wrong call for the daily sync. That path inserts without ids and
-- relies on ON CONFLICT DO NOTHING against this key, so a row with a NULL
-- carrier or flight_number -- both nullable, both part of the key -- conflicts
-- with nothing and is inserted again on every re-run. A retried workflow
-- would duplicate those rows. The index is unaffected (its standing filters
-- require both columns non-null), but /collection counts and /split would
-- double-count.
--
-- Verified safe before applying: no existing row has a NULL in either column,
-- and grouping the whole table with NULLs treated as equal produces zero
-- collisions, so nothing is lost by tightening this.
--
-- Replaces the constraint with an equivalent unique index. Code uses a bare
-- ON CONFLICT DO NOTHING, which matches any unique index, so nothing that
-- named the constraint breaks.

ALTER TABLE fare_observation DROP CONSTRAINT IF EXISTS uq_fare_observation;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fare_observation
    ON fare_observation (origin, destination, departure_date, lead_time_days,
                         carrier, flight_number, total_fare, source, collected_at)
    NULLS NOT DISTINCT;

-- collection_run needs no equivalent: every column in its natural key is
-- NOT NULL, so the two behaviours already coincide there.
