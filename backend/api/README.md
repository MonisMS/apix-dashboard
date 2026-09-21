# APIx API

Read-only REST service over the airfare price index.

    cd /home/monis/sih2026
    PYTHONPATH=.:api uvicorn api.main:app --reload --port 8000

Run from the repo root — `apix` is imported by path, not installed.
Interactive docs at `/docs`.

## Endpoints

All under `/api/v1`.

| Path | Returns |
|---|---|
| `health` | schema version, observation count, cache state |
| `index` | the headline series APIX.ALL |
| `series` | catalogue of every series with its weight share |
| `routes`, `routes/{pair}` | per-route index, carriers, fare spread, per-window breakdown |
| `carriers`, `carriers/{code}` | per-carrier index and share |
| `windows` | the five advance-purchase sub-indices, kept as a separate record |
| `heatmap?metric=` | routes x dates matrix (`pct_change`/`level`/`mean_fare`/`n_offers`) |
| `weights` | the frozen weight tree, provenance, and CPI context |
| `collection`, `collection/runs` | coverage, sweeps, the collection-hour warning |
| `validation` | APIx vs MoSPI item 294, and why they cannot yet be compared |
| `tariffs` | Rule-135 published fare ladders |
| `methodology` | formulas, citations, MoSPI's worked examples |
| `audit` | transitivity (chained vs direct) and churn |

## Design rules

**It never writes.** Connections open read-only (`mode=ro`, `PRAGMA query_only`).
`apix.db.connect()` is deliberately not used — it runs `executescript(SCHEMA)` on open,
and a web process must not be able to touch the schema.

**Nothing is fabricated.** Where a number cannot exist yet the response says so in a
field and sets `points: null`. An empty array would read as "collected, nothing moved";
`null` plus a reason reads as "never collected", which is the truth for 8 of the 20
basket routes.

**A route not in the basket 404s. A basket route with no fares returns 200** with
`availability.state = "NOT_COLLECTED"`. A 404 there would imply the route is fictional
and would hide the coverage gap this API exists to expose.

**One computation per data state.** `cache.py` keys on `(COUNT(*), MAX(collected_at))`,
so a new sweep invalidates and nothing else does.
