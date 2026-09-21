"""The digest is only worth publishing if it actually changes when inputs do."""
from apix.index import repro
from apix.index.model import CellKey, CellLink

CELL_A = CellKey("DEL", "BOM", 7, "6E", "MD")
CELL_B = CellKey("BLR", "DEL", 15, "AI", "EM")
LINKS = {CELL_A: CellLink(1.0234, 12, 12, 12), CELL_B: CellLink(0.9876, 8, 8, 8)}
WEIGHTS = {CELL_A: 0.6, CELL_B: 0.4}


def digest(links=None, weights=None, factor=1.0, date="2026-09-16",
           series="APIX.ALL", freq="D"):
    return repro.point_digest(date, series, freq, factor,
                              links or LINKS, weights or WEIGHTS)


def test_stable_across_calls():
    assert digest() == digest()


def test_dict_order_does_not_matter():
    reordered = {CELL_B: LINKS[CELL_B], CELL_A: LINKS[CELL_A]}
    assert digest(links=reordered) == digest()


def test_changed_fare_changes_digest():
    moved = {**LINKS, CELL_A: CellLink(1.0235, 12, 12, 12)}
    assert digest(links=moved) != digest()


def test_changed_weight_changes_digest():
    assert digest(weights={CELL_A: 0.61, CELL_B: 0.39}) != digest()


def test_reference_factor_changes_digest():
    assert digest(factor=1.0001) != digest()


def test_imputed_flag_changes_digest():
    """Same number, different provenance -- must not hash the same."""
    imputed = {**LINKS, CELL_A: CellLink(1.0234, 12, 12, 12, is_imputed=True)}
    assert digest(links=imputed) != digest()


def test_method_version_is_inside_the_hash():
    payload = repro.canonical_payload("2026-09-16", "APIX.ALL", "D", 1.0,
                                      LINKS, WEIGHTS)
    assert repro.METHOD_VERSION in payload


def test_verify_round_trip():
    d = digest()
    assert repro.verify(d, "2026-09-16", "APIX.ALL", "D", 1.0, LINKS, WEIGHTS)
    assert not repro.verify(d, "2026-09-15", "APIX.ALL", "D", 1.0, LINKS, WEIGHTS)


def test_published_points_all_carry_a_digest():
    """Every point the engine emits must be re-derivable, not just the last."""
    import json, subprocess, sys
    out = subprocess.run([sys.executable, "-m", "apix.index.cli", "--json"],
                         capture_output=True, text=True, cwd=".")
    points = json.loads(out.stdout)["points"]
    assert points, "no points produced"
    assert all(p["repro_hash"].startswith("sha256:") for p in points)
    assert len({p["repro_hash"] for p in points}) == len(points)
