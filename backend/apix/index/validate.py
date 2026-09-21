"""Validation against MoSPI's published Airfare index (item 07.3.3.1.2.01).

The claim the whole project rests on is that APIx tracks a number MoSPI already
publishes, faster. That claim is worthless until it is tested, and it has never
been tested -- not by us, and not by the competing entry, whose dashboard has
been comparing against the wrong series entirely.

This is the test.

WHAT IS COMPARED, AND WHY IT IS NOT THE LEVELS
----------------------------------------------
MoSPI is 2024=100 over a national basket of airfare purchases. APIx is a
three-day provisional window = 100 over twelve city pairs. The two levels are on
different scales measuring different scopes; putting them on one axis would look
like a comparison and be nothing of the kind.

So we compare **month-on-month percentage change**. That is scale-free, it is
what "tracking" actually means, and it is the number the RBI reacts to.

SUCCESS CRITERIA, FIXED BEFORE THE FIRST RESULT
------------------------------------------------
Written down in advance so the test cannot be graded after the fact:

    sign agreement  >= 0.70     we agree on the DIRECTION at least 7 months in 10
    Pearson r       >= 0.60     the movements are related, not coincidental
    mean abs error  <= 4.0 pp   typical monthly gap under four percentage points
    mean bias       within +-2 pp   we are not systematically high or low

Those thresholds are judgements, not standards -- no statistical office
publishes a bar for this. They are calibrated against MoSPI's own volatility:
their airfare index moves with a standard deviation of 7.32 pp per month, so a
4 pp mean error is roughly half their own monthly noise.

WHAT THE ANSWER IS TODAY
------------------------
There is none. MoSPI's series ends 2026-07; APIx begins 2026-09-10. Zero
overlapping months, so every metric is null and stays null. This module will not
interpolate MoSPI to a daily frequency, will not compare levels across different
bases, and will not report a correlation computed from fewer months than it
takes for one to mean anything.

What it does instead is state the first month a real answer becomes possible,
prove its own arithmetic on cases with known answers (`self_test`), and report
the one honest piece of evidence available now: whether APIx is moving in the
direction MoSPI's own history says September moves.
"""
import csv
import datetime
import math
import pathlib
import statistics
from typing import Sequence

ROOT = pathlib.Path(__file__).resolve().parents[2]
MOSPI_CSV = ROOT / "apix" / "exports" / "mospi_airfare_index.csv"

# Fixed in advance. See the module docstring.
CRITERIA = {
    "min_sign_agreement": 0.70,
    "min_correlation": 0.60,
    "max_mean_abs_error_pp": 4.0,
    "max_abs_mean_bias_pp": 2.0,
}

# Below these counts a metric is not reported at all, rather than reported with
# a caveat. A correlation over two points is always +/-1 and means nothing.
MIN_MONTHS_FOR_CORRELATION = 6
MIN_MONTHS_FOR_ERROR = 3


# --- the series ------------------------------------------------------------

def load_mospi(path: pathlib.Path = MOSPI_CSV) -> list:
    """MoSPI's published monthly Airfare index."""
    if not path.exists():
        return []
    out = []
    with open(path) as f:
        for r in csv.DictReader(f):
            out.append({"period": f"{int(r['year'])}-{int(r['month']):02d}",
                        "level": float(r["index_2024_base"])})
    return sorted(out, key=lambda p: p["period"])


def monthly_from_daily(points: Sequence[dict], min_days: int = 20) -> list:
    """Collapse a daily APIx series into complete calendar months.

    `min_days` guards the comparison: a month built from three days is not a
    month, and comparing it to MoSPI's full-month figure would be measuring our
    collection gaps rather than the market. Incomplete months are returned with
    `complete: False` so a caller can show them without comparing them.
    """
    by_month = {}
    for p in points:
        by_month.setdefault(p["period_start"][:7], []).append(p)
    out = []
    for period, pts in sorted(by_month.items()):
        pts = sorted(pts, key=lambda p: p["period_start"])
        out.append({
            "period": period,
            "level": pts[-1]["level"],          # chained level at month end
            "mean_level": round(statistics.fmean(p["level"] for p in pts), 4),
            "n_days": len(pts),
            "complete": len(pts) >= min_days,
        })
    return out


