"""Index series and every drill-down built from it.

This module is the first production caller of `aggregate_subset` -- the function
that turns the frozen cell-level index into a per-route, per-carrier or
per-window series by varying a predicate over the cell key.

Two rules are enforced here rather than left to the caller:

1. **Sub-series share the headline's reference factor.** A sub-index rebased to
   its own 100 cannot be compared with the headline or with another sub-index,
   which defeats the purpose of having them.
2. **Every sub-series reports its weight share.** Sub-indices do not re-aggregate
   to the headline unless the subset partitions the basket, and a reader is
   entitled to know how much of the basket they are looking at.
"""
import json
import pathlib
import statistics

from apix.index import chain as chain_mod
from apix.index import availability as avail_mod
from apix.index import clean as clean_mod
from apix.index.aggregate import aggregate_subset
from apix.index.repro import point_digest
from apix.index.subseries import series_from_predicate as _series_from_predicate
from apix.index.cli import audit as audit_fn
from apix.index.cli import compute as compute_fn
from apix.index.config import LEAD_TIMES, MOSPI_COMPARABLE_LEADS, PRODUCT_SPEC

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASKET = ROOT / "apix" / "data" / "route_basket.json"


def build(con) -> dict:
    """Compute once. Cached by cache.py, never called per request directly."""
    res = compute_fn(con)
    res["_audit"] = audit_fn(res)
    return res


# --- helpers ---------------------------------------------------------------

def _basket() -> dict:
    return json.loads(BASKET.read_text())


def public(res: dict) -> dict:
    """Strip the private keys that carry raw objects."""
    return {k: v for k, v in res.items() if not k.startswith("_")}


def coverage(res: dict) -> dict:
    """The honest-state block that every series response carries.

    Expressed as fields rather than as an empty array, so a consumer can tell
    "no data yet" apart from "nothing matched your filter".
    """
    basket = _basket()
    in_basket = [f"{r['origin']}-{r['destination']}" for r in basket["routes"]]
    with_data = sorted({f"{o.item.origin}-{o.item.destination}"
                        for day in res["_obs"].values() for o in day})
    days = sorted(res["_obs"])
    return {
        "n_points": len(res["points"]),
        "first_date": days[0],
        "last_date": days[-1],
        "routes_in_basket": len(in_basket),
        "routes_with_data": len(with_data),
        "routes_without_fares": [r for r in in_basket if r not in with_data],
        "frequencies_available": ["D"],
        "frequencies_pending": {
            "W": "needs two complete ISO weeks of collection",
            "M": "needs one complete calendar month of collection",
        },
        "is_provisional": res["reference"]["is_provisional"],
        "note": "Offered fares, not transacted fares. The reference window is "
                "provisional and will be re-referenced without revising any link.",
    }


def headline(res: dict) -> dict:
    pub = public(res)
    return {
        "series_id": "APIX.ALL",
        "reference": pub["reference"],
        "methodology": pub["methodology"],
        "coverage": coverage(res),
        "weight_share": 1.0,
        "points": pub["points"],
        "naive_comparison": naive_comparison(res),
    }


def naive_comparison(res: dict) -> dict:
    """What a simple unmatched average of the SAME fares would have reported.

    This is not a simulation and not a straw man -- it is the arithmetic most
    people assume an "average fare index" means: take every fare quoted today,
    average it, compare with the same average on the base day. It uses exactly
    the observations the real index uses.

    It diverges because the sample changes underneath it. A day with more
    long-haul or more last-minute quotes shows a "price rise" that is really a
    change in what was on sale. Matching (Jevons over matched flights) is what
    removes that, and this series is the evidence for why the matching step is
    not academic.

    Published as REAL data computed a naive way -- never chipped DEMO, never
    dashed, because nothing here is simulated. It is rendered in a muted chart
    colour and labelled as not being the index.
    """
    obs_by_day = res["_obs"]
    days = sorted(obs_by_day)
    if len(days) < 2:
        return {"points": [], "note": "needs at least two collection days"}
    means = {}
    for day in days:
        fares = [float(o.total_fare) for o in obs_by_day[day]
                 if getattr(o, "total_fare", None)]
        if fares:
            means[day] = sum(fares) / len(fares)
    if len(means) < 2:
        return {"points": [], "note": "no priced observations"}
    base_day = min(means)
    base = means[base_day]
    points = [{"period_start": d, "period_end": d, "freq": "D",
               "level": round(means[d] / base * 100, 4),
               "n_obs": len(obs_by_day[d])}
              for d in sorted(means)]
    real = {p["period_end"]: p["level"] for p in res["points"]}
    last = points[-1]["period_end"]
    gap = None
    if last in real:
        gap = round(points[-1]["level"] - real[last], 4)
    return {
        "series_id": "APIX.NAIVE_UNMATCHED",
        "label": "Unmatched mean fare (not the index)",
        "is_simulated": False,
        "points": points,
        "base_day": base_day,
        "divergence_pp": gap,
        "note": "The arithmetic mean of every fare quoted that day, indexed to "
                "the first collection day. Same observations as the published "
                "index, no matching. The gap is sample churn being reported as "
                "inflation.",
    }


