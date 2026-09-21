"""Write a computed index vintage into Neon.

    APIX_PG_URL=postgresql://... python3 -m apix.store.publish [--git-sha SHA]

The engine is untouched: this takes the dict cli.compute() already returns and
serialises it. No index maths happens here, and none happens in TypeScript --
that is the whole point of precomputing.

Atomicity
---------
Everything lands inside one transaction, under an advisory lock, with the run
marked DRAFT. The flip to PUBLISHED is the last statement before commit, and
ix_one_published (a partial unique index) makes a second PUBLISHED row a
database error rather than a silent duplicate. So a reader mid-write sees the
previous vintage, whole; a crash leaves yesterday's numbers serving.
"""
import argparse
import datetime
import json
import sys

from ..index import cli
from ..index import repro
from ..index.config import LEAD_TIMES
from ..index.load_pg import collection_hour_spread_pg, load_observations_pg
from ..index.subseries import (carrier_series_id, route_series_id,
                               route_window_series_id, series_from_predicate,
                               window_series_id)
from . import pg

# Any bigint works; it just has to be the same number in every publisher.
PUBLISH_LOCK = 8_142_026


def compute_from_neon(con):
    """Run the pipeline against Postgres by rebinding cli's loaders."""
    saved = (cli.load_observations, cli.collection_hour_spread)
    try:
        cli.load_observations = load_observations_pg
        cli.collection_hour_spread = collection_hour_spread_pg
        res = cli.compute(con)
        res["_audit"] = cli.audit(res)
        return res
    finally:
        cli.load_observations, cli.collection_hour_spread = saved


def _sub_series(res):
    """Every drill-down series, under its canonical id. See subseries.py."""
    weights = res["_weights"]
    out = []
    for o, d in sorted({c.route for c in weights}):
        pts, share = series_from_predicate(
            res, lambda c, o=o, d=d: c.route == (o, d), route_series_id(o, d))
        out.append(dict(series_id=route_series_id(o, d), kind="route",
                        origin=o, destination=d, carrier=None, lead=None,
                        share=share, points=pts))
    for name in sorted({c.carrier for c in weights}):
        pts, share = series_from_predicate(
            res, lambda c, n=name: c.carrier == n, carrier_series_id(name))
        out.append(dict(series_id=carrier_series_id(name), kind="carrier",
                        origin=None, destination=None, carrier=name, lead=None,
                        share=share, points=pts))
    for lead in LEAD_TIMES:
        pts, share = series_from_predicate(
            res, lambda c, l=lead: c.lead_time_days == l, window_series_id(lead))
        out.append(dict(series_id=window_series_id(lead), kind="window",
                        origin=None, destination=None, carrier=None, lead=lead,
                        share=share, points=pts))
    # route x lead, for route_detail's by_lead_window block.
    for o, d in sorted({c.route for c in weights}):
        for lead in LEAD_TIMES:
            sid = route_window_series_id(o, d, lead)
            pts, share = series_from_predicate(
                res,
                lambda c, o=o, d=d, l=lead: c.route == (o, d) and c.lead_time_days == l,
                sid)
            out.append(dict(series_id=sid, kind="route_window", origin=o,
                            destination=d, carrier=None, lead=lead,
                            share=share, points=pts))
    return out


def _naive(res):
    """api/services/index.py:naive_comparison, called directly.

    Importing the service module would drag FastAPI into the pipeline's
    dependency set for one function, so it is reached lazily instead.
    """
    from api.services import index as index_svc
    return index_svc.naive_comparison(res)


