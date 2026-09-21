"""The elementary stage, checked against MoSPI's own published arithmetic.

Expert Group Report on Comprehensive Updation of CPI, January 2026, section
4.6.6 "Practical examples of index compilation during various scenarios",
pp. 57-60.  Archived at refs/CPI_Expert_Group_Report_Jan2026.pdf.

These four examples are the reason this file exists.  If our engine reproduces
the government's own numbers to four decimal places, the Jevons implementation
and the imputation rule are not a matter of opinion.
"""
import math
import pytest

from apix.index.elementary import (chain, geometric_mean, jevons_from_prices,
                                   jevons_from_relatives, jevons_link)
from apix.index.impute import impute_price
from apix.index.model import ItemKey

# The five biscuit varieties MoSPI prices in Examples 1-4.
# (previous month, current month)
BISCUITS = [
    ("Parle-G Glucose",                 96.0, 100.0),
    ("Britannia Marie Gold",            91.0,  91.0),
    ("Parle Fab Bourbon",               83.0,  83.0),
    ("Britannia Treat Jim Jam",         40.0,  40.0),
    ("McVitie's Digestive",            150.0, 150.0),
]


def test_example_1_all_prices_available():
    """EG Example 1, p. 57: GM of relatives = 1.0082, index = 100.8198."""
    relatives = [cur / prev for _, prev, cur in BISCUITS]
    gm = jevons_from_relatives(relatives)
    assert round(gm, 4) == 1.0082
    assert round(chain(100.0, gm), 4) == 100.8198


def test_example_1_ratio_of_means_agrees():
    """Manual eq. 9.1 gives two forms; on a matched sample they are identical.

    This identity is what makes Jevons transitive, so it is worth pinning hard.
    """
    prev = [p for _, p, _ in BISCUITS]
    cur = [c for _, _, c in BISCUITS]
    assert jevons_from_prices(prev, cur) == pytest.approx(
        jevons_from_relatives([c / p for p, c in zip(prev, cur)]), abs=1e-12)


def test_example_2_missing_price_is_imputed():
    """EG Example 2, p. 58: item 3 missing.

    GM of the 4 available relatives = 1.0103, imputed price = 83 * 1.0103
    = 83.8514, and the revised index = 101.0258.  Note the imputed item's own
    relative then equals the imputation factor, so the GM over all five is
    unchanged -- the Manual's 8.55 equivalence, demonstrated by MoSPI itself.
    """
    available = [cur / prev for name, prev, cur in BISCUITS
                 if name != "Parle Fab Bourbon"]
    factor = jevons_from_relatives(available)
    assert round(factor, 4) == 1.0103

    imputed = impute_price(83.0, factor)
    assert round(imputed, 4) == 83.8514

    revised = available + [imputed / 83.0]
    assert round(chain(100.0, jevons_from_relatives(revised)), 4) == 101.0258


def test_example_3_specification_change_with_overlap():
    """EG Example 3, p. 59: index = 101.8084.

    The old specification is dropped outright and the replacement contributes
    its OWN month-on-month relative (100 -> 105), because both months are
    available for the new variety.  No quality adjustment is needed -- which is
    the whole point of the chain-base form (EG 4.6.5.2).
    """
    relatives = [cur / prev for name, prev, cur in BISCUITS
                 if name != "McVitie's Digestive"]
    relatives.append(105.0 / 100.0)
    assert round(chain(100.0, jevons_from_relatives(relatives)), 4) == 101.8084


def test_example_4_specification_change_without_overlap():
    """EG Example 4, p. 60: old spec imputed at 150 * 1.0103 = 151.5387.

    With no previous-month price for the replacement, the OLD specification is
    imputed for this month and the new one enters next month.  Index = 101.0258.
    """
    available = [cur / prev for name, prev, cur in BISCUITS
                 if name != "McVitie's Digestive"]
    factor = jevons_from_relatives(available)
    imputed = impute_price(150.0, factor)
    assert round(imputed, 4) == 151.5387

    revised = available + [imputed / 150.0]
    assert round(chain(100.0, jevons_from_relatives(revised)), 4) == 101.0258


# --- properties of the implementation itself -------------------------------

def test_geometric_mean_rejects_non_positive():
    """A zero fare must raise here, not silently zero out a cell.

    This is the guard that matters most after the rebuild: under the old min()
    a zero became the cell price, but under Jevons log(0) is undefined and would
    destroy the cell outright.
    """
    with pytest.raises(ValueError):
        geometric_mean([1.0, 0.0])
    with pytest.raises(ValueError):
        geometric_mean([1.0, -5.0])
    with pytest.raises(ValueError):
        geometric_mean([])
    with pytest.raises(ValueError):
        geometric_mean([1.0, float("nan")])


def test_jevons_link_requires_a_matched_sample():
    """No overlap must raise, never quietly return 1.0.

    A silent 1.0 is carry-forward wearing a different hat, and Manual 8.54
    prohibits carry-forward.
    """
    a = {ItemKey("DEL", "BOM", 7, "6E", "6E-2134"): 5000.0}
    b = {ItemKey("DEL", "BOM", 7, "6E", "6E-9999"): 5200.0}
    with pytest.raises(ValueError):
        jevons_link(a, b)


def test_jevons_is_transitive():
    """Chained short-term links equal the direct long-term index.

    Manual 8.383.  This is the property that lets us audit our own chain drift:
    any divergence between the chained and direct series on a CONSTANT sample is
    a bug, and on a changing sample it is exactly the drift caused by churn.
    """
    items = [ItemKey("DEL", "BOM", 7, "6E", f"6E-{i}") for i in range(5)]
    p0 = dict(zip(items, [5000.0, 6200.0, 4100.0, 9000.0, 7300.0]))
    p1 = dict(zip(items, [5300.0, 6000.0, 4400.0, 8700.0, 7900.0]))
    p2 = dict(zip(items, [5100.0, 6600.0, 4250.0, 9400.0, 7600.0]))

    l1, _ = jevons_link(p0, p1)
    l2, _ = jevons_link(p1, p2)
    chained = chain(chain(100.0, l1), l2)

    direct, _ = jevons_link(p0, p2)
    assert chained == pytest.approx(chain(100.0, direct), abs=1e-10)


def test_relative_change_is_symmetric_in_logs():
    """A doubling and a halving cancel -- the property that motivates Jevons."""
    assert jevons_from_relatives([2.0, 0.5]) == pytest.approx(1.0, abs=1e-15)
