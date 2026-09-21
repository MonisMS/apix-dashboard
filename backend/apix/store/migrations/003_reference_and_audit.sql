-- Reference data that currently lives in files, plus the precomputed blocks
-- for endpoints whose numbers are derived rather than stored.

-- apix/data/route_basket.json. Needed by coverage(): "routes in basket" has to
-- include routes that have no fares yet, which no query over observations can
-- tell you.
CREATE TABLE IF NOT EXISTS route_basket (
    origin              text NOT NULL,
    destination         text NOT NULL,
    city_a              text,
    city_b              text,
    pax_cy              bigint,
    national_share_pct  double precision,
    PRIMARY KEY (origin, destination)
);

CREATE TABLE IF NOT EXISTS basket_meta (
    k text PRIMARY KEY,
    v double precision
);

-- /index's naive_comparison: the deliberately-wrong unmatched mean-fare series
-- kept as a foil. Derived from the selected observations, so precomputed.
CREATE TABLE IF NOT EXISTS naive_point (
    index_run_id bigint  NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    period_start date    NOT NULL,
    level        double precision NOT NULL,
    n_obs        integer NOT NULL,
    PRIMARY KEY (index_run_id, period_start)
);

ALTER TABLE index_run
    ADD COLUMN IF NOT EXISTS naive_base_day    date,
    ADD COLUMN IF NOT EXISTS naive_divergence_pp double precision,
    -- cli.audit() transitivity block: three scalars, so /audit is a single row.
    ADD COLUMN IF NOT EXISTS audit_chained_raw_level double precision,
    ADD COLUMN IF NOT EXISTS audit_direct_fixed_base double precision,
    ADD COLUMN IF NOT EXISTS audit_drift_pct         double precision;

-- cli.audit() churn block, one row per collection day.
CREATE TABLE IF NOT EXISTS audit_churn (
    index_run_id  bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    obs_date      date   NOT NULL,
    items_matched integer,
    items_prev    integer,
    match_rate    double precision,
    cells_imputed integer,
    cells_thin    integer,
    PRIMARY KEY (index_run_id, obs_date)
);
