"""Postgres connection helpers for the pipeline side.

The API does not use this module -- it talks to Neon from TypeScript. This is
only for the Python that writes: the collector, the backfill and the index
publisher.

Connection strings come from the environment, never from code:

    APIX_PG_URL   the writer connection. Prefer the NON-pooled Neon host for
                  this: the publisher runs one long transaction and takes an
                  advisory lock, and PgBouncer's transaction pooling makes
                  session-scoped behaviour unreliable.
"""
import os
import pathlib

import psycopg

MIGRATIONS = pathlib.Path(__file__).resolve().parent / "migrations"


def _url() -> str:
    url = os.getenv("APIX_PG_URL")
    if not url:
        raise SystemExit(
            "APIX_PG_URL is not set. Export the Neon connection string first:\n"
            "  export APIX_PG_URL='postgresql://...'"
        )
    return url


def connect(*, autocommit: bool = False) -> psycopg.Connection:
    """Open a writer connection with dict rows."""
    return psycopg.connect(_url(), autocommit=autocommit, row_factory=psycopg.rows.dict_row)


def direct_url(url: str) -> str:
    """Neon's pooled host with '-pooler' stripped -- the direct endpoint.

    DDL and the publish transaction want a direct connection; the pooled one is
    for the serverless read path.
    """
    return url.replace("-pooler.", ".", 1)
