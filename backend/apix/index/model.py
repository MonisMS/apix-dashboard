"""Data structures for the index pipeline.

All plain NamedTuples so the pure stages can be tested with a five-line fixture
and so nothing in the maths layer needs a database to exist.
"""
from typing import NamedTuple, Optional


class ItemKey(NamedTuple):
    """The thing whose price is tracked through time.

    A specific flight, on a specific route, bought a fixed number of days ahead.
    The departure date advances by one day every day because the lead is held
    fixed -- that is deliberate.  The product being priced is "a seat on
    6E-2134, DEL-BOM, bought 7 days ahead", and holding the lead fixed is what
    makes the series a price series rather than a countdown.
    """
    origin: str
    destination: str
    lead_time_days: int
    carrier: str
    flight_number: str


class CellKey(NamedTuple):
    """The elementary aggregate -- MoSPI's specification per EG Rec 11.

    Carrier is IN the key, which is what makes a cross-airline minimum
    structurally impossible.
    """
    origin: str
    destination: str
    lead_time_days: int
    carrier: str
    dep_band: str

    @property
    def route(self) -> tuple:
        return (self.origin, self.destination)

    @property
    def route_lead(self) -> tuple:
        return (self.origin, self.destination, self.lead_time_days)


class Observation(NamedTuple):
    """One observed fare quote, already cleaned of storage concerns."""
    obs_date: str            # IST calendar date, YYYY-MM-DD
    item: ItemKey
    dep_band: str
    total_fare: float
    observation_id: int
    run_id: Optional[str] = None

    @property
    def cell(self) -> CellKey:
        return CellKey(self.item.origin, self.item.destination,
                       self.item.lead_time_days, self.item.carrier, self.dep_band)


class CellLink(NamedTuple):
    """One cell's short-term price relative between two consecutive periods."""
    link: float
    n_matched: int
    n_prev: int
    n_cur: int
    n_screened: int = 0
    is_imputed: bool = False
    imputation_source: Optional[str] = None     # ROUTE_LEAD | ROUTE | ALL
    imputation_run_len: int = 0
    quality: str = "OK"                          # OK | THIN | IMPUTED | DEAD

    @property
    def churn_rate(self) -> Optional[float]:
        """Share of the previous period's items that did not reappear."""
        if not self.n_prev:
            return None
        return 1.0 - (self.n_matched / self.n_prev)


class Point(NamedTuple):
    """One published index value."""
    series_id: str
    freq: str                # D | W | M
    period_start: str
    period_end: str
    level: float
    link: Optional[float] = None
    n_cells: int = 0
    n_cells_imputed: int = 0
    n_cells_thin: int = 0
    n_cells_dead: int = 0
    n_items_matched: int = 0
    n_items_prev: int = 0
    n_items_screened: int = 0
    weight_covered: float = 1.0
    weight_imputed: float = 0.0
    n_days: int = 1
    is_provisional: bool = False
    quality: tuple = ()
    # sha256 over the method version, reference factor, and every link and
    # weight in force on this day. See index/repro.py. Empty only for points
    # built by callers that predate the digest.
    repro_hash: str = ""


class Flag(NamedTuple):
    """A non-destructive annotation on an observation."""
    observation_id: int
    flag: str
    detail: str = ""
