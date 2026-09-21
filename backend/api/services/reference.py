"""Reference data that does not come from the index computation.

The MoSPI published series, the Rule-135 tariff sheets, the CPI airfare weight
and the collection log. All read from files or the database, all cached by the
caller.
"""
import csv
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[2]
MOSPI_CSV = ROOT / "apix" / "exports" / "mospi_airfare_index.csv"
TARIFFS = ROOT / "data" / "tariff_sheets.json"
CPI_WEIGHTS = ROOT / "data" / "cpi2024_airfare_weights.csv"

MONTHS = {1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
          7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"}


def mospi_series() -> list:
    """MoSPI's published Airfare item (07.3.3.1.2.01), monthly, 2024=100."""
    if not MOSPI_CSV.exists():
        return []
    out = []
    with open(MOSPI_CSV) as f:
        for row in csv.DictReader(f):
            y, m = int(row["year"]), int(row["month"])
            out.append({"period": f"{y}-{m:02d}", "year": y, "month": m,
                        "label": f"{MONTHS[m]} {y}",
                        "index": float(row["index_2024_base"])})
    return out


def validation(index_res) -> dict:
    """APIx against MoSPI -- and the fact that they do not overlap.

    This is the honest core of the whole pitch. MoSPI's published Airfare series
    ends July 2026; ours begins 10 September 2026. There is no overlapping period,
    so no correlation can be computed yet and none is offered here. What we can
    show is that the machinery is correct (the transitivity audit, and MoSPI's own
    worked examples reproduced), and the date at which a comparison first becomes
    possible.
    """
    from apix.index import validate as V

    harness = V.validate(index_res["points"])
    mospi = mospi_series()
    apix = index_res["points"]
    apix_days = sorted(index_res["_obs"])

    first_apix_month = apix_days[0][:7]
    last_mospi = mospi[-1]["period"] if mospi else None
    overlapping = [m for m in mospi if m["period"] >= first_apix_month]

    return {
        "mospi": {
            "source": "MoSPI e-Sankhyiki, CPI 2024 item 07.3.3.1.2.01 (Airfare, item 294)",
            "frequency": "monthly", "base": "2024=100",
            "n_points": len(mospi), "first": mospi[0]["period"] if mospi else None,
            "last": last_mospi, "points": mospi,
        },
        "apix": {
            "frequency": "daily", "base": index_res["reference"]["label"],
            "n_points": len(apix), "first": apix_days[0], "last": apix_days[-1],
            "points": apix,
        },
        "overlap": {
            "has_overlap": bool(overlapping),
            "n_overlapping_months": len(overlapping),
            "statement": (
                f"No overlap. MoSPI's published Airfare series ends {last_mospi}; "
                f"APIx begins {apix_days[0]}. A month-on-month comparison needs at "
                f"least one complete calendar month of APIx collection that MoSPI has "
                f"also published. The first APIx month that could be compared is "
                f"{first_apix_month}, once MoSPI publishes it."),
            "what_we_can_show_instead": [
                "MoSPI's four published worked examples reproduced to 4 decimal places",
                "The transitivity audit: chained vs direct fixed-base, and the drift",
                "That the elementary and aggregation formulas match the Expert Group "
                "Report and the IMF CPI Manual",
            ],
        },
        # The harness itself: metrics, the criteria fixed in advance, proof the
        # arithmetic works, and the date a real answer first becomes possible.
        "harness": harness,
        "correlation": harness["comparison"]["correlation"],
        "correlation_reason": "; ".join(harness["comparison"]["reasons"]) or None,
    }


def tariffs() -> dict:
    """Rule-135 published tariff sheets -- bands, not transacted fares."""
    if not TARIFFS.exists():
        return {"sources": {}, "rows": [], "n_rows": 0}
    data = json.loads(TARIFFS.read_text())
    rows = data.get("rows", [])
    markets = {}
    for r in rows:
        key = (r["airline"], r["city_a"], r["city_b"])
        markets.setdefault(key, {})[r["bound"]] = r
    out = []
    for (airline, a, b), bounds in sorted(markets.items()):
        lo, hi = bounds.get("min"), bounds.get("max")
        out.append({
            "airline": airline, "city_a": a, "city_b": b,
            "origin": (lo or hi).get("origin"), "destination": (lo or hi).get("destination"),
            "stops": (lo or hi).get("stops"),
            "fuel_charge_yq": (lo or hi).get("fuel_charge_yq"),
            "n_levels": (lo or hi).get("n_levels"),
            "min_lowest": lo.get("lowest_level") if lo else None,
            "min_highest": lo.get("highest_level") if lo else None,
            "max_lowest": hi.get("lowest_level") if hi else None,
            "max_highest": hi.get("highest_level") if hi else None,
            "min_levels": lo.get("levels") if lo else None,
            "max_levels": hi.get("levels") if hi else None,
        })
    return {
        "retrieved": data.get("retrieved"),
        "sources": data.get("sources", {}),
        "n_markets": len(out), "n_rows": len(rows), "markets": out,
        "legal_basis": "Rule 135 of the Aircraft Rules, 1937 requires every Indian "
                       "carrier to publish its tariff. These are published for the "
                       "public, so no scraping question arises.",
        "caveat": "A tariff sheet is the band a fare must sit inside, not a transacted "
                  "price. These supplement the index and never enter it as observed "
                  "quotes.",
    }


def cpi_context() -> dict:
    """Where airfare actually sits inside the CPI basket."""
    rows = []
    if CPI_WEIGHTS.exists():
        with open(CPI_WEIGHTS) as f:
            rows = list(csv.DictReader(f))
    total = sum(float(r["share_in_all_india_pct"]) for r in rows) if rows else 0.0
    by_sector = {}
    for r in rows:
        by_sector[r["sector"]] = by_sector.get(r["sector"], 0) + \
            float(r["share_in_all_india_pct"])
    top = sorted(rows, key=lambda r: -float(r["share_in_all_india_pct"]))[:8]
    return {
        "airfare_weight_pct": round(total, 6),
        "by_sector": {k: round(v, 6) for k, v in by_sector.items()},
        "group_07_3_passenger_transport_services_pct": 2.567016,
        "division_07_transport_pct": 8.796113,
        "division_08_information_and_communication_pct": 3.609438,
        "note": "8.796113% is Division 07 Transport ALONE. 'Transport and "
                "Communication' is the CPI 2012 name; its CPI 2024 equivalent is "
                "Transport plus Information and communication = 12.405552%.",
        "source": "MoSPI Annexure 5.3d (all-India and State-wise item level weights); "
                  "summed over 58 state x sector rows, as the sheet has no all-India "
                  "row for airfare. The same column sums to exactly 100.000 over all "
                  "23,215 rows and Division 07 to 8.796113, reproducing the published "
                  "Transport weight to six decimals.",
        "top_contributing_states": [
            {"state": r["state_name"], "sector": r["sector"],
             "share_in_all_india_pct": float(r["share_in_all_india_pct"])} for r in top],
        "largest_contributor_note": "Kerala rural alone is about 19% of the national "
                                    "airfare weight. CPI weights airfare by household "
                                    "expenditure share by state; our basket weights by "
                                    "DGCA trunk-route passengers. Different concepts.",
    }


def fare_split(con) -> dict:
    """The base-fare / tax split -- PS deliverable (b)'s four money fields.

    Read straight from `fare_observation`, not recomputed: the rows were stored
    by `apix/split_study.py` and carry `base_fare` and `taxes` as the source
    reported them.

    Three things this endpoint is built to say out loud:

    1. **It is a periodic study, not the daily feed.** The split source is on a
       50-request-a-month budget; a daily basket sweep needs 60 a day. So the
       split is a panel measured across every basket route at one booking
       window, and the daily rows keep NULL in these columns rather than being
       back-filled with a modelled share.
    2. **'Tax' is the carrier's own taxes-and-fees line.** Akasa reports about
       4% where IndiGo reports about 24% on the same route. That is how they
       each split the ticket internally, not a statutory rate, and normalising
       it would invent a number that does not exist.
    3. **UDF and convenience fee remain NULL and unobserved.** No source
       itemises UDF; no OTA discloses its convenience fee before the payment
       step. The PS names four fields and we can observe two of them.
    """
    rows = con.execute(
        """SELECT origin, destination, carrier, flight_number, departure_date,
                  lead_time_days, base_fare, taxes, total_fare,
                  DATE(collected_at) AS day, source
           FROM fare_observation
           WHERE base_fare IS NOT NULL AND taxes IS NOT NULL
           ORDER BY origin, destination, carrier""").fetchall()

    if not rows:
        return {
            "available": False,
            "reason": "No observation carries a base/tax split yet. "
                      "Run `python3 apix/split_study.py`.",
            "observations": None, "by_carrier": None, "by_route": None,
        }

    def share(r):
        return r["taxes"] / r["total_fare"] * 100

    by_carrier, by_route = {}, {}
    for r in rows:
        by_carrier.setdefault(r["carrier"], []).append(share(r))
        by_route.setdefault(f"{r['origin']}-{r['destination']}", []).append(share(r))

    def summarise(d, key_name):
        out = []
        for k, shares in d.items():
            out.append({
                key_name: k,
                "n": len(shares),
                "tax_share_pct": round(statistics.mean(shares), 2),
                "min_pct": round(min(shares), 2),
                "max_pct": round(max(shares), 2),
            })
        return sorted(out, key=lambda x: -x["n"])

    days = sorted({r["day"] for r in rows})
    all_shares = [share(r) for r in rows]
    total_rows = con.execute("SELECT COUNT(*) FROM fare_observation").fetchone()[0]

    return {
        "available": True,
        "observations": len(rows),
        "share_of_all_observations_pct": round(len(rows) / total_rows * 100, 2),
        "routes_covered": len(by_route),
        "carriers_covered": len(by_carrier),
        "study_days": days,
        "booking_window_days": sorted({r["lead_time_days"] for r in rows}),
        "source": rows[0]["source"],
        "tax_share_pct_overall": round(statistics.mean(all_shares), 2),
        "by_carrier": summarise(by_carrier, "carrier"),
        "by_route": summarise(by_route, "route"),
        "fields": {
            "base_fare": {"observed": True,
                          "note": "As the source reports it. base_fare + taxes "
                                  "reconciles to total_fare on every stored row; "
                                  "a row that fails that check is dropped, not "
                                  "stored."},
            "taxes": {"observed": True,
                      "note": "One lump 'taxes and airline fees'. Carrier "
                              "accounting, not a statutory rate -- hence the "
                              "spread between carriers below."},
            "udf": {"observed": False,
                    "note": "Never itemised by any source we have found. "
                            "Derivable from AERA tariff orders, which would be "
                            "a derived figure and is not stored as observed."},
            "convenience_fee": {"observed": False,
                                "note": "OTA-specific and never disclosed before "
                                        "the payment step."},
        },
        "why_not_daily": "The split source allows 50 requests a month. A daily "
                         "sweep of 12 routes across 5 booking windows needs 60 a "
                         "day. The split is therefore a periodic panel, and the "
                         "daily series is not back-filled from it.",
        "why_not_backfilled": "Applying a tax share measured on one platform, on "
                              "one day, to another source's fares would be a "
                              "modelled number presented as an observed one. The "
                              "daily rows keep NULL.",
    }
