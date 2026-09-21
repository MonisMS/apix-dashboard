"""Compute and report the APIx index.

    python3 -m apix.index.cli              human-readable
    python3 -m apix.index.cli --json       machine-readable
    python3 -m apix.index.cli --audit      transitivity and coverage checks

Replaces apix/index_calc.py, which took min(total_fare) across all airlines --
the method MoSPI's Expert Group retired (Rec 11, p. 219) -- and collapsed both
aggregation stages into a single weighted geometric mean where the Young index
is arithmetic.
"""
import argparse
import datetime
import json
import os
import pathlib
import sqlite3

from .. import migrate as migrate_mod
from . import chain as chain_mod
from . import clean as clean_mod
from . import weights as weights_mod
from .config import IndexConfig
from .load import collection_hour_spread, load_observations


class InsufficientData(Exception):
    """Not enough collection days to form a link. Recoverable, not fatal."""


HERE = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DB = HERE / "data" / "apix.db"


def compute(con, cfg: IndexConfig = None):
    """Run the whole pipeline. Returns a dict ready for export."""
    cfg = cfg or IndexConfig()
    obs_by_day, report = load_observations(con)
    days = sorted(obs_by_day)
    if len(days) < 2:
        # A normal exception, not SystemExit. SystemExit is a BaseException:
        # a web server's exception middleware does not catch it, so raising it
        # from library code can tear down the worker rather than return a 503.
        raise InsufficientData(
            f"need at least two collection days to form a link; have {len(days)}")

    # The base window is every day collected so far, while that is still short.
    window = tuple(days)

    base_obs = [o for d in window for o in obs_by_day[d]]
    cell_w, provenance = weights_mod.build(base_obs)

    screened, flags, screen_report = clean_mod.screen(obs_by_day, cfg)

    results = chain_mod.build_raw_series(
        obs_by_day, cell_w, screened=screened,
        max_consecutive=cfg.max_consecutive_imputations,
        thin_threshold=cfg.thin_cell_threshold)
    factor = chain_mod.reference_factor(results, window)
    provisional = len(window) < 28
    label = chain_mod.reference_label(window, provisional)
    points = chain_mod.to_points(results, factor)

    return {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        # reference.factor is rounded for publication, but to_points hashed the
        # UNROUNDED value -- and canonical_payload rounds to 12dp, so the two
        # are not interchangeable inside a digest. _factor_raw carries the exact
        # float so a stored vintage can reproduce its own hashes. Private key:
        # public() strips it, so no API response changes.
        "_factor_raw": factor,
        "reference": {"label": label, "window": list(window),
                      "factor": round(factor, 8), "is_provisional": provisional},
        "methodology": {
            "elementary": "Jevons -- unweighted geometric mean of matched price "
                          "relatives (CPI Manual eq. 9.1; MoSPI EG 4.6.1.1 short index)",
            "aggregation": "Young -- weighted arithmetic mean of elementary index "
                           "levels (CPI Manual eq. 9.11; MoSPI EG 4.6.2.4)",
            "cell": "origin x destination x carrier x departure band x advance-purchase "
                    "lag; economy, non-stop, INR (MoSPI EG Recommendation 11)",
            "item": "an individual flight (carrier + flight number) matched between "
                    "consecutive collection days",
            "weights": provenance,
            "imputation": "explicit, from the parent aggregate's short-term movement; "
                          "carry-forward is prohibited (CPI Manual 8.54)",
            "caveat": "MoSPI publishes no airfare-specific compilation rule. Airfare is "
                      "one priced item, so the generic Jevons-short + Young machinery "
                      "applies. That is our inference, not a published MoSPI method.",
        },
        "collection": {
            "rows_considered": report.n_rows_in,
            "rows_selected": report.n_rows_selected,
            "runs_per_day": report.runs_per_day,
            "cells_per_day": report.cells_per_day,
            "excluded_runs": report.excluded_runs,
            "collection_hour_spread": collection_hour_spread(con),
        },
        "cleaning": screen_report,
        "points": [p._asdict() for p in points],
        "_results": results,
        "_flags": flags,
        "_cfg": cfg,
        "_weights": cell_w,
        "_obs": obs_by_day,
    }


