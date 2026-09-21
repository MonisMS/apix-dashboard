# APIx — a daily airfare price index for India

A Next.js monorepo: the dashboard, the API that serves it, and the Python
pipeline that computes the index, in one deployable unit.

    npm install
    npm run dev                    # http://localhost:3000

Needs `DATABASE_URL` in `.env.local` (a Neon Postgres connection string).
`npm run dev` and `npm run build` both talk to it: the build regenerates the
static fallback snapshot before compiling.

## Layout

    app/                   Next.js App Router
      (console)/           the 17 dashboard routes, with the sidebar
      api/v1/              19 GET endpoints + POST /ask
    src/
      views/               page components (not `pages/` -- Next reserves that)
      server/              the API's data layer, TypeScript
        services/          all the real work; routes are thin shims over these
    backend/               Python: the index engine and the collector
      apix/index/          Jevons / Young, screening, imputation, chaining
      apix/store/          Postgres schema, publisher, verifier
      api/                 the FastAPI reference implementation (not deployed)
    scripts/dump-static.ts generates the static fallback from the live API

## How the data flows

The index is **computed in Python and served by TypeScript**. Nothing
recomputes an index level in JavaScript.

    collector ──> SQLite (per-run scratch) ──> Neon Postgres
                                                  │
                    apix.store.publish ───────────┤   writes a vintage:
                    (runs the engine)             │   points, links, weights,
                                                  │   digests
                                                  ▼
                            app/api/v1/** ──> the dashboard

Each publish writes a complete new *vintage* inside one transaction and flips
it to `PUBLISHED` at the end; the previous one becomes `SUPERSEDED`. A reader
mid-publish sees the old vintage whole, never a half-written one.

Every published point carries a `repro_hash` — a digest over the exact cell
links and weights behind it. `python3 -m apix.store.verify` recomputes all of
them from stored rows, so the numbers are falsifiable rather than asserted.

## The static fallback

`public/data/v1/` is a frozen copy of the live API, generated at build time
and **not committed**. It exists for one situation: the database is
unreachable during judging. Set `NEXT_PUBLIC_API_STATIC=1` and redeploy, and
the dashboard serves files instead of Postgres.

It is generated from the same service functions the API routes use, so it
cannot disagree with them — an earlier version was produced by a separate
Python program and drifted.

## Commands

    npm run dev                 dashboard + API
    npm run build               regenerates the snapshot, then builds
    npm run dump:static         regenerate the snapshot by hand
    npm run dump:static -- --check   is the snapshot behind the database?

From `backend/`, with `APIX_PG_URL` set:

    python3 -m apix.store.migrate_pg     apply schema migrations
    python3 -m apix.store.publish        compute and publish a vintage
    python3 -m apix.store.verify         recompute every published digest
    python3 -m apix.store.inspect        what is actually in the database
    python3 -m apix.store.api_parity     live API vs the snapshot

## Collection

`.github/workflows/collect.yml` runs daily: sweep fares, sync to Neon,
publish a vintage, verify the digests, commit a compressed raw backup, and
trigger a rebuild so the fallback snapshot keeps up.

GitHub's scheduler runs this late — hours late, some days. `collected_at`
always records the real time, and `/api/v1/collection` publishes the drift per
day, so the gap between the nominal slot and reality is visible rather than
hidden. Part of any day-on-day move is the clock, not the market.