def load_basket(con):
    """Mirror apix/data/route_basket.json into Postgres.

    coverage() has to report routes that have no fares yet, and no query over
    observations can know about a route nobody has collected.
    """
    import json
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "data" / "route_basket.json"
    b = json.loads(path.read_text())
    con.cursor().executemany(
        "INSERT INTO route_basket (origin, destination, city_a, city_b, pax_cy, "
        "national_share_pct) VALUES (%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (origin, destination) DO UPDATE SET "
        "city_a=EXCLUDED.city_a, city_b=EXCLUDED.city_b, pax_cy=EXCLUDED.pax_cy, "
        "national_share_pct=EXCLUDED.national_share_pct",
        [(r["origin"], r["destination"], r.get("city_a"), r.get("city_b"),
          r.get("pax_cy"), r.get("national_share_pct")) for r in b["routes"]],
    )
    con.cursor().executemany(
        "INSERT INTO basket_meta (k, v) VALUES (%s,%s) "
        "ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v",
        [(k, b[k]) for k in ("national_total_pax", "basket_total_pax",
                             "basket_covers_pct_of_national", "n_routes")
         if k in b],
    )
    return len(b["routes"])


def _prose(con, run_id, key, body):
    con.execute(
        "INSERT INTO vintage_prose (index_run_id, key, body) VALUES (%s,%s,%s) "
        "ON CONFLICT (index_run_id, key) DO UPDATE SET body = EXCLUDED.body",
        (run_id, key, json.dumps(body, default=str)))