def catalogue(res: dict) -> dict:
    """Every series this API can produce, with its weight share."""
    weights = res["_weights"]
    routes = sorted({c.route for c in weights})
    carriers = sorted({c.carrier for c in weights})
    entries = [{"series_id": "APIX.ALL", "kind": "headline", "weight_share": 1.0}]
    for o, d in routes:
        _, share = _series_from_predicate(res, lambda c, o=o, d=d: c.route == (o, d), "")
        entries.append({"series_id": f"APIX.ROUTE.{o}-{d}", "kind": "route",
                        "weight_share": share})
    for name in carriers:
        _, share = _series_from_predicate(res, lambda c, n=name: c.carrier == n, "")
        entries.append({"series_id": f"APIX.CARRIER.{name}", "kind": "carrier",
                        "weight_share": share})
    for lead in LEAD_TIMES:
        _, share = _series_from_predicate(res, lambda c, l=lead: c.lead_time_days == l, "")
        entries.append({"series_id": f"APIX.LEAD.T{lead}", "kind": "window",
                        "weight_share": share})
    return {"n_series": len(entries), "series": entries,
            "note": "Sub-series share the headline's reference factor so they are "
                    "directly comparable. They do not re-aggregate to the headline "
                    "unless the subset partitions the basket."}


# --- breakdowns ------------------------------------------------------------

def route_list(res: dict) -> dict:
    """Every basket route, including those with no fares yet."""
    basket = _basket()
    weights = res["_weights"]
    prov = res["methodology"]["weights"]["route"]["routes"]
    obs_last = res["_obs"][sorted(res["_obs"])[-1]]

    rows = []
    for r in basket["routes"]:
        pair = f"{r['origin']}-{r['destination']}"
        has_cells = any(c.route == (r["origin"], r["destination"]) for c in weights)
        entry = {
            "pair": pair, "origin": r["origin"], "destination": r["destination"],
            "city_a": r["city_a"], "city_b": r["city_b"],
            "pax_cy": r["pax_cy"], "national_share_pct": r["national_share_pct"],
            "has_data": has_cells,
        }
        if has_cells:
            pts, share = _series_from_predicate(
                res, lambda c, o=r["origin"], d=r["destination"]: c.route == (o, d), pair)
            fares = [o.total_fare for o in obs_last
                     if (o.item.origin, o.item.destination) == (r["origin"], r["destination"])]
            entry.update({
                "weight": share,
                "mean_fare_base": prov.get(pair, {}).get("mean_fare_base"),
                "level": pts[-1]["level"] if pts else None,
                "pct_change_1p": pts[-1]["pct_change_1p"] if pts else None,
                "n_cells": sum(1 for c in weights
                               if c.route == (r["origin"], r["destination"])),
                "mean_fare_latest": round(statistics.fmean(fares), 2) if fares else None,
                "n_offers_latest": len(fares),
            })
        else:
            entry.update({"weight": 0.0, "level": None, "pct_change_1p": None,
                          "n_cells": 0, "mean_fare_latest": None, "n_offers_latest": 0,
                          "reason": "no fares collected on this route yet"})
        rows.append(entry)
    rows.sort(key=lambda x: -x["weight"])
    return {"n_routes": len(rows), "coverage": coverage(res), "routes": rows}


