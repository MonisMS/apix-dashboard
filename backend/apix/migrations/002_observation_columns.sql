-- Lift facts out of free text and into real columns.
--
-- The index previously identified non-stop flights with `notes LIKE 'nonstop%'`
-- and had no departure-time field at all, so MoSPI's cell specification
-- (route x airline x departure band x lead) could not be expressed. Worse, an
-- adapter changing its note string would silently empty the index.
--
-- 003 adds the CHECK constraints; adding columns first keeps each step small.

ALTER TABLE fare_observation ADD COLUMN departure_time TEXT;   -- 'HH:MM' IST
ALTER TABLE fare_observation ADD COLUMN dep_band       TEXT;   -- EM/MD/EV/NT
ALTER TABLE fare_observation ADD COLUMN is_nonstop     INTEGER;
ALTER TABLE fare_observation ADD COLUMN stops          INTEGER;
ALTER TABLE fare_observation ADD COLUMN run_id         TEXT;
ALTER TABLE fare_observation ADD COLUMN fuel_charge_yq REAL;

-- db.py rule 1 is "never fabricate a field to fill a column", but fare_class
-- and availability are hardcoded by the adapters rather than observed. Record
-- that distinction instead of letting an assertion masquerade as data.
ALTER TABLE fare_observation ADD COLUMN is_observed_fare_class   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fare_observation ADD COLUMN is_observed_availability INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_band ON fare_observation(dep_band);
CREATE INDEX IF NOT EXISTS ix_obs_run ON fare_observation(run_id);
