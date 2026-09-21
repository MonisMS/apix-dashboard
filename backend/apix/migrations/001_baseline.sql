-- Records the schema as it stood before the index rebuild (12 Sep 2026).
-- No DDL: the tables already exist, created by db.py's executescript(SCHEMA).
-- This migration exists so that version 1 means "the shape the first 5,141
-- observations were collected into", and every later change is a numbered,
-- dated step away from it.
SELECT 1;