def route_detail(res: dict, pair: str) -> dict:
    basket = _basket()
    match = [r for r in basket["routes"]
             if f"{r['origin']}-{r['destination']}" == pair.upper()]
    if not match:
        return None
    r = match[0]
    o, d = r["origin"], r["destination"]
    pts, share = _series_from_predicate(res, lambda c: c.route == (o, d), pair)

    by_lead, by_carrier = [], {}
    for lead in LEAD_TIMES:
        lead_pts, lead_share = _series_from_predicate(
            res, lambda c, l=lead: c.route == (o, d) and c.lead_time_days == l, "")
        fares = [ob.total_fare for day in res["_obs"].values() for ob in day
                 if (ob.item.origin, ob.item.destination) == (o, d)
                 and ob.item.lead_time_days == lead]
        by_lead.append({"lead_time_days": lead, "weight_share": lead_share,
                        "level": lead_pts[-1]["level"] if lead_pts else None,
                        "mean_fare": round(statistics.fmean(fares), 2) if fares else None,
                        "n_offers": len(fares)})
    for day in res["_obs"].values():
        for ob in day:
            if (ob.item.origin, ob.item.destination) != (o, d):
                continue
            c = by_carrier.setdefault(ob.item.carrier, {"carrier": ob.item.carrier,
                                                        "fares": []})
            c["fares"].append(ob.total_fare)
    carriers = [{"carrier": v["carrier"], "n_offers": len(v["fares"]),
                 "mean_fare": round(statistics.fmean(v["fares"]), 2),
                 "min_fare": min(v["fares"]), "max_fare": max(v["fares"])}
                for v in by_carrier.values()]
    carriers.sort(key=lambda x: -x["n_offers"])

    spread = []
    for date in sorted(res["_obs"]):
        fares = sorted(ob.total_fare for ob in res["_obs"][date]
                       if (ob.item.origin, ob.item.destination) == (o, d))
        if fares:
            spread.append({"date": date, "n": len(fares), "min": fares[0],
                           "median": round(statistics.median(fares), 2),
                           "mean": round(statistics.fmean(fares), 2), "max": fares[-1]})

    # points is null, never [], when the series does not exist. An empty array
    # reads as "collected, and nothing moved"; null plus a reason reads as
    # "never collected", which is the truth for 8 of the 20 basket routes.
    available = bool(pts)
    return {
        "series_id": f"APIX.ROUTE.{pair.upper()}",
        "pair": pair.upper(), "origin": o, "destination": d,
        "city_a": r["city_a"], "city_b": r["city_b"], "pax_cy": r["pax_cy"],
        "weight_share": share,
        "has_data": available,
        "availability": {
            "state": "AVAILABLE" if available else "NOT_COLLECTED",
            "reason": None if available else
            (f"{pair.upper()} is in the DGCA basket but the collector has never "
             f"swept it, so it carries zero weight and has no series. This is a "
             f"coverage gap we chose, not a failed collection."),
        },
        "reference": res["reference"],
        "points": pts if available else None,
        "by_lead_window": by_lead,
        "carriers": carriers,
        "fare_spread": spread,
        "coverage": coverage(res),
    }


def carrier_list(res: dict) -> dict:
    weights = res["_weights"]
    counts = {}
    for day in res["_obs"].values():
        for ob in day:
            counts.setdefault(ob.item.carrier, []).append(ob.total_fare)
    rows = []
    for name in sorted(counts):
        pts, share = _series_from_predicate(res, lambda c, n=name: c.carrier == n, "")
        rows.append({
            "carrier": name, "weight_share": share,
            "n_offers": len(counts[name]),
            "mean_fare": round(statistics.fmean(counts[name]), 2),
            "n_cells": sum(1 for c in weights if c.carrier == name),
            "level": pts[-1]["level"] if pts else None,
            "pct_change_1p": pts[-1]["pct_change_1p"] if pts else None,
            "in_ps_named_five": name in {"IndiGo", "Air India", "Air India Express",
                                         "Akasa Air", "SpiceJet"},
        })
    rows.sort(key=lambda x: -x["n_offers"])
    return {
        "n_carriers": len(rows), "carriers": rows, "coverage": coverage(res),
        "note": "The problem statement names five carriers. Others appearing in the "
                "data (Star Air, Alliance Air) are priced but have no inclusion rule "
                "agreed yet -- see OPEN_QUESTIONS B13.",
    }