def pct_changes(series: Sequence[dict]) -> list:
    """Month-on-month % change. Only between CONSECUTIVE calendar months.

    A gap in the series must not be silently treated as one month's movement.
    """
    out = []
    for a, b in zip(series, series[1:]):
        if _months_between(a["period"], b["period"]) != 1:
            continue
        out.append({"period": b["period"],
                    "pct": (b["level"] / a["level"] - 1) * 100})
    return out


def _months_between(a: str, b: str) -> int:
    ya, ma = int(a[:4]), int(a[5:7])
    yb, mb = int(b[:4]), int(b[5:7])
    return (yb - ya) * 12 + (mb - ma)


# --- metrics ---------------------------------------------------------------

def pearson(xs: Sequence[float], ys: Sequence[float]):
    n = len(xs)
    if n < 2:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None          # a flat series has no correlation, not r=0
    return num / (dx * dy)


def spearman(xs: Sequence[float], ys: Sequence[float]):
    """Rank correlation -- robust to one outlying month dominating Pearson."""
    if len(xs) < 2:
        return None
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        for pos, i in enumerate(order):
            r[i] = pos + 1.0
        return r
    return pearson(ranks(list(xs)), ranks(list(ys)))


def compare(apix: Sequence[dict], mospi: Sequence[dict]) -> dict:
    """Align on common months and score the month-on-month movements."""
    a = {p["period"]: p["pct"] for p in pct_changes(apix)}
    m = {p["period"]: p["pct"] for p in pct_changes(mospi)}
    common = sorted(a.keys() & m.keys())
    n = len(common)

    result = {
        "n_months": n,
        "periods": common,
        "pairs": [{"period": p, "apix_pct": round(a[p], 4),
                   "mospi_pct": round(m[p], 4),
                   "error_pp": round(a[p] - m[p], 4)} for p in common],
        "correlation": None, "spearman": None,
        "mean_abs_error_pp": None, "rmse_pp": None,
        "mean_bias_pp": None, "sign_agreement": None,
        "verdict": "NOT_COMPARABLE",
        "reasons": [],
    }
    if n == 0:
        result["reasons"].append(
            "No month appears in both series, so nothing can be compared.")
        return result

    av = [a[p] for p in common]
    mv = [m[p] for p in common]
    errs = [x - y for x, y in zip(av, mv)]

    if n >= MIN_MONTHS_FOR_ERROR:
        result["mean_abs_error_pp"] = round(statistics.fmean(abs(e) for e in errs), 4)
        result["rmse_pp"] = round(math.sqrt(statistics.fmean(e * e for e in errs)), 4)
        result["mean_bias_pp"] = round(statistics.fmean(errs), 4)
        result["sign_agreement"] = round(
            sum(1 for x, y in zip(av, mv) if (x >= 0) == (y >= 0)) / n, 4)
    else:
        result["reasons"].append(
            f"{n} overlapping month(s); error statistics need at least "
            f"{MIN_MONTHS_FOR_ERROR}.")

    if n >= MIN_MONTHS_FOR_CORRELATION:
        result["correlation"] = round(pearson(av, mv) or 0.0, 4)
        result["spearman"] = round(spearman(av, mv) or 0.0, 4)
    else:
        result["reasons"].append(
            f"{n} overlapping month(s); a correlation needs at least "
            f"{MIN_MONTHS_FOR_CORRELATION} to carry any meaning.")

    if result["correlation"] is not None and result["mean_abs_error_pp"] is not None:
        checks = {
            "sign_agreement": result["sign_agreement"] >= CRITERIA["min_sign_agreement"],
            "correlation": result["correlation"] >= CRITERIA["min_correlation"],
            "mean_abs_error": result["mean_abs_error_pp"] <= CRITERIA["max_mean_abs_error_pp"],
            "mean_bias": abs(result["mean_bias_pp"]) <= CRITERIA["max_abs_mean_bias_pp"],
        }
        result["checks"] = checks
        result["verdict"] = "PASS" if all(checks.values()) else "FAIL"
    return result


