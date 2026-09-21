-- /cleaning publishes flags in the order the screening pass produced them,
-- not sorted by observation_id. Without an ordinal the list comes back in
-- whatever order the index scan gives, which changes the published payload.
ALTER TABLE observation_flag ADD COLUMN IF NOT EXISTS ord integer;
CREATE INDEX IF NOT EXISTS ix_flag_ord ON observation_flag (index_run_id, ord);
