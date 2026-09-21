"""Collection coverage, sweeps and the quality caveats that go with them.

This is the "honest coverage" surface. It exists so that the gap between what we
meant to collect and what we actually collected is visible in the product rather
than discoverable by an examiner.
"""
import datetime as _dt
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASKET = ROOT / "apix" / "data" / "route_basket.json"

# The scheduled collection slot, matching `.github/workflows/collect.yml`
# (cron "15 5 * * *" = 05:15 UTC = 10:45 IST).  Every day is LABELLED with this
# nominal time, the way a statistics office labels a price to a reference
# period rather than to the minute an enumerator happened to write it down.
#
# It never overwrites `collected_at`.  The real timestamp stays in the database
# and in the API, because it has to keep agreeing with the git commit times and
# the public Actions logs -- our whole provenance argument rests on that, and a
# uniform stored timestamp would contradict a public record in the same repo.
NOMINAL_IST = "10:45"
_IST = _dt.timedelta(hours=5, minutes=30)


def _parse(ts: str) -> _dt.datetime:
    """`collected_at` / `started_at` are stored naive UTC."""
    return _dt.datetime.fromisoformat(ts.replace("T", " ").split(".")[0])


def _ist(ts: str) -> str:
    """UTC timestamp -> HH:MM in IST, for display beside the nominal slot."""
    return (_parse(ts) + _IST).strftime("%H:%M")


def _drift_minutes(ts: str) -> int:
    """Signed minutes between the nominal slot and when we actually collected."""
    t = _parse(ts) + _IST
    h, m = (int(x) for x in NOMINAL_IST.split(":"))
    return round((t - t.replace(hour=h, minute=m, second=0,
                                microsecond=0)).total_seconds() / 60)


def coverage(con, index_res) -> dict:
    """
    Backfilled rows (source LIKE 'external\\_%') are excluded from every table
    and count below. This page's whole point is documenting what *we*
    collected and how -- run timing, ethics, rate limits. A row imported from
    another team's public repo/API to plug the pre-window date gap has none of
    that: no `collection_run`, no real `run_id`, no rate-limit story. Counting
    it here would show a "collection day" with zero real attempts behind it,
    which is exactly the kind of thing this page exists to make visible, not
    produce. See `backfill` below for the honest, separately-labelled count.
    """
    basket = json.loads(BASKET.read_text())
    in_basket = [f"{r['origin']}-{r['destination']}" for r in basket["routes"]]

    LIVE = "source NOT LIKE 'external\\_%' ESCAPE '\\'"

    attempted = {f"{o}-{d}" for o, d in con.execute(
        "SELECT DISTINCT origin, destination FROM collection_run")}
    with_fares = {f"{o}-{d}" for o, d in con.execute(
        f"SELECT DISTINCT origin, destination FROM fare_observation WHERE {LIVE}")}

    backfill_rows = con.execute(
        "SELECT COUNT(*), MIN(substr(collected_at,1,10)), "
        "MAX(substr(collected_at,1,10)) FROM fare_observation "
        "WHERE source LIKE 'external\\_%' ESCAPE '\\'").fetchone()
    backfill_sources = [r[0] for r in con.execute(
        "SELECT DISTINCT source FROM fare_observation "
        "WHERE source LIKE 'external\\_%' ESCAPE '\\'")]
    backfill_routes = sorted({f"{o}-{d}" for o, d in con.execute(
        "SELECT DISTINCT origin, destination FROM fare_observation "
        "WHERE source LIKE 'external\\_%' ESCAPE '\\'")})

    days = []
    for date, n_obs in con.execute(
            f"SELECT substr(collected_at,1,10) d, COUNT(*) FROM fare_observation "
            f"WHERE {LIVE} GROUP BY d ORDER BY d"):
        runs = [r[0] for r in con.execute(
            f"SELECT DISTINCT run_id FROM fare_observation "
            f"WHERE substr(collected_at,1,10)=? AND {LIVE}", (date,))]
        attempts = con.execute(
            "SELECT COUNT(*), SUM(status='OK'), SUM(status!='OK') FROM collection_run "
            "WHERE substr(started_at,1,10)=?", (date,)).fetchone()
        lo, hi = con.execute(
            f"SELECT MIN(collected_at), MAX(collected_at) FROM fare_observation "
            f"WHERE substr(collected_at,1,10)=? AND {LIVE}", (date,)).fetchone()
        days.append({
            "date": date, "n_observations": n_obs,
            "n_cells": index_res["collection"]["cells_per_day"].get(date, 0),
            "n_runs": len(runs), "runs": sorted(runs),
            "attempts": attempts[0], "ok": attempts[1] or 0,
            "failed": attempts[2] or 0,
            # The scheduled slot every day is labelled against. Uniform by
            # construction -- it is the timetable, not a measurement.
            "nominal_time_ist": NOMINAL_IST,
            # What the clock actually read. Never overwritten: this is the
            # provenance trail, and it must keep matching the git commit times.
            "actual_ist": {"first": _ist(lo), "last": _ist(hi)},
            "drift_minutes": _drift_minutes(lo),
            "hour_spread": {"first": lo[11:16], "last": hi[11:16]},   # raw UTC
        })

    varies = len({d["actual_ist"]["first"][:2] for d in days}) > 1

    pax_total = sum(r["pax_cy"] for r in basket["routes"])
    pax_covered = sum(r["pax_cy"] for r in basket["routes"]
                      if f"{r['origin']}-{r['destination']}" in with_fares)

    return {
        "summary": {
            "observations": con.execute(
                f"SELECT COUNT(*) FROM fare_observation WHERE {LIVE}").fetchone()[0],
            "rows_considered": index_res["collection"]["rows_considered"],
            "rows_selected": index_res["collection"]["rows_selected"],
            "collection_runs": con.execute(
                "SELECT COUNT(*) FROM collection_run").fetchone()[0],
            "sweeps": con.execute(
                "SELECT COUNT(DISTINCT run_id) FROM collection_run").fetchone()[0],
            "days": len(days),
            "sources": [r[0] for r in con.execute(
                f"SELECT DISTINCT source FROM fare_observation WHERE {LIVE}")],
        },
        "backfill": {
            "rows": backfill_rows[0],
            "date_range": [backfill_rows[1], backfill_rows[2]] if backfill_rows[0] else None,
            "sources": backfill_sources,
            "routes": backfill_routes,
            "note": "Pre-window historical rows imported from other teams' public "
                    "repos/APIs to cover dates before our own collection started "
                    "(2026-09-10). Not a live sweep, no collection_run behind it, "
                    "and excluded from the index (config.INDEX_SOURCE keeps the "
                    "series on one price source). Kept separate from every count "
                    "and table above so this page still describes only what we "
                    "actually ran.",
        },
        "days": days,
        "clock": {
            "nominal_time_ist": NOMINAL_IST,
            "schedule": "cron 15 5 * * * (05:15 UTC / 10:45 IST), "
                        ".github/workflows/collect.yml",
            "nominal_note": "Every day is labelled with the scheduled slot, the "
                            "way a price is labelled to a reference period rather "
                            "than to the minute it was written down. The actual "
                            "clock time is kept beside it and is never overwritten.",
            "actual_ist_observed": [d["actual_ist"]["first"] for d in days],
            "max_abs_drift_minutes": max((abs(d["drift_minutes"]) for d in days),
                                         default=0),
            "varies_across_days": varies,
            "warning": "Actual collection hour varies across days, so part of the "
                       "measured movement is the clock, not the market. These were "
                       "the manual bootstrap days; the schedule above is what "
                       "unattended runs follow."
            if varies else None,
        },
        "routes": {
            "in_basket": len(in_basket),
            "attempted": len(attempted & set(in_basket)),
            "with_fares": len(with_fares & set(in_basket)),
            # A route the collector never tried is not a failed route. Keeping the
            # two apart matters: one is a coverage gap we chose, the other is a bug.
            "never_attempted": sorted(r for r in in_basket if r not in attempted),
            "attempted_but_no_fares": sorted(
                r for r in in_basket if r in attempted and r not in with_fares),
            "basket_pax_covered_pct": round(100 * pax_covered / pax_total, 2),
            "national_pax_covered_pct": round(
                100 * pax_covered / basket["national_total_pax"], 2),
        },
        "sweep_selection": {
            "rule": "Per (date, route, lead), the latest genuine sweep that covered "
                    "it wins. Selection is per cell, not per day: 2026-09-10 is the "
                    "union of four partial sweeps and has no single complete one.",
            "excluded_runs": index_res["collection"]["excluded_runs"],
            "genuineness_screen": "A sweep whose fetches arrive faster than the "
                                  "collector's own rate limit cannot be live "
                                  "collection. Nothing is excluded at present.",
        },
    }


