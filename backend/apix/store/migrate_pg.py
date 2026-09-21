"""Numbered-file migration runner for Neon, mirroring apix/migrate.py.

    APIX_PG_URL=postgresql://... python3 -m apix.store.migrate_pg

Each file in migrations/ runs once, in filename order, inside a transaction,
and is recorded in pg_schema_version. Re-running is a no-op.
"""
import sys

from . import pg

# Distinct from publish.PUBLISH_LOCK (8_142_026).
MIGRATE_LOCK = 8_142_027

TRACKER = """
CREATE TABLE IF NOT EXISTS pg_schema_version (
    version    integer PRIMARY KEY,
    name       text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)
"""


def applied(con) -> set[int]:
    con.execute(TRACKER)
    rows = con.execute("SELECT version FROM pg_schema_version").fetchall()
    return {r["version"] for r in rows}


def main() -> int:
    files = sorted(pg.MIGRATIONS.glob("*.sql"))
    if not files:
        print("no migrations found")
        return 1

    with pg.connect() as con:
        # Session-level, held for the whole run. applied() reads the version
        # once and each migration then commits separately, so two runners can
        # read the same pending set and both try to apply it -- the loser
        # fails on the pg_schema_version primary key, having already committed
        # some of its migrations. A different id from the publish lock so the
        # two never block each other.
        con.execute("SELECT pg_advisory_lock(%s)", (MIGRATE_LOCK,))

        done = applied(con)
        con.commit()

        for path in files:
            version = int(path.name.split("_", 1)[0])
            if version in done:
                print(f"  {path.name}: already applied")
                continue
            print(f"  {path.name}: applying ...", end=" ", flush=True)
            with con.transaction():
                con.execute(path.read_text())
                con.execute(
                    "INSERT INTO pg_schema_version (version, name) VALUES (%s, %s)",
                    (version, path.name),
                )
            print("ok")

        row = con.execute("SELECT max(version) AS v FROM pg_schema_version").fetchone()
        print(f"schema version: {row['v']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
