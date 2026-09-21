"""Stage 2 -- Young aggregation, and the properties that make it checkable."""
import pytest

from apix.index.aggregate import aggregate_subset, young_level, young_step
from apix.index.elementary import chain
from apix.index.model import CellKey, CellLink

A = CellKey("DEL", "BOM", 7, "6E", "MD")
B = CellKey("DEL", "BOM", 7, "AI", "MD")
C = CellKey("BLR", "DEL", 7, "6E", "EV")


def test_mospi_worked_combination():
    """EG 4.6.2.4, p. 53:  Combined Index = (w1*I1 + w2*I2) / (w1 + w2).

    Their own illustration of the higher-level rule.  With weights that already
    sum to 1 the division is a no-op, which is exactly our contract.
    """
    levels = {A: 110.0, B: 90.0}
    weights = {A: 0.6, B: 0.4}
    assert young_level(levels, weights) == pytest.approx(0.6 * 110 + 0.4 * 90)
    assert young_level(levels, weights) == pytest.approx(102.0)


def test_arithmetic_not_geometric():
    """The bug this rebuild exists to fix.

    Geometric <= arithmetic always, so the old single-stage collapse understated
    the index systematically rather than randomly.  Pin the gap so nobody
    "simplifies" the two stages back together.
    """
    import math
    levels = {A: 120.0, B: 80.0}
    weights = {A: 0.5, B: 0.5}
    arithmetic = young_level(levels, weights)
    geometric = math.exp(0.5 * math.log(120) + 0.5 * math.log(80))
    assert arithmetic == pytest.approx(100.0)
    assert geometric == pytest.approx(97.9795, abs=1e-4)
    assert arithmetic > geometric


def test_weights_must_sum_to_one():
    """Never renormalise silently -- that is an undeclared imputation.

    The previous implementation divided by whatever weight matched that day,
    which quietly changed the weight base every single day.
    """
    with pytest.raises(ValueError, match="sum to"):
        young_level({A: 100.0, B: 100.0}, {A: 0.3, B: 0.3})


def test_missing_weight_is_an_error_not_a_zero():
    with pytest.raises(KeyError):
        young_level({A: 100.0, B: 100.0}, {A: 1.0})


def test_chain_then_aggregate_equals_aggregate_then_chain():
    """CPI Manual 8.113: the two orders "give identical results".

    We implement aggregate-then-chain because it makes each cell's own level a
    storable number for the route drill-down.  This test IS the 8.113
    demonstration, and it is the one a methodologist will ask us to show.
    """
    weights = {A: 0.5, B: 0.3, C: 0.2}
    prev_levels = {A: 100.0, B: 100.0, C: 100.0}
    links = {A: CellLink(1.05, 4, 4, 4),
             B: CellLink(0.92, 3, 3, 3),
             C: CellLink(1.11, 6, 6, 6)}

    # aggregate-then-chain (what the engine does)
    agg_then_chain, _ = young_step(prev_levels, links, weights)

    # chain-then-aggregate: advance each cell, aggregate afterwards
    chained = {c: chain(prev_levels[c], links[c].link) for c in prev_levels}
    chain_then_agg = young_level(chained, weights)

    assert agg_then_chain == pytest.approx(chain_then_agg, abs=1e-10)


def test_young_step_requires_a_link_for_every_cell():
    """A cell with no link must be imputed upstream, not defaulted here."""
    weights = {A: 0.5, B: 0.5}
    with pytest.raises(KeyError, match="impute"):
        young_step({A: 100.0, B: 100.0}, {A: CellLink(1.0, 2, 2, 2)}, weights)


def test_subset_renormalises_and_reports_its_share():
    """A sub-index does not aggregate back to the headline; publish the share."""
    weights = {A: 0.5, B: 0.3, C: 0.2}
    levels = {A: 110.0, B: 90.0, C: 100.0}
    level, share = aggregate_subset(levels, weights, lambda c: c.route == ("DEL", "BOM"))
    assert share == pytest.approx(0.8)
    assert level == pytest.approx((0.5 * 110 + 0.3 * 90) / 0.8)