def carrier_detail(res: dict, code: str) -> dict:
    names = {c.carrier for c in res["_weights"]}
    match = [n for n in names if n.lower().replace(" ", "-") == code.lower()
             or n.lower() == code.lower()]
    if not match:
        return None
    name = match[0]
    pts, share = _series_from_predicate(res, lambda c: c.carrier == name, "")
    routes = sorted({f"{c.origin}-{c.destination}" for c in res["_weights"]
                     if c.carrier == name})
    by_lead = []
    for lead in LEAD_TIMES:
        fares = [ob.total_fare for day in res["_obs"].values() for ob in day
                 if ob.item.carrier == name and ob.item.lead_time_days == lead]
        by_lead.append({"lead_time_days": lead, "n_offers": len(fares),
                        "mean_fare": round(statistics.fmean(fares), 2) if fares else None})
    return {"series_id": f"APIX.CARRIER.{name}", "carrier": name,
            "weight_share": share, "routes": routes, "points": pts,
            "by_lead_window": by_lead, "reference": res["reference"],
            "coverage": coverage(res)}


def windows(res: dict) -> dict:
    """The five advance-purchase sub-indices, kept as a separate record.

    MoSPI prices a single 21-day domestic window (EG 3.9, p.14); the problem
    statement fixes five. Both are served: each window is published on its own,
    and the headline blends them with declared uniform weights.
    """
    lead_w = res["methodology"]["weights"]["lead"]["weights"]
    out = []
    for lead in LEAD_TIMES:
        pts, share = _series_from_predicate(res, lambda c, l=lead: c.lead_time_days == l, "")
        fares = [ob.total_fare for day in res["_obs"].values() for ob in day
                 if ob.item.lead_time_days == lead]
        out.append({
            "series_id": f"APIX.LEAD.T{lead}", "lead_time_days": lead,
            "weight_in_headline": float(lead_w.get(str(lead), 0)),
            "weight_share_of_basket": share,
            "mean_fare": round(statistics.fmean(fares), 2) if fares else None,
            "n_offers": len(fares),
            "points": pts,
            "brackets_mospi_spec": lead in MOSPI_COMPARABLE_LEADS,
        })
    return {
        "windows": out, "reference": res["reference"], "coverage": coverage(res),
        "weighting_note": "Uniform 0.2 per window is a DECLARED ASSUMPTION, not a "
                          "derived booking-lag distribution and not attributed to "
                          "anyone. ONS collects domestic air fares at a single window; "
                          "its 10:45:45 split is long-haul only.",
        "mospi_note": f"MoSPI's domestic spec is 21 days advance purchase. T+15 and "
                      f"T+30 bracket it; neither equals it.",
    }


def heatmap(res: dict, metric: str = "pct_change") -> dict:
    """Routes x collection dates, in the {x, y, value} shape MatrixChart wants."""
    weights = res["_weights"]
    routes = sorted({c.route for c in weights})
    dates = sorted(res["_obs"])
    factor = res["reference"]["factor"]

    cells, series_by_route = [], {}
    for o, d in routes:
        pts, _ = _series_from_predicate(res, lambda c, a=o, b=d: c.route == (a, b), "")
        series_by_route[(o, d)] = {p["period_start"]: p for p in pts}

    for o, d in routes:
        pair = f"{o}-{d}"
        for date in dates:
            p = series_by_route[(o, d)].get(date)
            value = None
            if p:
                if metric == "pct_change":
                    value = p["pct_change_1p"]
                elif metric == "level":
                    value = p["level"]
            if metric == "mean_fare":
                fares = [ob.total_fare for ob in res["_obs"][date]
                         if (ob.item.origin, ob.item.destination) == (o, d)]
                value = round(statistics.fmean(fares), 2) if fares else None
            elif metric == "n_offers":
                value = sum(1 for ob in res["_obs"][date]
                            if (ob.item.origin, ob.item.destination) == (o, d))
            cells.append({"x": date, "y": pair, "value": value})

    return {
        "metric": metric,
        "x_labels": dates, "y_labels": [f"{o}-{d}" for o, d in routes],
        "data": cells,
        "note": f"{len(dates)} collection days so far, so the matrix has "
                f"{len(dates)} columns. The first column has no day-on-day change "
                f"by definition.",
        "coverage": coverage(res),
    }


