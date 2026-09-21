"""Outlier screening: that it screens movements, and that it screens few of them."""
import math

import pytest

from apix.index.clean import (log_relatives, screen, screen_extreme, screen_mad)
from apix.index.config import IndexConfig
from apix.index.model import ItemKey, Observation


def obs(date, flight, fare, lead=7, o="DEL", d="BOM", carrier="6E"):
    return Observation(obs_date=date,
                       item=ItemKey(o, d, lead, carrier, flight),
                       dep_band="MD", total_fare=fare,
                       observation_id=abs(hash((date, flight))) % 10000)


def test_relatives_are_computed_on_matched_items_only():
    prev = [obs("d1", "A", 100.0), obs("d1", "B", 200.0)]
    cur = [obs("d2", "A", 110.0), obs("d2", "C", 300.0)]
    rels = log_relatives(prev, cur)
    assert list(rels.values()) == [pytest.approx(math.log(1.1))]


def test_hard_bound_screens_a_tripling_not_a_large_but_real_move():
    """The threshold is about plausibility, not unusualness.

    A 50% overnight fall on a T+1 sector is ordinary airfare behaviour and must
    survive. A fare that quadruples overnight is far more likely to be a source
    defect than a price.
    """
    prev = [obs("d1", "REAL", 10000.0), obs("d1", "WILD", 5000.0)]
    cur = [obs("d2", "REAL", 5000.0), obs("d2", "WILD", 20000.0)]
    flagged = screen_extreme(log_relatives(prev, cur))
    names = {k.flight_number for k in flagged}
    assert names == {"WILD"}


def test_screening_is_on_movement_not_on_level():
    """An expensive fare that did not move is not an outlier.

    Screening on the level would delete costly routes -- a coverage decision
    dressed up as a quality one.
    """
    prev = [obs("d1", "PRICEY", 32000.0)]
    cur = [obs("d2", "PRICEY", 32000.0)]
    assert screen_extreme(log_relatives(prev, cur)) == {}


def test_mad_ignores_a_pool_with_no_dispersion():
    """If every flight moved identically there is nothing to be an outlier against."""
    prev = [obs("d1", f"F{i}", 5000.0) for i in range(20)]
    cur = [obs("d2", f"F{i}", 5500.0) for i in range(20)]
    assert screen_mad(log_relatives(prev, cur)) == {}


def test_mad_needs_a_pool_big_enough_to_judge():
    prev = [obs("d1", "A", 5000.0), obs("d1", "B", 5000.0)]
    cur = [obs("d2", "A", 5100.0), obs("d2", "B", 9000.0)]
    assert screen_mad(log_relatives(prev, cur), min_pool=10) == {}


def test_mad_is_off_by_default():
    """Measured, not assumed: on our own data a k=5 MAD band moves the published
    index by +4.55% by quarantining 357 of 2,791 matched flights -- erasing a
    genuine fare decline. The hard bound moves it 0.11%."""
    assert IndexConfig().screen_mad is False
    assert IndexConfig().screen_extreme is True


def test_screen_reports_what_it_did_and_why():
    days = {
        "d1": [obs("d1", "A", 5000.0), obs("d1", "B", 6000.0)],
        "d2": [obs("d2", "A", 5200.0), obs("d2", "B", 30000.0)],
    }
    screened, flags, report = screen(days, IndexConfig())
    assert screened["d2"] == frozenset({ItemKey("DEL", "BOM", 7, "6E", "B")})
    assert [f.flag for f in flags] == ["EXTREME_MOVE"]
    assert report["per_day"]["d2"]["n_extreme"] == 1
    # The report must carry the reason the MAD screen is off, not just the flag.
    assert "bias the index toward zero" in report["mad"]["why_default_off"]
    assert "quarantined" in report["treatment"]


def test_screened_items_are_quarantined_not_deleted():
    """They leave the matched sample; the row itself is untouched.

    chain.build_raw_series takes the screened set and the cell is then imputed
    from its siblings, so a screened observation reduces the sample without
    removing data or inventing a price.
    """
    from apix.index.elementary import cell_links
    prev = [obs("d1", "A", 5000.0), obs("d1", "B", 6000.0)]
    cur = [obs("d2", "A", 5200.0), obs("d2", "B", 30000.0)]
    wild = ItemKey("DEL", "BOM", 7, "6E", "B")

    unscreened = cell_links(prev, cur)
    screened_links = cell_links(prev, cur, screened=frozenset({wild}))
    cell = next(iter(unscreened))
    assert unscreened[cell].n_matched == 2
    assert screened_links[cell].n_matched == 1
    assert screened_links[cell].link == pytest.approx(5200 / 5000)
