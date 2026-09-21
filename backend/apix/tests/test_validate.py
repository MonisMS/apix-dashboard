"""The validation harness: that it measures correctly, and refuses when it can't."""
import pytest

from apix.index.validate import (CRITERIA, MIN_MONTHS_FOR_CORRELATION,
                                 MIN_MONTHS_FOR_ERROR, compare, monthly_from_daily,
                                 pct_changes, pearson, seasonal_context, self_test,
                                 spearman)


def series(vals, start="2025-01"):
    y, m = int(start[:4]), int(start[5:7])
    out = []
    for v in vals:
        out.append({"period": f"{y}-{m:02d}", "level": v})
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def daily(n, start_day=1, month="2026-09", level=100.0):
    return [{"period_start": f"{month}-{start_day + i:02d}", "level": level + i}
            for i in range(n)]


# --- the harness proves its own arithmetic ---------------------------------

def test_self_test_all_pass():
    """The metrics are run on cases with known answers on every call.

    A harness that has never produced a correct answer on a checkable case is
    not evidence of anything.
    """
    results = self_test()
    for name, t in results.items():
        assert t["passes"], f"{name}: got {t}"


def test_identical_series_scores_perfectly():
    base = series([100, 110, 99, 120, 108, 130, 117])
    r = compare(base, base)
    assert r["correlation"] == 1.0
    assert r["mean_abs_error_pp"] == 0.0
    assert r["sign_agreement"] == 1.0
    assert r["verdict"] == "PASS"


def test_opposite_series_fails():
    base = series([100, 110, 99, 120, 108, 130, 117])
    r = compare(series([100, 90, 100, 83, 92, 77, 86]), base)
    assert r["correlation"] < -0.9
    assert r["verdict"] == "FAIL"


def test_level_scale_is_irrelevant_because_changes_are_compared():
    """The reason we do not compare levels at all.

    MoSPI is 2024=100 over a national basket; APIx is a 3-day window = 100 over
    12 city pairs. Comparing month-on-month CHANGE makes that difference
    disappear, which is exactly why it is the right comparison.
    """
    base = series([100, 110, 99, 120, 108, 130, 117])
    scaled = series([v * 7.3 for v in [100, 110, 99, 120, 108, 130, 117]])
    r = compare(scaled, base)
    assert r["correlation"] == 1.0
    assert r["mean_abs_error_pp"] == 0.0


# --- it refuses to answer when it cannot -----------------------------------

def test_no_overlap_reports_nothing_rather_than_zero():
    a = series([100, 110, 120], start="2026-09")
    b = series([100, 105, 110], start="2025-01")
    r = compare(a, b)
    assert r["n_months"] == 0
    assert r["verdict"] == "NOT_COMPARABLE"
    assert r["correlation"] is None
    assert r["mean_abs_error_pp"] is None
    assert "nothing can be compared" in r["reasons"][0]


def test_correlation_withheld_below_the_minimum_month_count():
    """A correlation over two points is always +/-1 and means nothing."""
    a = series([100, 110, 121])
    b = series([100, 105, 110])
    r = compare(a, b)
    assert r["n_months"] == 2 < MIN_MONTHS_FOR_CORRELATION
    assert r["correlation"] is None
    assert any("correlation needs at least" in x for x in r["reasons"])


def test_error_stats_withheld_below_their_own_minimum():
    a, b = series([100, 110]), series([100, 104])
    r = compare(a, b)
    assert r["n_months"] == 1 < MIN_MONTHS_FOR_ERROR
    assert r["mean_abs_error_pp"] is None


def test_a_gap_in_the_series_is_not_treated_as_one_month_of_movement():
    gappy = [{"period": "2025-01", "level": 100.0},
             {"period": "2025-06", "level": 130.0}]
    assert pct_changes(gappy) == []


def test_flat_series_has_no_correlation_rather_than_zero():
    assert pearson([1, 1, 1], [1, 2, 3]) is None


# --- aggregation guards ----------------------------------------------------

def test_a_partial_month_is_marked_incomplete_and_excluded():
    """Three days is not a month.

    Comparing a 3-day month against MoSPI's full-month figure would measure our
    collection gaps, not the market.
    """
    months = monthly_from_daily(daily(3, start_day=10))
    assert months[0]["n_days"] == 3
    assert months[0]["complete"] is False


def test_a_full_month_is_marked_complete():
    months = monthly_from_daily(daily(22, start_day=1))
    assert months[0]["complete"] is True


# --- the criteria cannot drift ---------------------------------------------

def test_success_criteria_are_fixed():
    """Pinned so they cannot be softened once a real result exists.

    The thresholds were set from MoSPI's own monthly volatility (sd 7.32 pp)
    before any comparison was possible. If a future result fails, that is a
    finding, not a reason to move the bar.
    """
    assert CRITERIA == {
        "min_sign_agreement": 0.70,
        "min_correlation": 0.60,
        "max_mean_abs_error_pp": 4.0,
        "max_abs_mean_bias_pp": 2.0,
    }


def test_seasonal_context_is_labelled_as_weak_evidence():
    mospi = series([112.11, 105.22], start="2025-08")
    ctx = seasonal_context(mospi, 9)
    assert ctx["n_years"] == 1
    assert ctx["all_negative"] is True
    assert "not validation" in ctx["caveat"]


def test_spearman_is_robust_to_one_extreme_month():
    """Rank correlation should survive an outlier that would drag Pearson."""
    xs = [1.0, 2.0, 3.0, 4.0, 100.0]
    ys = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert spearman(xs, ys) == pytest.approx(1.0)
    assert pearson(xs, ys) < 0.9
