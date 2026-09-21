-- Two things the drill-down endpoints need that 002 did not store.

-- route_list and carrier_list publish the day-on-day change of each sub-series.
-- It is produced by series_from_predicate (rounded to 4dp, Python semantics),
-- so it is stored rather than recomputed with LAG() in SQL -- Postgres rounds
-- half-away-from-zero where Python rounds half-to-even, and the two disagree
-- exactly at ties.
ALTER TABLE index_point
    ADD COLUMN IF NOT EXISTS pct_change_1p double precision;

-- route_detail's by_lead_window block is a series per (route, lead) pair --
-- 12 x 5 -- which is neither a route series nor a window series.
ALTER TABLE series DROP CONSTRAINT IF EXISTS series_kind_check;
ALTER TABLE series ADD CONSTRAINT series_kind_check
    CHECK (kind IN ('headline', 'route', 'carrier', 'window', 'naive', 'route_window'));
