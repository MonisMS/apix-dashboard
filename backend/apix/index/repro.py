"""A reproducibility digest for every published index point.

The hardest question anyone can ask a statistical agency is "how do we know you
did not tweak this number?". The honest answer is not a promise -- it is a
digest computed from the inputs, published beside the figure, so a third party
who holds the same observations can recompute it and compare.

What goes into the digest is exactly what determines the level: the method
version, the point's identity, the reference factor, and every cell link and
weight in force on that day. Nothing else. Two runs over the same panel MUST
produce the same digest; a changed fare, a changed weight, a changed method
version, or a re-reference MUST change it.

What it is NOT: a signature. It proves the number follows from the stated
inputs, not that the inputs are authentic. Anyone recomputing it needs the
observation panel, which is what `/api/v1/audit` and the collection log expose.
"""
import hashlib
import json

# Bump when any computation that moves a level changes -- the elementary
# formula, the aggregation, the imputation rule, or the screening rule. A
# digest is only comparable within one method version, which is why the
# version is inside the hash rather than beside it.
METHOD_VERSION = "apix-index-1.0.0"

_LINK_DP = 10        # links are ratios near 1.0; 10dp is far below noise
_WEIGHT_DP = 12      # weights are shares summing to 1.0
_FACTOR_DP = 12


def _cell_str(cell) -> str:
    """A stable textual key for a cell, independent of tuple layout."""
    if hasattr(cell, "_asdict"):
        return "|".join(f"{k}={v}" for k, v in cell._asdict().items())
    return str(cell)


def canonical_payload(date: str, series_id: str, freq: str, factor: float,
                      links: dict, weights: dict) -> str:
    """The exact string that gets hashed. Published so it can be re-derived.

    Sorted by cell key, fixed precision, separators pinned: the same panel must
    serialise identically on any machine, any Python, any dict ordering.
    """
    # An imputed link and an observed link of the same value are not the same
    # input, so the imputation flag is inside the digest, not beside it.
    link_rows = sorted(
        (_cell_str(c),
         round(float(getattr(l, "link", l)), _LINK_DP),
         bool(getattr(l, "is_imputed", False)))
        for c, l in links.items()
    )
    weight_rows = sorted(
        (_cell_str(c), round(float(w), _WEIGHT_DP)) for c, w in weights.items()
    )
    return json.dumps({
        "method_version": METHOD_VERSION,
        "series_id": series_id,
        "freq": freq,
        "period": date,
        "reference_factor": round(float(factor), _FACTOR_DP),
        "links": link_rows,
        "weights": weight_rows,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def point_digest(date: str, series_id: str, freq: str, factor: float,
                 links: dict, weights: dict) -> str:
    """sha256 of the canonical payload, as `sha256:<64 hex>`."""
    payload = canonical_payload(date, series_id, freq, factor, links, weights)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify(expected: str, date: str, series_id: str, freq: str, factor: float,
           links: dict, weights: dict) -> bool:
    """Recompute and compare. Used by the self-test and by any third party."""
    return expected == point_digest(date, series_id, freq, factor, links, weights)