def _publish_quality(con, run_id, res):
    """Precompute /cleaning, /availability and /validation.

    All three are deterministic functions of the vintage, and all three are
    expensive or subtle enough that recomputing them in TypeScript would be
    the wrong call: cleaning's sensitivity re-runs the whole chaining state
    machine three times, availability needs sample (n-1) variance for Welch's
    t, and validation is 280 lines of calendar-month alignment.
    """
    from api.services import index as index_svc, reference as reference_svc

    # --- cleaning ------------------------------------------------------
    cl = index_svc.cleaning(res)
    con.cursor().executemany(
        "INSERT INTO cleaning_day (index_run_id, obs_date, n_relatives, "
        "n_extreme, n_mad, n_screened, share_screened) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        [(run_id, d, v.get("n_relatives"), v.get("n_extreme"), v.get("n_mad"),
          v.get("n_screened"), v.get("share_screened"))
         for d, v in (cl.get("per_day") or {}).items()])
    con.cursor().executemany(
        "INSERT INTO cleaning_sensitivity (index_run_id, regime, final_raw_level, "
        "n_screened, n_cells_imputed_final, diff_from_unscreened_pct, error) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        [(run_id, regime, v.get("final_raw_level"), v.get("n_screened"),
          v.get("n_cells_imputed_final"), v.get("diff_from_unscreened_pct"),
          v.get("error"))
         for regime, v in (cl.get("sensitivity") or {}).items()])
    _prose(con, run_id, "cleaning.header",
           {k: cl[k] for k in ("enabled", "hard_bound", "mad", "treatment", "n_flags")
            if k in cl})

    # --- availability ---------------------------------------------------
    av = index_svc.availability(res, con)
    dis = av.get("disappearance", {})
    con.cursor().executemany(
        """INSERT INTO availability_transition
           (index_run_id, from_date, to_date, n_prev, n_vanished, n_survived,
            n_appeared, vanish_rate, mean_fare_vanished, mean_fare_survived,
            median_fare_vanished, median_fare_survived, price_differential_pct,
            arithmetic_mean_differential_pct, welch_t, welch_df, significant_5pct)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        [(run_id, t["from"], t["to"], t.get("n_prev"), t.get("n_vanished"),
          t.get("n_survived"), t.get("n_appeared"), t.get("vanish_rate"),
          t.get("mean_fare_vanished"), t.get("mean_fare_survived"),
          t.get("median_fare_vanished"), t.get("median_fare_survived"),
          t.get("price_differential_pct"),
          t.get("arithmetic_mean_differential_pct"),
          (t.get("test") or {}).get("t"), (t.get("test") or {}).get("df"),
          (t.get("test") or {}).get("significant_5pct"))
         for t in dis.get("transitions", [])])

    bb = av.get("bias_bound", {})
    rows = []
    for day in bb.get("per_day", []):
        for label, pp in (day.get("index_bias_pp") or {}).items():
            rows.append((run_id, day["to"], day.get("weight_share_vanished"),
                         float(label.rstrip("%")), pp))
    con.cursor().executemany(
        "INSERT INTO availability_bias_bound (index_run_id, to_date, "
        "weight_share_vanished, excess_move_pct, index_bias_pp) "
        "VALUES (%s,%s,%s,%s,%s)", rows)

    _prose(con, run_id, "availability.summary", {
        "disappearance": {k: v for k, v in dis.items() if k != "transitions"},
        "bias_bound": {k: v for k, v in bb.items() if k != "per_day"},
        "observed_availability": av.get("observed_availability"),
    })

    # --- validation -------------------------------------------------------
    val = reference_svc.validation(res)
    con.execute(
        "INSERT INTO validation_run (index_run_id, correlation, "
        "correlation_reason, harness, overlap) VALUES (%s,%s,%s,%s,%s)",
        (run_id, val.get("correlation"), val.get("correlation_reason"),
         json.dumps(val.get("harness"), default=str),
         json.dumps(val.get("overlap"), default=str)))
    pairs = ((val.get("harness") or {}).get("comparison") or {}).get("pairs") or []
    con.cursor().executemany(
        "INSERT INTO validation_pair (index_run_id, period, apix_pct, mospi_pct, "
        "error_pp) VALUES (%s,%s,%s,%s,%s)",
        [(run_id, p.get("period"), p.get("apix_pct"), p.get("mospi_pct"),
          p.get("error_pp")) for p in pairs])
    _prose(con, run_id, "validation.apix",
           {k: v for k, v in (val.get("apix") or {}).items() if k != "points"})
    _prose(con, run_id, "validation.mospi",
           {k: v for k, v in (val.get("mospi") or {}).items() if k != "points"})


def publish(res, con, *, git_sha=None, status="PUBLISHED") -> int:
    ref = res["reference"]
    cfg = res["_cfg"]
    days = sorted(res["_obs"])
    now = datetime.datetime.now(datetime.timezone.utc)
    run_uid = f"{now.strftime('%Y-%m-%dT%H:%M:%SZ')}/{git_sha or 'local'}"

    with con.transaction():
        con.execute("SELECT pg_advisory_xact_lock(%s)", (PUBLISH_LOCK,))

        ws = con.execute(
            "INSERT INTO weight_set (name, price_reference_window, provenance) "
            "VALUES (%s, %s, %s) RETURNING id",
            (f"ws-{run_uid}", list(ref["window"]),
             json.dumps(res["methodology"]["weights"], default=str)),
        ).fetchone()["id"]

        con.cursor().executemany(
            "INSERT INTO weight (weight_set_id, level, origin, destination, "
            "lead_time_days, carrier, dep_band, weight) "
            "VALUES (%s,'CELL',%s,%s,%s,%s,%s,%s)",
            [(ws, c.origin, c.destination, c.lead_time_days, c.carrier,
              c.dep_band, w) for c, w in res["_weights"].items()],
        )

        run_id = con.execute(
            """INSERT INTO index_run
               (run_uid, generated_at_raw, method_version, git_sha, weight_set_id,
                config, reference_factor, reference_label, reference_window,
                is_provisional, status, n_obs_in, n_obs_selected, n_collection_days)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'DRAFT',%s,%s,%s)
               RETURNING id""",
            (run_uid, res["generated_at"], repro.METHOD_VERSION, git_sha, ws,
             json.dumps(cfg._asdict() if hasattr(cfg, "_asdict") else str(cfg),
                        default=str),
             # The RAW factor, not ref["factor"] (rounded to 8dp for display):
             # the digests were taken over this value. Handlers round on output.
             res["_factor_raw"], ref["label"], list(ref["window"]),
             ref["is_provisional"],
             (res.get("collection") or {}).get("rows_considered"),
             sum(len(v) for v in res["_obs"].values()), len(days)),
        ).fetchone()["id"]

        # --- headline ---------------------------------------------------
        con.execute(
            "INSERT INTO series (index_run_id, series_id, kind, label, weight_share, n_cells) "
            "VALUES (%s,'APIX.ALL','headline',%s,1.0,%s)",
            (run_id, "APIx all-India airfare index", len(res["_weights"])),
        )
        con.cursor().executemany(
            """INSERT INTO index_point
               (index_run_id, series_id, freq, period_start, period_end, level,
                link, n_cells, n_cells_imputed, n_cells_thin, n_cells_dead,
                n_items_matched, n_items_prev, n_items_screened, weight_covered,
                weight_imputed, n_days, is_provisional, quality, method_version,
                repro_hash)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [(run_id, p["series_id"], p["freq"], p["period_start"], p["period_end"],
              p["level"], p["link"], p["n_cells"], p["n_cells_imputed"],
              p["n_cells_thin"], p["n_cells_dead"], p["n_items_matched"],
              p["n_items_prev"], p["n_items_screened"], p["weight_covered"],
              p["weight_imputed"], p["n_days"], p["is_provisional"],
              # list(), not the raw tuple: psycopg adapts a tuple as a
              # composite type and Postgres rejects it as an array literal.
              list(p["quality"] or []), repro.METHOD_VERSION, p["repro_hash"])
             for p in res["points"]],
        )

        # --- drill-downs --------------------------------------------------
        subs = _sub_series(res)
        con.cursor().executemany(
            "INSERT INTO series (index_run_id, series_id, kind, origin, destination, "
            "carrier, lead_time_days, weight_share) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            [(run_id, s["series_id"], s["kind"], s["origin"], s["destination"],
              s["carrier"], s["lead"], s["share"]) for s in subs],
        )
        con.cursor().executemany(
            """INSERT INTO index_point
               (index_run_id, series_id, freq, period_start, period_end, level,
                pct_change_1p, is_provisional, method_version, repro_hash)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [(run_id, s["series_id"], p["freq"], p["period_start"], p["period_end"],
              p["level"], p["pct_change_1p"], ref["is_provisional"],
              repro.METHOD_VERSION, p["repro_hash"])
             for s in subs for p in s["points"]],
        )

        # --- the reproducibility substrate ---------------------------------
        elem = []
        for day in res["_results"]:
            for cell in set(day.links) | set(day.cell_levels):
                lk = day.links.get(cell)
                elem.append((
                    run_id, day.date, cell.origin, cell.destination,
                    cell.lead_time_days, cell.carrier, cell.dep_band,
                    lk.link if lk else None,
                    day.cell_levels.get(cell),
                    day.weights.get(cell),
                    lk.n_matched if lk else None, lk.n_prev if lk else None,
                    lk.n_cur if lk else None, lk.n_screened if lk else None,
                    bool(lk.is_imputed) if lk else False,
                    lk.imputation_source if lk else None,
                    lk.imputation_run_len if lk else None,
                    lk.quality if lk else None,
                ))
        con.cursor().executemany(
            """INSERT INTO elementary_index
               (index_run_id, obs_date, origin, destination, lead_time_days,
                carrier, dep_band, link, level, weight, n_matched, n_prev, n_cur,
                n_screened, is_imputed, imputation_source, imputation_run_len, quality)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            elem)

        con.cursor().executemany(
            "INSERT INTO index_observation (index_run_id, observation_id) "
            "VALUES (%s,%s) ON CONFLICT DO NOTHING",
            [(run_id, o.observation_id) for v in res["_obs"].values() for o in v],
        )

        con.cursor().executemany(
            "INSERT INTO observation_flag (index_run_id, observation_id, flag, "
            "detail, ord) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            # ord preserves the screening pass's own emission order, which is
            # what /cleaning publishes.
            [(run_id, f.observation_id, f.flag, f.detail, i)
             for i, f in enumerate(res["_flags"])],
        )

        coll = res.get("collection", {})
        spread = coll.get("collection_hour_spread", {})
        cells = coll.get("cells_per_day", {})
        runs = coll.get("runs_per_day", {})
        con.cursor().executemany(
            "INSERT INTO collection_day_stat "
            "(index_run_id, obs_date, n_cells, run_ids, first_ist, last_ist) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            [(run_id, d, cells.get(d, 0), list(runs.get(d, [])),
              (spread.get(d) or (None, None))[0], (spread.get(d) or (None, None))[1])
             for d in days],
        )

        # --- naive comparison + audit -------------------------------------
        naive = res.get("naive_comparison") or _naive(res)
        con.cursor().executemany(
            "INSERT INTO naive_point (index_run_id, period_start, level, n_obs) "
            "VALUES (%s,%s,%s,%s)",
            [(run_id, p["period_start"], p["level"], p["n_obs"])
             for p in naive.get("points", [])],
        )
        audit = res.get("_audit") or {}
        trans = audit.get("transitivity", {})
        con.execute(
            "UPDATE index_run SET naive_base_day=%s, naive_divergence_pp=%s, "
            "audit_chained_raw_level=%s, audit_direct_fixed_base=%s, "
            "audit_drift_pct=%s WHERE id=%s",
            (naive.get("base_day"), naive.get("divergence_pp"),
             trans.get("chained_raw_level"), trans.get("direct_fixed_base"),
             trans.get("drift_pct"), run_id),
        )
        con.cursor().executemany(
            "INSERT INTO audit_churn (index_run_id, obs_date, items_matched, "
            "items_prev, match_rate, cells_imputed, cells_thin) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            [(run_id, d, c.get("items_matched"), c.get("items_prev"),
              c.get("match_rate"), c.get("cells_imputed"), c.get("cells_thin"))
             for d, c in (audit.get("churn") or {}).items()],
        )

        # --- quality blocks: /cleaning, /availability, /validation ---------
        _publish_quality(con, run_id, res)

        excl = coll.get("excluded_runs", {}) or {}
        if excl:
            con.cursor().executemany(
                "INSERT INTO sweep_exclusion (index_run_id, run_id, reason) "
                "VALUES (%s,%s,%s)",
                [(run_id, r, why) for r, why in excl.items()])

        # Last: retire the old vintage and promote this one, together.
        #
        # Only retire when this run is actually taking over. Superseding
        # unconditionally meant a --status DRAFT run left NO published
        # vintage: the old one was retired and the new one never promoted,
        # so every handler reading WHERE status='PUBLISHED' found nothing.
        if status == "PUBLISHED":
            con.execute("UPDATE index_run SET status='SUPERSEDED' "
                        "WHERE status='PUBLISHED' AND id <> %s", (run_id,))
        con.execute("UPDATE index_run SET status=%s WHERE id=%s", (status, run_id))

    return run_id


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--git-sha", default=None)
    ap.add_argument("--status", default="PUBLISHED",
                    choices=["PUBLISHED", "DRAFT", "SUPERSEDED"])
    args = ap.parse_args()

    with pg.connect() as con:
        print("  computing from Neon ...")
        res = compute_from_neon(con)
        print(f"    {len(res['points'])} points, {len(res['_weights'])} cells, "
              f"{len(res['_results'])} days")
        print("  syncing route basket ...")
        n = load_basket(con)
        con.commit()
        print(f"    {n} basket routes")
        print("  publishing ...")
        run_id = publish(res, con, git_sha=args.git_sha, status=args.status)

        row = con.execute(
            "SELECT run_uid, status, reference_factor FROM index_run WHERE id=%s",
            (run_id,)).fetchone()
        counts = {
            t: con.execute(
                f"SELECT COUNT(*) AS n FROM {t} WHERE index_run_id=%s", (run_id,)
            ).fetchone()["n"]
            for t in ("series", "index_point", "elementary_index",
                      "index_observation", "observation_flag", "collection_day_stat")
        }
    print(f"    run {run_id}  {row['run_uid']}  [{row['status']}]")
    for t, n in counts.items():
        print(f"      {t:<22} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
