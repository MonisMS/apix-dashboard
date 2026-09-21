"""In-process cache for the computed index.

`cli.compute()` re-runs the whole pipeline: load, weight, chain, aggregate. With
three collection days that is fast, but a single dashboard page makes roughly a
dozen API calls and must not recompute a dozen times.

The cache key is the observable state of the data -- the number of observations
and the latest collection timestamp. When a sweep lands, the key changes and the
next request recomputes. That is more reliable than a TTL: a TTL either serves
stale numbers after a sweep or throws away a valid computation for nothing.
"""
import sqlite3
import threading
import time

_lock = threading.Lock()
_entry = {"key": None, "value": None, "computed_at": None, "seconds": None}


def data_key(con) -> tuple:
    """Cheap fingerprint of the observation table."""
    row = con.execute(
        "SELECT COUNT(*), MAX(collected_at) FROM fare_observation").fetchone()
    return (row[0], row[1])


def get(con, builder, refresh: bool = False):
    """Return the cached computation, rebuilding if the data moved."""
    key = data_key(con)
    with _lock:
        if not refresh and _entry["key"] == key and _entry["value"] is not None:
            return _entry["value"]
        t0 = time.time()
        value = builder(con)
        _entry.update(key=key, value=value, computed_at=time.time(),
                      seconds=round(time.time() - t0, 3))
        return value


def status() -> dict:
    with _lock:
        return {
            "cached": _entry["value"] is not None,
            "observations_at_cache_time": _entry["key"][0] if _entry["key"] else None,
            "age_seconds": round(time.time() - _entry["computed_at"], 1)
            if _entry["computed_at"] else None,
            "compute_seconds": _entry["seconds"],
        }


def clear():
    with _lock:
        _entry.update(key=None, value=None, computed_at=None, seconds=None)
