"""Disappearance analysis, and the gate on any sold-out claim."""
import pytest

from apix.index.availability import (bias_bound, disappearance,
                                     observed_availability)
from apix.index.model import CellKey, ItemKey, Observation


def obs(date, flight, fare, lead=7, o="DEL", d="BOM", carrier="6E"):
    return Observation(obs_date=date, item=ItemKey(o, d, lead, carrier, flight),
                       dep_band="MD", total_fare=fare, observation_id=0)


def test_vanished_and_survived_are_separated():
    days = {
        "d1": [obs("d1", "A", 5000.0), obs("d1", "B", 9000.0)],
        "d2": [obs("d2", "A", 5200.0), obs("d2", "C", 7000.0)],
    }
    t = disappearance(days)["transitions"][0]
    assert t["n_vanished"] == 1 and t["n_survived"] == 1 and t["n_appeared"] == 1
    assert t["vanish_rate"] == 0.5


def test_headline_differential_is_computed_in_log_space():
    """A ratio claim belongs in log space, and it is the tested quantity.

    On real data the arithmetic mean and the log difference disagreed sharply
    (+1.2% vs -0.1%, with the median negative) because a few very high fares drag
    the mean. Quoting the arithmetic ratio would read an outlier as a pattern.
    """
    days = {
        "d1": [obs("d1", "GONE", 10000.0)] + [obs("d1", f"S{i}", 5000.0) for i in range(4)],
        "d2": [obs("d2", f"S{i}", 5000.0) for i in range(4)],
    }
    t = disappearance(days)["transitions"][0]
    assert t["price_differential_pct"] == pytest.approx(100.0, abs=0.01)
    assert "arithmetic_mean_differential_pct" in t


def test_inconsistent_direction_is_reported_as_inconsistent():
    """Two transitions pointing opposite ways must not be summarised as a trend."""
    days = {
        "d1": [obs("d1", "X", 20000.0)] + [obs("d1", f"S{i}", 5000.0) for i in range(5)],
        "d2": [obs("d2", "Y", 1000.0)] + [obs("d2", f"S{i}", 5000.0) for i in range(5)],
        "d3": [obs("d3", f"S{i}", 5000.0) for i in range(5)],
    }
    d = disappearance(days)
    assert d["n_transitions"] == 2
    assert d["direction_consistent"] is False
    assert "not consistent" in d["reading"]


def test_reading_always_says_the_cause_is_unobservable():
    days = {
        "d1": [obs("d1", "A", 5000.0), obs("d1", "B", 9000.0)],
        "d2": [obs("d2", "A", 5200.0)],
    }
    assert "Cause is unobservable" in disappearance(days)["reading"]


def test_bias_bound_scales_with_the_weight_that_vanished():
    cell = CellKey("DEL", "BOM", 7, "6E", "MD")
    days = {
        "d1": [obs("d1", "A", 5000.0), obs("d1", "B", 5000.0)],
        "d2": [obs("d2", "A", 5100.0)],
    }
    b = bias_bound(days, {cell: 1.0}, excess_moves=(0.0, 10.0))
    row = b["per_day"][0]
    assert row["weight_share_vanished"] == pytest.approx(0.5)   # 1 of 2 items
    assert row["index_bias_pp"]["0.0%"] == 0.0
    assert row["index_bias_pp"]["10.0%"] == pytest.approx(5.0)
    assert "sensitivity, not an estimate" in b["note"]


def test_no_sold_out_claim_while_availability_is_asserted(tmp_path):
    """The gate. While nothing is observed, the claim is refused.

    Every row currently reads AVAILABLE because the adapter writes it, not
    because a flight was checked. Sold-out is indistinguishable from
    not-collected, and the deck must not say otherwise.
    """
    import sqlite3
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("""CREATE TABLE fare_observation (
        availability TEXT, is_observed_availability INTEGER, seats_left INTEGER)""")
    con.executemany("INSERT INTO fare_observation VALUES ('AVAILABLE', 0, NULL)",
                    [()] * 5)
    a = observed_availability(con)
    assert a["can_claim_sold_out_detection"] is False
    assert a["share_observed"] == 0.0
    assert "no sold-out detection may be claimed" in a["statement"]


def test_claim_is_allowed_once_availability_is_actually_observed(tmp_path):
    import sqlite3
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("""CREATE TABLE fare_observation (
        availability TEXT, is_observed_availability INTEGER, seats_left INTEGER)""")
    con.execute("INSERT INTO fare_observation VALUES ('SOLD_OUT', 1, 0)")
    con.execute("INSERT INTO fare_observation VALUES ('AVAILABLE', 1, 3)")
    a = observed_availability(con)
    assert a["can_claim_sold_out_detection"] is True
    assert a["share_observed"] == 1.0
