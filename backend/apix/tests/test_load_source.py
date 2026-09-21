"""The index is computed from one price source, and stays that way.

Regression test for a fault that reached the published series on 14 Sep 2026.
The database holds rows from more than one source by design: the daily feed
prices Google Flights' all-in offer, while the base-fare/tax study prices
Booking.com's `totalWithoutDiscount`. Those are different numbers for the same
flight.

`load_observations` selects the LATEST genuine run per cell. The split study
ran at 10:38, nine minutes after the 10:30 daily sweep, so it won that tiebreak
in every T+7 cell it covered -- the day fell from 625 cells to 580, imputation
rose from 56 to 101, and the index moved because of which platform's pricing
convention happened to be written last.
"""
import datetime
import sqlite3

import pytest

from apix.index.config import INDEX_SOURCE
from apix.index.load import load_observations

OTHER_SOURCE = "booking_com"

SCHEMA = """
CREATE TABLE fare_observation (
    id INTEGER PRIMARY KEY, origin TEXT, destination TEXT, departure_date DATE,
    lead_time_days INTEGER, carrier TEXT, flight_number TEXT, fare_class TEXT,
    total_fare REAL, currency TEXT, source TEXT, collected_at TIMESTAMP,
    is_observed INTEGER, dep_band TEXT, is_nonstop INTEGER, run_id TEXT);
CREATE TABLE collection_run (
    id INTEGER PRIMARY KEY, run_id TEXT, origin TEXT, destination TEXT,
    lead_time_days INTEGER, departure_date DATE, source TEXT, status TEXT,
    n_quotes INTEGER, elapsed_ms INTEGER, error TEXT, started_at TIMESTAMP);
"""


def make_db(rows):
    """rows: (flight_number, total_fare, source, collected_at, run_id)"""
    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA)
    for i, (flight, fare, source, at, run) in enumerate(rows):
        con.execute(
            "INSERT INTO fare_observation (id,origin,destination,departure_date,"
            "lead_time_days,carrier,flight_number,fare_class,total_fare,currency,"
            "source,collected_at,is_observed,dep_band,is_nonstop,run_id) "
            "VALUES (?,'DEL','BOM','2026-09-21',7,'IndiGo',?,'Economy',?,'INR',"
            "?,?,1,'MD',1,?)", (i + 1, flight, fare, source, at, run))
    # Two fetches per run, far enough apart to pass the genuineness screen.
    for run in {r[4] for r in rows}:
        for k in range(2):
            con.execute(
                "INSERT INTO collection_run (run_id,origin,destination,"
                "lead_time_days,departure_date,source,status,n_quotes,started_at)"
                " VALUES (?,'DEL','BOM',7,'2026-09-21','s','OK',1,?)",
                (run, f"2026-09-14 10:{30 + k * 5}:00"))
    con.commit()
    return con


def test_the_other_source_is_not_loaded():
    con = make_db([
        ("6E 111", 5000.0, INDEX_SOURCE, "2026-09-14 10:30:00", "daily"),
        ("6E 222", 9999.0, OTHER_SOURCE, "2026-09-14 10:38:00", "study"),
    ])
    days, report = load_observations(con)
    flights = {o.item.flight_number for o in days["2026-09-14"]}
    assert flights == {"6E 111"}
    assert report.n_rows_selected == 1


def test_a_later_study_does_not_displace_the_daily_sweep():
    """The exact 14 Sep failure: same cell, same flight, study written later."""
    con = make_db([
        ("6E 111", 5000.0, INDEX_SOURCE, "2026-09-14 10:30:00", "daily"),
        ("6E 111", 6561.0, OTHER_SOURCE, "2026-09-14 10:38:00", "study"),
    ])
    days, _ = load_observations(con)
    (o,) = days["2026-09-14"]
    assert o.total_fare == 5000.0          # the daily sweep, not the study
    # And the day is still one run, not two.
    assert len(days["2026-09-14"]) == 1


def test_later_sweep_of_the_SAME_source_still_wins():
    """The source filter must not break genuine re-sweep selection, which is
    what 10 Sep (four partial runs in one day) depends on."""
    con = make_db([
        ("6E 111", 5000.0, INDEX_SOURCE, "2026-09-14 10:30:00", "early"),
        ("6E 111", 5400.0, INDEX_SOURCE, "2026-09-14 16:00:00", "late"),
    ])
    days, _ = load_observations(con)
    (o,) = days["2026-09-14"]
    assert o.total_fare == 5400.0


def test_source_is_overridable_but_defaults_to_the_daily_feed():
    """A future reconciliation study needs to be able to load the other source
    deliberately. It must never happen by accident."""
    con = make_db([
        ("6E 111", 5000.0, INDEX_SOURCE, "2026-09-14 10:30:00", "daily"),
        ("6E 222", 6561.0, OTHER_SOURCE, "2026-09-14 10:38:00", "study"),
    ])
    days, _ = load_observations(con, source=OTHER_SOURCE)
    (o,) = days["2026-09-14"]
    assert o.total_fare == 6561.0