def audit(res) -> dict:
    """Checks that make the result falsifiable rather than merely asserted."""
    obs, w = res["_obs"], res["_weights"]
    days = sorted(obs)
    chained = res["_results"][-1].raw_level
    direct = chain_mod.direct_index(obs, w)
    drift = (chained / direct - 1) * 100
    return {
        "transitivity": {
            "chained_raw_level": round(chained, 6),
            "direct_fixed_base": round(direct, 6),
            "drift_pct": round(drift, 6),
            "note": "Jevons is transitive (Manual 8.383), so on a CONSTANT sample "
                    "these are identical. The gap is caused by sample churn: cells "
                    "matched day-to-day but not first-to-last, and vice versa.",
        },
        "churn": {
            d.date: {"items_matched": d.n_items_matched, "items_prev": d.n_items_prev,
                     "match_rate": round(d.n_items_matched / d.n_items_prev, 4)
                     if d.n_items_prev else None,
                     "cells_imputed": d.n_imputed, "cells_thin": d.n_thin}
            for d in res["_results"][1:]
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.getenv("APIX_DB") or str(DEFAULT_DB))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--audit", action="store_true")
    a = ap.parse_args()

    con = sqlite3.connect(a.db)
    migrate_mod.assert_version(con)
    try:
        res = compute(con)
    except InsufficientData as e:
        raise SystemExit(str(e))

    if a.json:
        out = {k: v for k, v in res.items() if not k.startswith("_")}
        if a.audit:
            out["audit"] = audit(res)
        print(json.dumps(out, indent=2, default=str))
        return

    ref = res["reference"]
    print(f"\n  {ref['label']}")
    print(f"  {res['methodology']['elementary']}")
    print(f"  {res['methodology']['aggregation']}\n")
    print(f"  {'date':<12}{'index':>9}{'d/d %':>9}{'cells':>8}{'imp':>6}"
          f"{'thin':>6}{'matched':>9}{'of':>7}")
    prev = None
    for p in res["points"]:
        pct = "" if prev is None else f"{(p['level'] / prev - 1) * 100:+.2f}"
        print(f"  {p['period_start']:<12}{p['level']:>9.2f}{pct:>9}"
              f"{p['n_cells']:>8}{p['n_cells_imputed']:>6}{p['n_cells_thin']:>6}"
              f"{p['n_items_matched']:>9}{p['n_items_prev']:>7}")
        prev = p["level"]

    c = res["collection"]
    print(f"\n  observations: {c['rows_selected']:,} selected of {c['rows_considered']:,}")
    for d, (lo, hi) in c["collection_hour_spread"].items():
        runs = len(c["runs_per_day"].get(d, []))
        print(f"    {d}: {c['cells_per_day'].get(d, 0):>3} cells, "
              f"{runs} run(s), collected {lo}-{hi} IST")
    if len({v[0][:2] for v in c["collection_hour_spread"].values()}) > 1:
        print("    ! collection hour varies across days -- part of the measured "
              "movement is the clock, not the market")

    if a.audit:
        au = audit(res)
        t = au["transitivity"]
        print(f"\n  transitivity audit (Manual 8.383)")
        print(f"    chained  : {t['chained_raw_level']}")
        print(f"    direct   : {t['direct_fixed_base']}")
        print(f"    drift    : {t['drift_pct']:+.4f}%  <- caused by sample churn")
        print(f"\n  churn")
        for d, v in au["churn"].items():
            print(f"    {d}: {v['items_matched']}/{v['items_prev']} items matched "
                  f"({v['match_rate']:.1%}), {v['cells_imputed']} cells imputed")


if __name__ == "__main__":
    main()
