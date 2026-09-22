# APIx — a daily airfare price index for India

**Live:** https://apix-dashboard-gitbashers.vercel.app
**Problem statement:** SIH26056 (Ministry of Statistics and Programme Implementation)

India's official CPI prices airfare by hand, once a month, at a single
fifteen-day advance booking. Fares on the same route routinely move several
hundred percent within a day. APIx is what an automated version looks like: it
collects fares every day across a DGCA-weighted basket of routes and five
advance-purchase windows, and computes a price index using the method MoSPI's
own CPI 2024 documentation specifies — Jevons at the elementary level, Young
for aggregation.

It is a working system, not a mockup. Every number on the dashboard is read
from Postgres, computed by the Python engine in `backend/`, and carries a
digest you can recompute yourself.

---

## Contents

- [Quick start](#quick-start)
- [What you are looking at](#what-you-are-looking-at)
- [How the index is built](#how-the-index-is-built)
- [Architecture](#architecture)
- [Where the data comes from](#where-the-data-comes-from)
- [The API](#the-api)
- [AskAI](#askai)
- [The rules this project holds itself to](#the-rules-this-project-holds-itself-to)
- [Repository layout](#repository-layout)
- [Commands](#commands)
- [Configuration](#configuration)
- [Collection schedule](#collection-schedule)
- [The static fallback](#the-static-fallback)
- [Verifying the numbers yourself](#verifying-the-numbers-yourself)
- [Current state and known gaps](#current-state-and-known-gaps)

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

You need `DATABASE_URL` in `.env.local` — a Neon Postgres connection string.
Both `npm run dev` and `npm run build` talk to it; the build regenerates the
static fallback snapshot before compiling.

No database to hand? Set `NEXT_PUBLIC_API_STATIC=1` and the dashboard serves
the frozen snapshot in `public/data/v1/` instead. See
[the static fallback](#the-static-fallback).

---

## What you are looking at

The dashboard is seventeen routes grouped into five sections in the sidebar.

| Group | Route | What it answers |
|---|---|---|
| **Index** | `/overview` | Today's level, coverage, the series, biggest movers |
| | `/index-detail` | Every published point, its link factor and quality flags |
| | `/windows` | The five advance-purchase sub-indices, side by side |
| **Markets** | `/routes` · `/routes/{pair}` | The basket · one route in full |
| | `/carriers` · `/carriers/{code}` | Per-airline index · one carrier in full |
| | `/heatmap` | Route × day matrix, every value printed in its cell |
| | `/tariffs` | Rule 135 published fare ladders, from the airlines' own PDFs |
| **Quality** | `/cleaning` | Outlier screening, and what each rule would do to the number |
| | `/availability` | Flights that stop appearing, and what that could hide |
| | `/split` | Base fare against taxes, from a periodic panel |
| | `/validation` | APIx against MoSPI item 294, and why they cannot be compared yet |
| **Method** | `/weights` | The basket weights and where airfare sits in the CPI |
| | `/methodology` | The two formulas, with MoSPI's worked examples reproduced |
| **System** | `/data` | Coverage, sweeps and the raw fetch log |
| | `/api-docs` | Every endpoint, live, with copyable URLs |

### The guided tour

Press **Tour** in the header, or **Walk me through it** on the landing page.
It is a seven-step walkthrough that navigates the real pages in order — the
headline number, where the fares come from, how a fare becomes an index, why
routes count unequally, what happens to bad data, how you would check us, and
what the system does when it cannot answer. Written for someone with no prior
context, and restartable from any page.

Every figure that carries a term of art also has a circled **ⓘ** beside it,
explaining it in plain language on hover or keyboard focus.

---

## How the index is built

Two formulas, at two levels, which is what the CPI Manual and MoSPI's Expert
Group Report specify.

**A cell** is the smallest thing priced: one
`origin × destination × carrier × departure band × advance-purchase lag`,
economy, non-stop, INR.

**Elementary level — Jevons (geometric).** Inside a cell there are no weights,
so the index moves by the unweighted geometric mean of matched price
relatives, chained onto the previous level:

```
I_t = GM_i( p_t^i / p_{t-1}^i ) × I_{t-1}        MoSPI EG 4.6.1.1; CPI Manual eq. 9.1
```

`p_t^i` is the price of flight *i* on day *t*. An **item** is one individual
flight (carrier plus flight number) matched between two consecutive collection
days — the same seat compared with itself, never one fare against a different
one.

**Higher level — Young (arithmetic).** Combining cells, weights exist, so the
index is a weighted arithmetic mean of cell levels:

```
I = Σ_j ( w_j × I_j ),   Σw = 1                  MoSPI EG 4.6.2.4; CPI Manual eq. 9.11
```

**Imputation.** Where a cell has no usable matched price, it follows the
movement of the aggregate above it. Carrying yesterday's price forward is
prohibited, because it would silently report "no change":

```
Imputed Price_t = Price_{t-1} × GM(available price relatives)    MoSPI EG 4.6.4.3
```

**Weights** are expenditure shares, not passenger counts — DGCA passengers
carried times mean observed fare, because the CPI Manual requires price times
quantity. Lead-time weights are a uniform 0.2 per window, which is a *declared
assumption*, not a derived booking-lag distribution; the real mix of when
tickets are bought is not published.

---

## Architecture

One deployable unit: the dashboard, the API that serves it, and the Python
pipeline that computes the index.

**The index is computed in Python and served by TypeScript. Nothing recomputes
an index level in JavaScript.**

```
collector ──> SQLite (per-run scratch) ──> Neon Postgres
                                              │
                apix.store.publish ───────────┤   writes a vintage:
                (runs the engine)             │   points, links, weights,
                                              │   digests
                                              ▼
                        app/api/v1/** ──> the dashboard
```

Each publish writes a complete new **vintage** inside one transaction and
flips it to `PUBLISHED` at the end; the previous becomes `SUPERSEDED`. A
reader mid-publish sees the old vintage whole, never a half-written one.

Every published point carries a `repro_hash` — a digest over the exact cell
links and weights behind it — so the numbers are falsifiable rather than
asserted. See [verifying the numbers](#verifying-the-numbers-yourself).

---

## Where the data comes from

Every source is a licensed or public API. **Nothing here scrapes a booking
site**, and no bot protection is circumvented.

| Source | What it gives | How it is accessed |
|---|---|---|
| Google Flights via **SerpApi** | All-in fares, every carrier on a route | Commercial API under contract. SerpApi queries Google on our behalf; we do not scrape anyone ourselves. |
| **Booking.com** via RapidAPI | The base fare / tax breakdown | Subscribed API endpoint. Used because Google Flights publishes one all-in number and no split. |
| **Travelpayouts / Aviasales** | Cached fares, all carriers | Free self-serve token. Wired up, currently contributing no rows. |
| Airline **tariff sheets** | Published fare ladders | Public PDFs under Rule 135 of the Aircraft Rules, 1937 — published *for* the public, so no scraping question arises. |

These are **offered fares, not transacted fares**. The dashboard says so
wherever it matters; it is a real limitation, not a footnote.

---

## The API

Nineteen GET endpoints plus `POST /ask`, all JSON, no key, no auth. Browse
them live at [`/api-docs`](https://apix-dashboard-gitbashers.vercel.app/api-docs),
which links every one to a working example.

| Endpoint | Returns |
|---|---|
| `/api/v1/health` | Schema version, observation count, database state |
| `/api/v1/index` | The headline series `APIX.ALL` |
| `/api/v1/series` | Every series with its weight share |
| `/api/v1/routes` · `/routes/{pair}` | The basket · one route in full |
| `/api/v1/carriers` · `/carriers/{code}` | Per-carrier index · one carrier |
| `/api/v1/windows` | The five advance-purchase sub-indices |
| `/api/v1/heatmap?metric=` | Route × date matrix |
| `/api/v1/weights` | The frozen weight tree and CPI context |
| `/api/v1/collection` · `/collection/runs` | Coverage and sweeps · the raw fetch log |
| `/api/v1/cleaning` | Screening rules and their sensitivity |
| `/api/v1/availability` | Disappearance analysis and the sold-out bound |
| `/api/v1/split` | Base fare against taxes |
| `/api/v1/validation` | APIx vs MoSPI item 294 |
| `/api/v1/methodology` | Formulas, citations, worked examples |
| `/api/v1/tariffs` | Rule 135 fare ladders |
| `/api/v1/audit` | Transitivity and churn |
| `POST /api/v1/ask` | AskAI |

Three contract rules the API keeps:

- **It never writes.** The role connects read-only, and `/health` reports
  whether that is actually true rather than asserting it.
- **`points: null`, never an empty array.** Where a series cannot exist yet,
  the response says so with a reason. An empty array would read as "collected,
  nothing moved".
- **404 vs 200.** A route outside the basket 404s. A basket route with no
  fares returns 200 with `NOT_COLLECTED`, because it exists and the gap is the
  point.

Responses are edge-cached for 60s with `stale-while-revalidate`; `/ask` is
never cached.

---

## AskAI

An assistant embedded in the dashboard that answers from the same data the
pages show. It is tool-calling, not retrieval over prose: it calls the same
service functions the REST routes call, which is what stops it disagreeing
with the dashboard.

- **It cannot state a number from memory.** Every figure must come from a tool
  result in that conversation; years, dates and citations are copied verbatim
  rather than recalled.
- **It will not explain *why* fares moved.** The data shows what moved. Cause
  is not observable here, and inventing one is the most damaging thing it
  could do.
- **It always reports which tier answered.** When no model is reachable it
  falls back to a deterministic local path built from live queries, and says
  so, so a canned answer can never pass as a generated one.

Model access is a pool of OpenRouter keys discovered by prefix
(`OPENROUTER_API_KEY`, `_2`, `_3`, …). Distinct accounts have independent
free-tier quotas; the pool fails over on rate limits, dead keys and provider
errors, and `/api/v1/health?pool=1` reports the remaining quota per account.

---

## The rules this project holds itself to

These are the reason the project is defensible, and breaking one is worse than
shipping less.

1. **Never fabricate a number.** Where a value cannot exist yet, the response
   says so in a field, with `points: null` and a reason.
2. **Label what is not observed.** Offered fares are not transacted fares.
   Imputed cells are flagged. A carrier's "tax" line is its own accounting,
   not a statutory rate.
3. **Never present a canned answer as a generated one.** `/ask` always reports
   which tier answered.
4. **Collection drift is published, not hidden.** `/api/v1/collection` reports
   how far each sweep ran from its nominal slot, because part of a day-on-day
   move is the clock rather than the market.
5. **Nothing recomputes an index level in JavaScript.** Arithmetic on levels
   belongs in `backend/apix/index/`.

---

## Repository layout

```
app/                        Next.js App Router
  (console)/                the dashboard routes, with the sidebar
  api/v1/                   19 GET endpoints + POST /ask
  providers.jsx             query client, theme, guided tour
src/
  views/                    page components (NOT pages/ — Next reserves that)
  server/                   the API's data layer, TypeScript
    services/               all the real work; routes are thin shims
    services/agent/         AskAI: prompt, tools, key pool, local fallback
  components/               shared UI (InfoDot, ColorKey, HeatGrid, tour, …)
  compat/                   a hand-written Mantine shim the views still import
  index.css                 all theming — Tailwind v4, CSS-first, no config file
backend/
  apix/index/               Jevons / Young, screening, imputation, chaining
  apix/store/               Postgres schema, publisher, verifier
  apix/sources/             the collector's source adapters
  api/                      the FastAPI reference implementation (not deployed)
scripts/dump-static.ts      generates the static fallback from the live API
```

---

## Commands

```bash
npm run dev                       # dashboard + API
npm run build                     # regenerate the snapshot, then build
npm run dump:static               # regenerate the snapshot by hand
npm run dump:static -- --check    # is the snapshot behind the database?
```

From `backend/`, with `APIX_PG_URL` set:

```bash
python3 -m apix.store.migrate_pg  # apply schema migrations
python3 -m apix.store.publish     # compute and publish a vintage
python3 -m apix.store.verify      # recompute every published digest
python3 -m apix.store.inspect     # what is actually in the database
python3 -m apix.store.api_parity  # live API vs the snapshot, all 20 endpoints
python3 -m apix.keypool           # SerpApi quota across the key pool
```

`api_parity` is the strongest check available — it diffs every endpoint
against reference output. Run it after touching anything in `src/server/`.

---

## Configuration

`.env.local` holds real credentials and is gitignored.
`.env.development` and `.env.production` are tracked and hold only
`NEXT_PUBLIC_*` build config.

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `.env.local` | Neon Postgres connection string |
| `OPENROUTER_API_KEY`, `_2`, `_3`… | `.env.local` | AskAI model pool, one per account |
| `OPENROUTER_MODEL` | `.env.local` | Model id; per-key overrides with `_2`, `_3` |
| `OPENROUTER_BASE_URL_n` | optional | Point one pool entry at another provider |
| `OPENROUTER_REASONING` | optional | `1` re-enables model reasoning tokens |
| `APIX_PG_URL` | `backend/` | Same database, for the Python tools |
| `APIX_SERPAPI_KEY`, `_2`… | `backend/apix/.env` | Collector key pool |
| `NEXT_PUBLIC_API_STATIC` | tracked | `1` serves the frozen snapshot |
| `NEXT_PUBLIC_APIX_SITE_URL` | tracked | Public origin used for copyable API URLs |

---

## Collection schedule

`.github/workflows/collect.yml` runs daily: sweep fares, sync to Neon, publish
a vintage, verify the digests, commit a compressed raw backup, and trigger a
rebuild so the fallback snapshot keeps up.

GitHub's scheduler runs late — hours late, some days. `collected_at` always
records the real time, and `/api/v1/collection` publishes the drift per day,
so the gap between the nominal slot and reality is visible rather than hidden.

---

## The static fallback

`public/data/v1/` is a frozen copy of the live API, generated at build time
and **not committed**. It exists for one situation: the database being
unreachable during judging. Set `NEXT_PUBLIC_API_STATIC=1` and redeploy, and
the dashboard serves files instead of Postgres.

It is generated from the same service functions the API routes use, so it
cannot disagree with them — an earlier version was produced by a separate
Python program and drifted.

---

## Verifying the numbers yourself

Nothing here asks to be taken on trust.

```bash
# recompute every published digest from stored rows
cd backend && python3 -m apix.store.verify

# diff every live endpoint against reference output
python3 -m apix.store.api_parity
```

On the dashboard itself:

- **`/methodology`** reproduces MoSPI's four published worked examples to four
  decimal places — same inputs, same printed answers.
- **`/index-detail`** shows a transitivity audit: chaining day by day against
  comparing the last day directly to the base. The gap between them is drift.
- **`/cleaning`** recomputes the whole series under three different screening
  rules and shows what each would do to the published number, so a cleaning
  step cannot quietly become an editorial one.
- **`/validation`** states the pass criteria that were fixed *before* any
  comparison with MoSPI was possible.

---

## Current state and known gaps

As of the 2026-09-21 vintage:

| | |
|---|---|
| Headline `APIX.ALL` | 98.96 (reference window 2026-09-10 → 2026-09-21 = 100, provisional) |
| Coverage | 12 of 12 basket routes, 7 carriers, 12 collection days |
| Observations | 24,448 collected · 17,719 used by the index · 21 sweeps |
| Latest day | 629 cells priced, of which 395 thin and 18 imputed |
| Weight tree | 688 cells, Σw = 1 |
| Screening | 44 movements held out; moves the index −0.334% versus no screening |
| Base/tax panel | 95 observations, 22.06% mean tax share |

**Not built, and why:**

- **Weekly and monthly series.** They need two complete ISO weeks and one
  complete calendar month respectively. Averaging the days we have and calling
  it weekly would be a different estimator wearing the same name, so the tabs
  say what is missing and when it arrives.
- **Correlation against MoSPI.** MoSPI's published Airfare series (item 294)
  ends 2026-07; APIx begins 2026-09-10. There is no overlap, so no correlation
  is computed or claimed. `/validation` shows what *can* be checked instead.
- **The airfare item is 0.03% of the CPI.** Even a large fare move barely
  shifts headline inflation. That is stated on `/weights` rather than left for
  someone to discover.