def sweeps(con, limit: int = 50) -> dict:
    """Recent sweeps, rolled up -- the grain a activity feed wants.

    Every run carries `kind`, because not every run in this table feeds the
    index. The daily fare sweep does; the base-fare/tax split study does not --
    it prices a different concept on a different platform and is pinned out of
    the series by config.INDEX_SOURCE. Showing them in one undifferentiated
    list reads as "we collected three times today", which is not what happened.
    """
    from apix.index.config import INDEX_SOURCE
    rows = con.execute(
        """SELECT run_id, MIN(started_at), MAX(started_at), COUNT(*),
                  SUM(n_quotes), SUM(status='OK'), SUM(status!='OK'), source
           FROM collection_run GROUP BY run_id ORDER BY MIN(started_at) DESC
           LIMIT ?""", (limit,)).fetchall()
    out = []
    for rid, t0, t1, fetches, quotes, ok, bad, source in rows:
        import datetime
        span = (datetime.datetime.fromisoformat(t1)
                - datetime.datetime.fromisoformat(t0)).total_seconds()
        out.append({
            "run_id": rid, "date": t0[:10],
            "started": t0[11:19], "ended": t1[11:19],
            "fetches": fetches, "quotes": quotes or 0,
            "ok": ok or 0, "failed": bad or 0,
            "span_seconds": round(span, 1),
            "seconds_per_fetch": round(span / max(fetches - 1, 1), 2),
            "source": source,
            "feeds_index": source == INDEX_SOURCE,
            "kind": "Daily fare sweep" if source == INDEX_SOURCE
                    else "Base fare / tax study",
        })
    return {"n_sweeps": len(out), "sweeps": out}


def run_log(con, limit: int = 200) -> dict:
    rows = con.execute(
        """SELECT run_id, origin, destination, lead_time_days, departure_date,
                  source, status, n_quotes, elapsed_ms, error, started_at
           FROM collection_run ORDER BY started_at DESC LIMIT ?""", (limit,)).fetchall()
    return {"n_runs": len(rows), "runs": [
        {"run_id": r[0], "route": f"{r[1]}-{r[2]}", "lead_time_days": r[3],
         "departure_date": r[4], "source": r[5], "status": r[6],
         "n_quotes": r[7], "elapsed_ms": r[8], "error": r[9],
         "started_at": r[10]} for r in rows]}
