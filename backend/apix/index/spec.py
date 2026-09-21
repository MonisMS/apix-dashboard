"""The product specification: how an observation is assigned to a cell.

Kept separate from loading because these rules ARE the CPI "specification", and
a specification must be frozen, stated and testable rather than left implicit in
a SQL WHERE clause.
"""
import re
from typing import Optional

from .config import BANDS
from .model import CellKey, ItemKey

# The collector writes notes as "nonstop; dep 2026-09-11 05:00".  Parsing free
# text is a stopgap: migration 002 lifts departure time into a real column and
# the adapters start writing it directly (plan phase 7).  Until every row has
# been collected by the new adapters, this is how history is recovered.
_DEP = re.compile(r"dep\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})")


def parse_departure(notes: Optional[str]) -> Optional[str]:
    """Extract 'HH:MM' from a notes string, or None if it is not there."""
    if not notes:
        return None
    m = _DEP.search(notes)
    return f"{m.group(2)}:{m.group(3)}" if m else None


def parse_nonstop(notes: Optional[str]) -> int:
    return 1 if notes and notes.strip().lower().startswith("nonstop") else 0


def band(departure_time: Optional[str]) -> Optional[str]:
    """Map 'HH:MM' (IST) to a departure band code.

    MoSPI publishes no band definition, so these cut points are an APIx choice,
    declared in config.BANDS and frozen for the life of a weight set.  The band
    is STORED per observation rather than recomputed, so that changing the cut
    points in future cannot silently rewrite history.
    """
    if not departure_time:
        return None
    try:
        hour = int(departure_time.split(":")[0])
    except (ValueError, IndexError):
        return None
    if not 0 <= hour <= 23:
        return None
    for code, start, end in BANDS:
        if start <= hour < end:
            return code
    return None


def item_key(row) -> ItemKey:
    return ItemKey(row["origin"], row["destination"], row["lead_time_days"],
                   row["carrier"], row["flight_number"])


def cell_key(row, dep_band: str) -> CellKey:
    return CellKey(row["origin"], row["destination"], row["lead_time_days"],
                   row["carrier"], dep_band)