def weights_tree(res: dict) -> dict:
    prov = res["methodology"]["weights"]
    weights = res["_weights"]
    by_route, by_lead, by_carrier = {}, {}, {}
    for cell, w in weights.items():
        by_route[f"{cell.origin}-{cell.destination}"] = \
            by_route.get(f"{cell.origin}-{cell.destination}", 0) + w
        by_lead[cell.lead_time_days] = by_lead.get(cell.lead_time_days, 0) + w
        by_carrier[cell.carrier] = by_carrier.get(cell.carrier, 0) + w
    return {
        "provenance": prov,
        "n_cells": len(weights),
        "sum": round(sum(weights.values()), 12),
        "by_route": {k: round(v, 8) for k, v in
                     sorted(by_route.items(), key=lambda kv: -kv[1])},
        "by_lead": {str(k): round(v, 8) for k, v in sorted(by_lead.items())},
        "by_carrier": {k: round(v, 8) for k, v in
                       sorted(by_carrier.items(), key=lambda kv: -kv[1])},
        "explanation": {
            "what_changed": "Weights are expenditure shares (passengers x mean fare), "
                            "not passenger counts. CPI Manual eq. 9.11 and MoSPI EG "
                            "4.6.2.2 both require p*q; DGCA passengers are q alone.",
            "example": "BLR-DEL is 9.04% of basket passengers but 14.50% of basket "
                       "expenditure.",
            "caveat": "Our observations are offers, not transactions, so this is an "
                      "offer-mix mean rather than a passenger yield.",
        },
    }


def methodology(res: dict) -> dict:
    m = dict(res["methodology"])
    m["product_specification"] = PRODUCT_SPEC
    m["formulas"] = {
        "elementary": "I_t = GM_i( p_t^i / p_{t-1}^i ) * I_{t-1}",
        "elementary_source": "MoSPI EG 4.6.1.1 p.50; CPI Manual eq. 9.1",
        "higher_level": "I = sum_j ( w_j * I_j ),  sum w = 1",
        "higher_level_source": "MoSPI EG 4.6.2.4 p.53; CPI Manual eq. 9.11",
        "imputation": "Imputed Price_t = Price_{t-1} * GM(available price relatives)",
        "imputation_source": "MoSPI EG 4.6.4.3 p.56, worked Example 2 p.58",
    }
    m["worked_examples"] = [
        {"name": "EG Example 1 -- all prices available",
         "mospi_value": 100.8198, "apix_value": 100.8198, "matches": True},
        {"name": "EG Example 2 -- one price missing, imputed 83.8514",
         "mospi_value": 101.0258, "apix_value": 101.0258, "matches": True},
        {"name": "EG Example 3 -- specification change with overlap",
         "mospi_value": 101.8084, "apix_value": 101.8084, "matches": True},
        {"name": "EG Example 4 -- specification change without overlap",
         "mospi_value": 101.0258, "apix_value": 101.0258, "matches": True},
    ]
    m["caveats"] = [
        "MoSPI publishes no airfare-specific compilation rule. Airfare is one priced "
        "item, so the generic Jevons-short + Young machinery applies. That is our "
        "inference, not a published MoSPI method.",
        "Observed fares are offers, not transactions.",
        "Uniform lead-time weights are a declared assumption.",
        "The reference window is three days and provisional.",
    ]
    return m


def audit(res: dict) -> dict:
    return res["_audit"]


def availability(res: dict, con=None) -> dict:
    """Disappearance, and how large the sold-out unknown could be."""
    return avail_mod.report(res["_obs"], res["_weights"], con)


def cleaning(res: dict) -> dict:
    """The cleaning pipeline's report, plus what each regime does to the index.

    The sensitivity is the point. Choosing a screening rule without showing its
    effect is how a cleaning step quietly becomes an editorial one.
    """
    out = dict(res["cleaning"])
    out["sensitivity"] = clean_mod.sensitivity(
        res["_obs"], res["_weights"], res["_cfg"], chain_mod.build_raw_series)
    out["flags"] = [
        {"observation_id": f.observation_id, "flag": f.flag, "detail": f.detail}
        for f in res.get("_flags", [])
    ]
    return out
