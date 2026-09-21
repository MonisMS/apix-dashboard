"""Imputation, and the structural ban on carrying prices forward."""
import pathlib
import re

import pytest

from apix.index.impute import (impute_missing_cells, impute_price, parent_keys,
                               redistribute)
from apix.index.model import CellKey, CellLink

A = CellKey("DEL", "BOM", 7, "6E", "MD")
B = CellKey("DEL", "BOM", 7, "AI", "MD")
C = CellKey("DEL", "BOM", 15, "6E", "EV")
D = CellKey("BLR", "DEL", 7, "6E", "MD")


def test_imputed_price_moves_with_the_cell():
    """Manual 8.55 / EG 4.6.4.3: previous price times the observed movement."""
    assert impute_price(100.0, 1.05) == pytest.approx(105.0)
    assert impute_price(83.0, 1.0103) == pytest.approx(83.8549, abs=1e-4)


def test_imputation_is_never_carry_forward():
    """The behavioural half of the ban: a moving market must move the estimate."""
    assert impute_price(100.0, 1.05) != 100.0


def test_no_carry_forward_function_exists():
    """The structural half of the ban.

    Manual 8.54 calls carrying the last price forward "not an acceptable
    procedure".  The defence is that no such function exists to be called by
    accident: the only entry point takes a link and multiplies by it.
    """
    import apix.index.impute as impute
    names = [n for n in dir(impute) if not n.startswith("_")]
    assert not [n for n in names if "carry" in n.lower() or "forward" in n.lower()]

    src = pathlib.Path(impute.__file__).read_text()
    body = src.split('"""', 2)[-1]          # skip the module docstring
    # No statement may assign a previous price straight through.
    assert not re.search(r"return\s+previous_price\s*$", body, re.M)


def test_pure_modules_do_no_io():
    """elementary/aggregate/impute must stay testable without a database."""
    import apix.index.aggregate, apix.index.elementary, apix.index.impute
    for mod in (apix.index.elementary, apix.index.aggregate, apix.index.impute):
        src = pathlib.Path(mod.__file__).read_text()
        assert "import sqlite3" not in src, f"{mod.__name__} must not touch the DB"
        assert "open(" not in src, f"{mod.__name__} must not touch the filesystem"


def test_parent_ladder_order():
    assert [lvl for lvl, _ in parent_keys(A)] == ["ROUTE_LEAD", "ROUTE", "ALL"]


def test_missing_cell_imputed_from_its_route_lead_siblings():
    links = {B: CellLink(1.10, 3, 3, 3)}
    filled, dead = impute_missing_cells(dict(links), [A, B], {}, max_consecutive=5)
    assert not dead
    assert filled[A].is_imputed
    assert filled[A].imputation_source == "ROUTE_LEAD"
    assert filled[A].link == pytest.approx(1.10)
    assert filled[A].quality == "IMPUTED"


def test_imputation_falls_back_up_the_ladder():
    """No sibling at (route, lead) -> use the route; none there -> everything."""
    links = {C: CellLink(1.20, 2, 2, 2)}
    filled, _ = impute_missing_cells(dict(links), [A, C], {}, max_consecutive=5)
    assert filled[A].imputation_source == "ROUTE"

    links = {D: CellLink(0.90, 2, 2, 2)}
    filled, _ = impute_missing_cells(dict(links), [A, D], {}, max_consecutive=5)
    assert filled[A].imputation_source == "ALL"


def test_imputations_do_not_feed_other_imputations():
    """Only observed children set the factor, or an assumption compounds itself."""
    links = {B: CellLink(1.5, 0, 0, 0, is_imputed=True),
             C: CellLink(1.1, 3, 3, 3)}
    filled, _ = impute_missing_cells(dict(links), [A, B, C], {}, max_consecutive=5)
    assert filled[A].link == pytest.approx(1.1)


def test_cell_dies_after_the_cap():
    links = {B: CellLink(1.10, 3, 3, 3)}
    filled, dead = impute_missing_cells(dict(links), [A, B], {A: 5}, max_consecutive=5)
    assert dead == [A]
    assert A not in filled


def test_redistribution_is_explicit_and_recorded():
    """A dead cell's weight goes to its siblings, and the move is written down."""
    weights = {A: 0.4, B: 0.3, C: 0.3}
    new, adj = redistribute(weights, [A])
    assert A not in new
    assert sum(new.values()) == pytest.approx(1.0)
    assert new[B] == pytest.approx(0.3 + 0.4)      # only sibling at (route, lead)
    assert adj[0]["scope"] == "ROUTE_LEAD"
    assert adj[0]["weight_moved"] == pytest.approx(0.4)


def test_redistribution_preserves_the_weight_sum():
    weights = {A: 0.25, B: 0.25, C: 0.25, D: 0.25}
    new, _ = redistribute(weights, [A, D])
    assert sum(new.values()) == pytest.approx(1.0)