# --- when can this run, and what can we say meanwhile ----------------------

def first_comparable_month(apix_daily: Sequence[dict], mospi: Sequence[dict],
                           min_days: int = 20) -> dict:
    """The earliest month that could ever produce a real comparison."""
    import calendar
    if not apix_daily:
        return {"month": None, "reason": "no APIx data"}
    start = apix_daily[0]["period_start"]
    y, m = int(start[:4]), int(start[5:7])
    day = int(start[8:10])
    # A month we began collecting mid-way through cannot reach min_days.
    if calendar.monthrange(y, m)[1] - day + 1 < min_days:
        m += 1
        if m > 12:
            y, m = y + 1, 1
    first = f"{y}-{m:02d}"
    last_mospi = mospi[-1]["period"] if mospi else None

    # How much slack is there? If the first candidate month is the one we began
    # part-way through, the margin can be a day or two -- worth saying out loud,
    # because a single missed sweep then pushes the answer back a whole month.
    days_in = calendar.monthrange(y, m)[1]
    available = days_in - day + 1 if first == start[:7] else days_in
    slack = available - min_days
    nxt_m, nxt_y = (m + 1, y) if m < 12 else (1, y + 1)

    return {
        "month": first,
        "apix_first_day": start,
        "mospi_last_published": last_mospi,
        "days_available_in_month": available,
        "days_required": min_days,
        "slack_days": slack,
        "at_risk": slack <= 3,
        "requires": [
            f"APIx collects at least {min_days} of the {available} remaining days "
            f"in {first} -- room to miss {max(slack, 0)}",
            f"MoSPI publishes its Airfare index for {first}",
        ],
        "fallback_month": f"{nxt_y}-{nxt_m:02d}",
        "note": "MoSPI releases a month's CPI around the 12th of the following "
                "month, so the earliest a real answer can exist is mid-"
                f"{nxt_y}-{nxt_m:02d}. Missing more than "
                f"{max(slack, 0)} collection day(s) pushes it to "
                f"{nxt_y}-{nxt_m:02d}.",
    }


def seasonal_context(mospi: Sequence[dict], month: int) -> dict:
    """What MoSPI's own history says about this calendar month.

    The only honest evidence available before the series overlap: if APIx says
    September is falling and MoSPI's own September fell in every year they have
    published, that is consistent. It is not confirmation, and it is labelled
    as such.
    """
    changes = pct_changes(mospi)
    same = [c for c in changes if int(c["period"][5:7]) == month]
    if not same:
        return {"month": month, "n_years": 0,
                "note": "MoSPI has published no prior instance of this month."}
    vals = [c["pct"] for c in same]
    return {
        "month": month,
        "n_years": len(vals),
        "observations": [{"period": c["period"], "pct": round(c["pct"], 2)}
                         for c in same],
        "mean_pct": round(statistics.fmean(vals), 2),
        "all_negative": all(v < 0 for v in vals),
        "all_positive": all(v > 0 for v in vals),
        "caveat": "A direction consistent with MoSPI's own history is weak "
                  "corroboration, not validation. With one prior year it is a "
                  "single observation.",
    }


def profile(mospi: Sequence[dict]) -> dict:
    """MoSPI's own volatility -- the yardstick our thresholds are set against."""
    ch = [c["pct"] for c in pct_changes(mospi)]
    if not ch:
        return {}
    return {
        "n_points": len(mospi),
        "first": mospi[0]["period"], "last": mospi[-1]["period"],
        "level_min": min(p["level"] for p in mospi),
        "level_max": max(p["level"] for p in mospi),
        "mom_min_pct": round(min(ch), 2), "mom_max_pct": round(max(ch), 2),
        "mom_mean_pct": round(statistics.fmean(ch), 2),
        "mom_sd_pct": round(statistics.pstdev(ch), 2),
        "note": "MoSPI's own airfare index swings by this much month to month. "
                "Daily airfare volatility in APIx is the same phenomenon at a "
                "finer grain, not an artefact of our method.",
    }


# --- proving the arithmetic ------------------------------------------------

