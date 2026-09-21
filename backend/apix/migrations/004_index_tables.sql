-- Tables that make a published index number reproducible.
--
-- The question a statistical office actually asks is "can you reproduce the
-- number you published on 11 September?". Today the answer is no: the series
-- exists only as a regenerated JSON file, with no vintages, no revision log and
-- no link from a published number back to the rows it came from.
--
-- The design rule below is that the LINK is immutable and the LEVEL is a view.
-- A level is just links multiplied by a reference factor, so re-referencing the
-- series (when the base window grows from 3 days to 28) creates a new vintage
-- without revising a single historical link.

CREATE TABLE IF NOT EXISTS weight_set (
    id                     INTEGER PRIMARY KEY,
    name                   TEXT NOT NULL UNIQUE,
    weight_reference       TEXT,          -- e.g. 'DGCA CY2025 pax x base-window fare'
    price_reference_window TEXT,          -- JSON array of dates
    method                 TEXT,          -- how within-cell weights were derived
    band_scheme_json       TEXT,
    source_json            TEXT,
    created_at             TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS weight (
    weight_set_id  INTEGER NOT NULL REFERENCES weight_set(id),
    level          TEXT NOT NULL,          -- ROUTE | LEAD | CELL
    key            TEXT NOT NULL,
    parent_key     TEXT,
    weight         REAL NOT NULL CHECK (weight >= 0),
    n_obs_base     INTEGER,
    mean_fare_base REAL,
    PRIMARY KEY (weight_set_id, level, key)
);

CREATE TABLE IF NOT EXISTS index_run (
    id               INTEGER PRIMARY KEY,
    run_uid          TEXT NOT NULL UNIQUE,
    computed_at      TIMESTAMP NOT NULL,
    code_version     TEXT,
    git_sha          TEXT,
    weight_set_id    INTEGER NOT NULL REFERENCES weight_set(id),
    config_json      TEXT NOT NULL,        -- bands, k, caps, lead weights, adjustments
    reference_factor REAL NOT NULL,
    reference_label  TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
    n_obs_in         INTEGER,
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS index_point (
    index_run_id     INTEGER NOT NULL REFERENCES index_run(id),
    series_id        TEXT NOT NULL,
    freq             TEXT NOT NULL CHECK (freq IN ('D','W','M')),
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    level            REAL NOT NULL CHECK (level > 0),
    link             REAL CHECK (link IS NULL OR link > 0),   -- NULL only at the anchor
    n_cells          INTEGER,
    n_cells_imputed  INTEGER,
    n_cells_thin     INTEGER,
    n_cells_dead     INTEGER,
    n_items_matched  INTEGER,
    n_items_prev     INTEGER,
    n_items_screened INTEGER,
    weight_covered   REAL,
    weight_imputed   REAL,
    n_days           INTEGER,
    is_provisional   INTEGER NOT NULL DEFAULT 0,
    quality_json     TEXT,
    PRIMARY KEY (index_run_id, series_id, freq, period_start)
);

-- Cell-level reproducibility: every published number traces to exact rows.
CREATE TABLE IF NOT EXISTS elementary_index (
    index_run_id       INTEGER NOT NULL REFERENCES index_run(id),
    obs_date           DATE NOT NULL,
    origin             TEXT NOT NULL,
    destination        TEXT NOT NULL,
    lead_time_days     INTEGER NOT NULL,
    carrier            TEXT NOT NULL,
    dep_band           TEXT NOT NULL,
    link               REAL,
    level              REAL,
    weight             REAL,
    n_matched          INTEGER,
    n_prev             INTEGER,
    n_cur              INTEGER,
    n_screened         INTEGER,
    is_imputed         INTEGER NOT NULL DEFAULT 0,
    imputation_source  TEXT,
    imputation_run_len INTEGER,
    quality            TEXT,
    selected_run_id    TEXT,
    PRIMARY KEY (index_run_id, obs_date, origin, destination,
                 lead_time_days, carrier, dep_band)
);

-- Outlier and quality flags. Nothing is ever deleted from fare_observation;
-- screening is recorded here and is reproducible from the same inputs.
CREATE TABLE IF NOT EXISTS observation_flag (
    index_run_id   INTEGER NOT NULL REFERENCES index_run(id),
    observation_id INTEGER NOT NULL REFERENCES fare_observation(id),
    flag           TEXT NOT NULL,
    detail         TEXT,
    PRIMARY KEY (index_run_id, observation_id, flag)
);

CREATE INDEX IF NOT EXISTS ix_point_series ON index_point(series_id, freq, period_start);
CREATE INDEX IF NOT EXISTS ix_elem_date    ON elementary_index(obs_date);
