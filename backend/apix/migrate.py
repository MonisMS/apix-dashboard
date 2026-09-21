"""Versioned schema migrations for the APIx database.

Why this exists: `db.connect()` used to run `executescript(SCHEMA)` on every
open, which silently creates whatever the current source says the schema is.
That is fine for a prototype and unacceptable for a series with published
vintages -- a published number must be reproducible, and it cannot be if the
shape of the table it came from can change under it without a record.

Each migration runs inside a transaction and is recorded in `schema_version`.
The database is copied to a timestamped backup before anything is applied.

    python3 apix/migrate.py            # apply everything outstanding
    python3 apix/migrate.py --status   # show current version, apply nothing
"""
import argparse
import datetime
import pathlib
import shutil
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
MIGRATIONS = HERE / "migrations"
DEFAULT_DB = HERE / "data" / "apix.db"

EXPECTED_VERSION = 5


def _ensure_version_table(con):
    con.execute("""CREATE TABLE IF NOT EXISTS schema_version (
                     version    INTEGER PRIMARY KEY,
                     name       TEXT NOT NULL,
                     applied_at TIMESTAMP NOT NULL)""")
    con.commit()


def current_version(con) -> int:
    _ensure_version_table(con)
    row = con.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return row[0] or 0


def pending(con):
    """Migration files not yet applied, in numeric order."""
    have = current_version(con)
    out = []
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*")):
        version = int(path.name[:3])
        if version > have:
            out.append((version, path))
    return out


def backup(db: pathlib.Path) -> pathlib.Path:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = db.with_suffix(f".db.premigrate-{stamp}")
    shutil.copy2(db, dest)
    return dest


def apply_one(con, version: int, path: pathlib.Path):
    if path.suffix == ".sql":
        con.executescript(path.read_text())
    elif path.suffix == ".py":
        # A data backfill. The module exposes migrate(con).
        # __file__ is supplied explicitly: exec() does not set it, and the
        # migrations use it to find the package root.
        ns: dict = {"__file__": str(path), "__name__": f"migration_{version:03d}"}
        exec(compile(path.read_text(), str(path), "exec"), ns)
        ns["migrate"](con)
    else:
        raise ValueError(f"unknown migration type: {path.name}")
    con.execute("INSERT INTO schema_version (version, name, applied_at) VALUES (?,?,?)",
                (version, path.name, datetime.datetime.now().isoformat(timespec="seconds")))
    con.commit()


def migrate(db: pathlib.Path = DEFAULT_DB, verbose: bool = True) -> int:
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    todo = pending(con)
    if not todo:
        if verbose:
            print(f"  up to date at version {current_version(con)}")
        return current_version(con)

    if db.exists() and db.stat().st_size > 0:
        b = backup(db)
        if verbose:
            print(f"  backup -> {b.name}")

    for version, path in todo:
        if verbose:
            print(f"  applying {path.name} ...", end=" ", flush=True)
        try:
            apply_one(con, version, path)
        except Exception as e:
            con.rollback()
            print(f"\n  ! FAILED on {path.name}: {e}")
            print("  database rolled back to before this migration; "
                  "the pre-migration backup is intact.")
            raise
        if verbose:
            print("ok")
    v = current_version(con)
    con.close()
    return v


def assert_version(con, expected: int = EXPECTED_VERSION):
    """Fail loudly rather than operate on a schema we do not recognise."""
    have = current_version(con)
    if have != expected:
        raise RuntimeError(
            f"database schema is at version {have}, code expects {expected}. "
            f"Run: python3 apix/migrate.py")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()
    db = pathlib.Path(a.db)

    con = sqlite3.connect(db)
    if a.status:
        print(f"  schema version : {current_version(con)} (code expects {EXPECTED_VERSION})")
        for v, p in pending(con):
            print(f"  pending        : {p.name}")
        return
    con.close()
    print(f"Migrating {db}")
    v = migrate(db)
    print(f"  now at version {v}")


if __name__ == "__main__":
    main()
