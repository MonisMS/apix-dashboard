"""Sub-series assembly, shared by the FastAPI reference implementation and the
Neon publisher.

Lifted verbatim out of api/services/index.py so there is exactly one
implementation. Two consumers computing the same drill-down from two copies of
this logic is precisely how a route page ends up disagreeing with the API.

On series_id and the digest
---------------------------
point_digest hashes the series_id, so the *same numbers* under two different
ids produce two different hashes. The old code was inconsistent about this:
route_detail() passed the bare pair ("DEL-BOM") while catalogue(), carriers(),
windows() and the heatmap all passed "" (which point_digest turned into
"APIX.SUBSET"). The stored vintage therefore canonicalises on the full series
id -- APIX.ROUTE.DEL-BOM, APIX.CARRIER.IndiGo, APIX.LEAD.T7 -- via series_id()
below. That is a deliberate one-time change to the route sub-series hashes,
and it is the reason they are consistent from here on.
"""
from .aggregate import aggregate_subset
from .repro import point_digest


def route_series_id(origin: str, destination: str) -> str:
    return f"APIX.ROUTE.{origin}-{destination}"


def carrier_series_id(carrier: str) -> str:
    return f"APIX.CARRIER.{carrier}"


def window_series_id(lead: int) -> str:
    return f"APIX.LEAD.T{lead}"


def route_window_series_id(origin: str, destination: str, lead: int) -> str:
    """route_detail's by_lead_window block: one series per (route, lead)."""
    return f"APIX.ROUTE.{origin}-{destination}.T{lead}"


def series_from_predicate(res, predicate, series_id):
    """Assemble a levelled series for a subset of cells, day by day.

    Returns (points, share). `share` is the subset's fraction of basket weight,
    taken from the most recent day.
    """
    factor = res["reference"]["factor"]
    weights = res["_weights"]
    points, share = [], None
    prev = None
    for day in res["_results"]:
        try:
            level, share = aggregate_subset(day.cell_levels, weights, predicate)
        except (ValueError, KeyError):
            continue          # subset carried no cells on this day
        lvl = round(level * factor, 4)
        # A sub-series is a different number from the headline, so it needs its
        # own digest over its own cells -- otherwise a route page would either
        # show nothing or borrow APIX.ALL's proof, which describes a different
        # figure. Same function, same rules, narrowed inputs.
        sub_links = {c: l for c, l in (day.links or {}).items() if predicate(c)}
        sub_weights = {c: w for c, w in weights.items() if predicate(c)}
        points.append({
            "period_start": day.date, "period_end": day.date, "freq": "D",
            "level": lvl,
            "pct_change_1p": None if prev is None else round((lvl / prev - 1) * 100, 4),
            "repro_hash": point_digest(day.date, series_id or "APIX.SUBSET", "D",
                                       factor, sub_links, sub_weights),
        })
        prev = lvl
    return points, (round(share, 8) if share is not None else 0.0)
