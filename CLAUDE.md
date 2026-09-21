# Working in this repo

APIx: a daily airfare price index for India. One Next.js app serving the
dashboard *and* the API, plus the Python pipeline that computes the index.

Read `README.md` for the architecture. This file is the things that will
waste your time if you learn them by breaking the build.

## Traps

**`src/pages/` does not exist and must not be created.** Next reserves
`pages` for the Pages Router and refuses to build when it sits beside
`app/`. The page components live in **`src/views/`**.

**There is no `/index` route.** Next normalises `/index` to `/`, so a page
there is unreachable. It is **`/index-detail`**.

**`public/data/v1/` is generated, gitignored, and must not be hand-edited.**
`npm run build` regenerates it from the live API via
`scripts/dump-static.ts`. It is the emergency fallback served when
`NEXT_PUBLIC_API_STATIC=1`, and it exists so the site survives the database
being unreachable.

**`npm run build` needs `DATABASE_URL`** — the prebuild step queries Neon. It
warns rather than failing if the database is unreachable, so check the build
output for `wrote 42 files` if the fallback matters.

**Dark mode is `next-themes`.** Do not add another. The previous hook read
`localStorage` inside a `useState` initializer, which runs during render and
throws on the server. `useDarkMode()` now wraps `next-themes` and keeps the
same `[dark, toggle]` shape.

**No non-deterministic values during render.** `Math.random()` and
`new Date()` in a render path do not merely warn — they made Next bail whole
pages out of server rendering. Seed from `null` and fill in an effect. See
`useIstClock` in `src/views/Landing.jsx` for the pattern.

**`.env.local` holds real credentials** (Neon, OpenRouter) and is gitignored.
`.env.development` / `.env.production` are tracked and hold only
`NEXT_PUBLIC_*` build config.

## Layout

    app/(console)/          the 17 dashboard routes, sidebar chrome
    app/api/v1/             19 GET endpoints + POST /ask
    src/views/              page components
    src/layout/AppLayout    sidebar, nav, theme toggle
    src/components/ui/      shadcn (new-york, .jsx, Tailwind v4)
    src/compat/             a Mantine shim 14 views still import
    src/server/             the API's data layer (TypeScript)
    backend/                Python: index engine, collector, Postgres store

## Conventions

- **Tailwind v4, CSS-first.** All theming is in `src/index.css` — tokens,
  `@theme inline`, a `@custom-variant dark`. There is no `tailwind.config.js`
  and adding one would split the source of truth. `@source "../app"` is
  required for classes used under `app/`.
- **Everything under `(console)` is a client component.** Every view imports
  a TanStack Query hook from `src/api.js`, so `'use client'` is the default,
  not the exception.
- **Pages are Server Components that render a client view.** That is what
  lets each route export real `metadata`. Keep that split.
- **New backend code is TypeScript**; the 60-odd existing `.jsx` files stay
  as they are. Do not convert them wholesale.
- **Route handlers stay thin.** Logic belongs in `src/server/services/`,
  because the `/ask` tools call the same functions the REST routes call —
  that is what stops the assistant disagreeing with the dashboard.
- `src/compat/` is a hand-written Mantine shim. It is not idiomatic shadcn.
  Rewriting it is a large change, not a tidy-up.

## The data

Numbers come from Postgres, computed by Python. **Nothing recomputes an index
level in JavaScript**, and new JS that does arithmetic on levels is almost
certainly wrong — it belongs in `backend/apix/index/`.

Every published point carries a `repro_hash` over the exact links and weights
behind it. From `backend/`, with `APIX_PG_URL` set:

    python3 -m apix.store.verify        recompute every digest from stored rows
    python3 -m apix.store.inspect       what is actually in the database
    python3 -m apix.store.api_parity    live API vs the snapshot, all 20 endpoints

`api_parity` is the strongest check available — it diffs every endpoint
against reference output. Run it after touching anything in `src/server/`.

## Honesty rules this project holds itself to

These are not style preferences; they are the reason the project is
defensible, and breaking one is worse than shipping less.

- **Never fabricate a number.** Where a value cannot exist yet, the response
  says so in a field, with `points: null` and a reason — never an empty array
  that reads as "collected, nothing moved".
- **Label what is not observed.** Offered fares are not transacted fares.
  Imputed cells are flagged. A carrier's "tax" line is its own accounting,
  not a statutory rate.
- **Never present a canned answer as a generated one.** `/ask` always reports
  which tier answered.
- **Collection drift is published, not hidden.** `/api/v1/collection` reports
  how far each sweep ran from its nominal slot, because part of a day-on-day
  move is the clock rather than the market.
