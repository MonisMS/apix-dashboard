-- data/tariff_sheets.json carries 245 rows but only 235 distinct
-- (airline, city_a, city_b, bound) combinations: some markets appear twice.
-- The unique constraint silently collapsed those ten, and /tariffs publishes
-- n_rows, so the count came out wrong.
--
-- reference.py keeps every row and lets a later duplicate win when folding
-- markets together, so the table has to keep them too.
ALTER TABLE tariff_row DROP CONSTRAINT IF EXISTS tariff_row_airline_city_a_city_b_bound_key;