def self_test() -> dict:
    """Run the metrics on cases whose answers are known in advance.

    A harness that has never produced a correct answer on a case we can check is
    not evidence of anything. These run on every call so the numbers on the
    dashboard are accompanied by proof the code computing them works.
    """
    def series(vals, start="2025-01"):
        y, m = int(start[:4]), int(start[5:7])
        out = []
        for v in vals:
            out.append({"period": f"{y}-{m:02d}", "level": v})
            m += 1
            if m > 12:
                y, m = y + 1, 1
        return out

    base = series([100, 110, 99, 120, 108, 130, 117])
    identical = compare(base, base)
    inverted = compare(series([100, 90, 100, 83, 92, 77, 86]), base)
    shifted = series([v * 1.5 for v in [100, 110, 99, 120, 108, 130, 117]])
    scaled = compare(shifted, base)

    return {
        "identical_series": {
            "correlation": identical["correlation"],
            "mean_abs_error_pp": identical["mean_abs_error_pp"],
            "sign_agreement": identical["sign_agreement"],
            "verdict": identical["verdict"],
            "expected": "r=1.0, error=0.0, agreement=1.0, PASS",
            "passes": (identical["correlation"] == 1.0
                       and identical["mean_abs_error_pp"] == 0.0
                       and identical["verdict"] == "PASS"),
        },
        "opposite_series": {
            "correlation": inverted["correlation"],
            "sign_agreement": inverted["sign_agreement"],
            "verdict": inverted["verdict"],
            "expected": "r close to -1, FAIL",
            "passes": inverted["correlation"] is not None
                      and inverted["correlation"] < -0.9
                      and inverted["verdict"] == "FAIL",
        },
        "different_base_same_movements": {
            "correlation": scaled["correlation"],
            "mean_abs_error_pp": scaled["mean_abs_error_pp"],
            "verdict": scaled["verdict"],
            "expected": "identical to the base case: comparing CHANGES makes the "
                        "level scale irrelevant, which is why levels are not compared",
            "passes": scaled["correlation"] == 1.0
                      and scaled["mean_abs_error_pp"] == 0.0,
        },
    }


def validate(apix_daily: Sequence[dict]) -> dict:
    """The whole harness. Returns the comparison plus everything around it."""
    mospi = load_mospi()
    apix_monthly = monthly_from_daily(apix_daily)
    complete = [m for m in apix_monthly if m["complete"]]
    result = compare(complete, mospi)

    tests = self_test()
    month = int(apix_daily[0]["period_start"][5:7]) if apix_daily else None

    return {
        "criteria": CRITERIA,
        "criteria_note": "Fixed before the first result, so the test cannot be "
                         "graded after the fact. Calibrated against MoSPI's own "
                         "monthly volatility, not against our output.",
        "comparison": result,
        "apix_monthly": apix_monthly,
        "apix_complete_months": len(complete),
        "mospi_profile": profile(mospi),
        "first_comparable": first_comparable_month(apix_daily, mospi),
        "seasonal_context": seasonal_context(mospi, month) if month else {},
        "harness_self_test": tests,
        "harness_works": all(t["passes"] for t in tests.values()),
        "statement": _statement(result, complete, mospi),
    }


def _statement(result, complete, mospi) -> str:
    if result["n_months"] == 0:
        last = mospi[-1]["period"] if mospi else "unknown"
        return (
            f"Not yet comparable. MoSPI's published Airfare index ends {last}; "
            f"APIx has {len(complete)} complete month(s). Zero overlapping months, "
            f"so no correlation, error or tracking statistic exists. The harness "
            f"is built and its arithmetic is proven on cases with known answers; "
            f"it will produce a real answer the month both series cover the same "
            f"period.")
    if result["verdict"] == "PASS":
        return (f"APIx tracks MoSPI over {result['n_months']} overlapping months: "
                f"r={result['correlation']}, mean absolute error "
                f"{result['mean_abs_error_pp']} pp, direction agreeing "
                f"{result['sign_agreement']:.0%} of the time.")
    return (f"APIx does NOT meet the pre-set criteria over {result['n_months']} "
            f"overlapping months. See `checks` for which failed.")
