"""Frozen configuration for the APIx index.

Everything here is written into `index_run.config_json` when a series is
published, so a published number can always be traced back to the exact
settings that produced it.  Change a value and you have created a new vintage,
not a correction -- that is deliberate.

Sources for the choices are named inline.  Where MoSPI publishes no rule, the
constant says so explicitly rather than implying an authority that does not
exist.
"""
import dataclasses
import json

# --- collection grid -------------------------------------------------------
# The five advance-purchase windows are fixed by the problem statement.  MoSPI's
# own airfare spec is a single 21-day window (Expert Group Report 3.9, p. 14),
# so we also publish one sub-index per window -- see SERIES_LEAD_SUBINDICES.
LEAD_TIMES = (1, 7, 15, 30, 45)

# The index is computed from ONE price source, and this is it.
#
# Not a preference -- a correctness requirement. The database deliberately holds
# rows from more than one source (Booking.com backs the base-fare/tax split; the
# Rule-135 tariff sheets are reference data), and those sources do not price the
# same thing. Booking reports `totalWithoutDiscount`; the daily source reports
# Google Flights' all-in offer. Feeding both into one series would measure the
# difference between two platforms' pricing conventions and call it airfare
# inflation.
#
# It is also not hypothetical. On 14 Sep 2026 the split study ran at 10:38, nine
# minutes after the 10:30 daily sweep. `load_observations` picks the LATEST
# genuine run per cell, so the study displaced the daily sweep in every T+7 cell
# it covered: the day fell from ~625 cells to 580 and imputation rose from 56 to
# 101. The series moved because of which source won a tiebreak.
#
# A second source earns its way in by being reconciled against this one first,
# not by being inserted into the same table.
INDEX_SOURCE = "serpapi_google_flights"

# The window closest to MoSPI's 21-day domestic spec, used for the comparison
# series against their published Airfare item.  T+15 and T+30 bracket 21 days;
# neither IS 21, and the export says so rather than pretending otherwise.
MOSPI_COMPARABLE_LEADS = (15, 30)

# --- the elementary aggregate ---------------------------------------------
# Expert Group Recommendation 11, p. 219: "The airline is a price determining
# characteristic and should be part of the specification."  Because carrier is
# in the cell key, a cross-airline minimum is structurally impossible here.
CELL_KEY_FIELDS = ("origin", "destination", "lead_time_days", "carrier", "dep_band")
ITEM_KEY_FIELDS = ("origin", "destination", "lead_time_days", "carrier", "flight_number")

# Departure-time bands, IST, half-open [start, end).
# MoSPI publishes NO band definition.  These are an APIx choice, frozen per
# weight-set vintage.  Observed spread on 5,141 rows: MD 1843 / EV 1415 /
# EM 1166 / NT 717 -- no degenerate band.
BANDS = (("EM", 0, 8), ("MD", 8, 16), ("EV", 16, 21), ("NT", 21, 24))
BAND_CODES = tuple(b[0] for b in BANDS)

# --- standing product specification ---------------------------------------
# This IS the CPI "specification" and must be frozen and stated, not left
# implicit in adapter query params.
PRODUCT_SPEC = {
    "passengers": "1 adult",
    "trip": "one-way",
    "cabin": "Economy",
    "stops": "non-stop only",
    "currency": "INR",
    "price_concept": "all-in total payable (CPI Manual 2.112: taxes are part of "
                     "purchasers' prices)",
    "baggage": "not specified by source; not controlled for",
}

# --- thin cells ------------------------------------------------------------
# No drop rule.  Jevons over one matched item is that item's price relative and
# is unbiased; the problem is variance, not validity.  Dropping n<3 would delete
# ~41% of cells and preferentially delete thin routes -- coverage bias, not a
# quality improvement.  Variance is controlled by the weight instead.
MIN_CELL_MATCH = 1
THIN_CELL_THRESHOLD = 3          # flag only

# --- outlier screening -----------------------------------------------------
# Operates on ln(p_t / p_{t-1}), never on levels.  A Rs 32,000 DEL-SXR fare is
# not an outlier; a Rs 32,000 fare that was Rs 6,000 yesterday is.
EXTREME_LOG_REL = 1.0986122886681098      # ln(3.0) -- a 3x move in one day
MAD_K = 5.0
MAD_MIN_POOL = 10
# k=5, not the textbook 3: measured p1-p99 of our log relatives is about
# -0.93..+0.62.  A 50% overnight move on a T+1 sector is ordinary airfare
# behaviour, and k=3 would screen out genuine price movement -- biasing the
# index toward zero change, the most insidious failure a price index has.

PLAUSIBLE_MIN_FARE = 1500.0      # flag only, never a hard reject
HARD_MAX_FARE = 500000.0

# --- imputation ------------------------------------------------------------
# CPI Manual 8.54: carrying forward the last observed price "is not an
# acceptable procedure".  There is no code path that does it.
MAX_CONSECUTIVE_IMPUTATIONS = 5
PROVISIONAL_IMPUTED_WEIGHT = 0.20   # above this, publish flagged as provisional
REFUSE_IMPUTED_WEIGHT = 0.40        # above this, refuse to publish at all

# --- weights ---------------------------------------------------------------
# Uniform across lead times, DECLARED AS AN ASSUMPTION, not derived and not
# attributed to anyone.  ONS collects domestic air fares at ONE window ("domestic
# prices are collected one month in advance", ons.gov.uk); their 10:45:45 split
# is long-haul only and does not map onto a 1-45 day ladder.  Overridable from
# apix/data/lead_weights.json without a code change.
DEFAULT_LEAD_WEIGHTS = {lead: 1.0 / len(LEAD_TIMES) for lead in LEAD_TIMES}

WEIGHT_SUM_TOLERANCE = 1e-9

# --- timezone --------------------------------------------------------------
# collected_at is naive local time from the collector.  The observation date is
# its IST calendar date.  Declared in one place so nothing has to re-derive it.
TZ = "Asia/Kolkata"

# --- index reference -------------------------------------------------------
# The base is a WINDOW, not a day, so one unusual day cannot anchor the series.
# Provisional until the window reaches 28 days.
PROVISIONAL_WINDOW_MIN_DAYS = 28


@dataclasses.dataclass(frozen=True)
class IndexConfig:
    """The complete, serialisable description of how a series was computed."""
    lead_times: tuple = LEAD_TIMES
    bands: tuple = BANDS
    min_cell_match: int = MIN_CELL_MATCH
    thin_cell_threshold: int = THIN_CELL_THRESHOLD
    extreme_log_rel: float = EXTREME_LOG_REL
    mad_k: float = MAD_K
    mad_min_pool: int = MAD_MIN_POOL
    screen_extreme: bool = True
    # OFF by default. Measured on our own 2,791 matched relatives: the median
    # day-to-day move is exactly zero, so MAD collapses to 0.065 and a k=5 band
    # would quarantine 6.8% of flights for moving more than a third in a day.
    # That is ordinary airfare behaviour. See clean.py's docstring.
    screen_mad: bool = False
    max_consecutive_imputations: int = MAX_CONSECUTIVE_IMPUTATIONS
    lead_weights: tuple = tuple(sorted(DEFAULT_LEAD_WEIGHTS.items()))
    price_reference_window: tuple = ()
    # Escape hatch used ONLY by deterministic test fixtures where a unit link is
    # the intended value.  Production runs leave this False so a link of exactly
    # 1.0 is treated as suspicious.
    allow_unit_link: bool = False

    def to_json(self) -> str:
        return json.dumps(dataclasses.asdict(self), sort_keys=True, default=list)
