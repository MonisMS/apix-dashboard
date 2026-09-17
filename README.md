# APIx dashboard

    # terminal 1 — the API
    cd /home/monis/sih2026
    PYTHONPATH=.:api uvicorn api.main:app --reload --port 8000

    # terminal 2 — the dashboard
    cd dashboard && npm install && npm run dev     # http://localhost:5173

Vite proxies `/api/v1` to uvicorn, so the browser sees one origin and CORS never
comes up in development.

## Constraints this build follows

**No custom CSS.** There is not one `.css` file of our own. The only two style
imports are Mantine's, in `src/main.jsx`, and charts must come after core or
tooltips misplace. Everything else is theme configuration (`src/theme.js`) and
Mantine style props.

**No custom components.** Every visual element is imported from `@mantine/core`
or `@mantine/charts`. `src/state.jsx` holds two helper *functions* that return
library elements — deliberately not components.

**One gradient, three places:** the logo, the headline number in the right rail,
and the area fill under the main chart.

## Design

Shell and feel follow the lighter of the two reference designs — left nav, big
heading, divider stat row, rounded pill controls, right-hand rail. The denser
reference contributes the data displays: KPI cards with sparklines, range pills,
the donut with a value legend, the stacked quality bar.

Dropped from both as irrelevant to a price index: avatars, chat, activity feeds
of people, "Upgrade to Pro", revenue/customers/deals, tasks.

## Routes

| Path | Page |
|---|---|
| `/` | Overview — headline, stat row, series, basket, movers, quality |
| `/index` | Every published point, flags, transitivity audit |
| `/routes`, `/routes/:pair` | All basket routes; per-route series, carriers, fare spread |
| `/carriers` | Per-carrier index and share |
| `/windows` | The five advance-purchase sub-indices and the lead-time curve |
| `/heatmap` | Route × day matrix (the PS's sector heatmap) |
| `/weights` | Expenditure-share basket and CPI context |
| `/validation` | MoSPI comparison, and why it cannot be made yet |
| `/tariffs` | Rule-135 published fare ladders |
| `/data` | Coverage, sweeps, the collection-hour warning |
| `/methodology` | Formulas, citations, MoSPI's worked examples |
| `/api-docs` | Endpoint reference |

`/api-docs`, not `/api`: the dev proxy matches path prefixes, so an `/api` route
would be forwarded to uvicorn instead of the app.

## Honest states

Pages show what is missing rather than hiding it: the 8 basket routes with no
fares appear in the table with a "not collected" badge; weekly and monthly tabs
are disabled with the reason; `/validation` leads with the fact that the two
series do not overlap. A blank card on a demo screen reads as a broken product,
so every page has a skeleton while loading and a specific message on failure.
