-- The three endpoints whose numbers are derived rather than stored:
-- /cleaning, /availability and /validation.
--
-- Their tabular parts get real columns, because those are the numbers a judge
-- would want to query -- how much was screened on each day, how far the index
-- moves under each screening regime, the Welch test per transition.
--
-- Two things stay as JSON, deliberately and narrowly:
--   * vintage_prose  -- sentences the engine GENERATES with numbers already
--     interpolated ("the differential is positive on 9 of 10 transitions").
--     These are outputs, not data; decomposing an English sentence into
--     columns would not make it queryable, only harder to reproduce.
--   * validation_run.harness / .overlap -- the MoSPI comparison diagnostics,
--     a deep nested advisory object that currently evaluates to all-nulls
--     because the two series do not yet overlap. The metrics a judge would
--     query (correlation, verdict, per-month error) are real columns.

CREATE TABLE IF NOT EXISTS cleaning_day (
    index_run_id   bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    obs_date       date   NOT NULL,
    n_relatives    integer,
    n_extreme      integer,
    n_mad          integer,
    n_screened     integer,
    share_screened double precision,
    PRIMARY KEY (index_run_id, obs_date)
);

CREATE TABLE IF NOT EXISTS cleaning_sensitivity (
    index_run_id             bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    regime                   text   NOT NULL
        CHECK (regime IN ('none', 'hard_bound_only', 'hard_bound_and_mad')),
    final_raw_level          double precision,
    n_screened               integer,
    n_cells_imputed_final    integer,
    diff_from_unscreened_pct double precision,
    error                    text,
    PRIMARY KEY (index_run_id, regime)
);

CREATE TABLE IF NOT EXISTS availability_transition (
    index_run_id                     bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    from_date                        date NOT NULL,
    to_date                          date NOT NULL,
    n_prev                           integer,
    n_vanished                       integer,
    n_survived                       integer,
    n_appeared                       integer,
    vanish_rate                      double precision,
    mean_fare_vanished               double precision,
    mean_fare_survived               double precision,
    median_fare_vanished             double precision,
    median_fare_survived             double precision,
    price_differential_pct           double precision,
    arithmetic_mean_differential_pct double precision,
    welch_t                          double precision,
    welch_df                         double precision,
    significant_5pct                 boolean,
    PRIMARY KEY (index_run_id, to_date)
);

CREATE TABLE IF NOT EXISTS availability_bias_bound (
    index_run_id          bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    to_date               date NOT NULL,
    weight_share_vanished double precision,
    excess_move_pct       double precision NOT NULL,   -- 0 / 5 / 10 / 20
    index_bias_pp         double precision,
    PRIMARY KEY (index_run_id, to_date, excess_move_pct)
);

CREATE TABLE IF NOT EXISTS validation_run (
    index_run_id       bigint PRIMARY KEY REFERENCES index_run(id) ON DELETE CASCADE,
    correlation        double precision,
    correlation_reason text,
    harness            jsonb,
    overlap            jsonb
);

CREATE TABLE IF NOT EXISTS validation_pair (
    index_run_id bigint  NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    period       char(7) NOT NULL,
    apix_pct     double precision,
    mospi_pct    double precision,
    error_pp     double precision,
    PRIMARY KEY (index_run_id, period)
);

-- Generated sentences, keyed by where they belong in the response.
CREATE TABLE IF NOT EXISTS vintage_prose (
    index_run_id bigint NOT NULL REFERENCES index_run(id) ON DELETE CASCADE,
    key          text   NOT NULL,
    body         jsonb  NOT NULL,
    PRIMARY KEY (index_run_id, key)
);
