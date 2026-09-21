'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress, SegmentedControl, SimpleGrid, Table } from '../compat/mantine';
import { AreaChart } from '../compat/mantine-charts';
import { useAudit, useCollection, useIndex, useRoutes } from '../api';
import { count, idx, sharePct, shortDate } from '../format';
import { Delta, Note, PageHeader, queryState } from '../ui';
import { CHART } from '../chartTokens';
import { GuidedTour } from '../components/GuidedTour';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';

const STATIC = process.env.NEXT_PUBLIC_API_STATIC === '1';

const RANGES = [
  { label: '7D', value: '7' },
  { label: '30D', value: '30' },
  { label: 'All', value: 'all' },
];

/**
 * Plain-language glossary for the circled "i" beside each figure.
 *
 * Every definition here is taken from the engine or the API, not written from
 * intuition: the thin threshold is backend/apix/index/config.py
 * THIN_CELL_THRESHOLD = 3, the screening rule is the hard bound at a 3x daily
 * move, and imputation is "from the parent aggregate's short-term movement;
 * carry-forward is prohibited" as /methodology states it.
 */
const INFO = {
  level:
    'The headline airfare price index. It is set to 100 across the reference ' +
    'window, so 98.96 means fares are about 1% below that window average. It ' +
    'tracks the change in price, not the price itself.',
  dod:
    'Change since the previous collection day, taken from the published daily ' +
    'link factor rather than recalculated here, so it always matches the ' +
    'engine.',
  routes:
    'How many routes in the DGCA basket have fares collected. A route with no ' +
    'fares stays in the basket but carries no weight until it is swept.',
  cells:
    'A cell is one route x airline x departure-time band x advance-purchase ' +
    'window. It is the smallest unit the index prices. This counts the cells ' +
    'priced on the latest collection day, not the total ever collected.',
  match:
    'Of the flights priced yesterday, the share found again today. The index ' +
    'compares the same flight with itself, so unmatched flights cannot ' +
    'contribute a price change.',
  chart:
    'Each day the index moves by the geometric mean of how individual flight ' +
    'prices changed (Jevons), combined across routes by expenditure share ' +
    '(Young). Only flights present on both days count.',
  movers:
    'The routes whose own index moved most between the last two collection ' +
    'days. Weight is the share of the basket that route carries, so a large ' +
    'move on a small weight shifts the headline less than it looks.',
  quality:
    'How much of the latest day rests on directly observed prices rather than ' +
    'inference. These are offered fares shown to a searcher, not tickets ' +
    'actually sold.',
  thin:
    'A cell priced from fewer than 3 matched flights. It still counts in full ' +
    '-- dropping thin cells would remove about 41% of them and would ' +
    'preferentially remove quiet routes, which is a coverage bias rather than ' +
    'a quality improvement. Their variance is handled by their weight.',
  imputed:
    'A cell with no usable matched price today, filled from the movement of ' +
    'the aggregate above it. Carrying yesterday’s price forward is ' +
    'prohibited, because it would silently report "no change".',
  screened:
    'Fares that moved more than 3x in a single day. They are quarantined from ' +
    'the matched sample, never deleted, and the cell is then imputed.',
  retired:
    'Cells that were priced before but have no live weight today, usually ' +
    'because the flight stopped appearing.',
  provisional:
    'The reference window is still being collected. Levels will be ' +
    're-referenced onto the final window later, but no published daily link ' +
    'is ever revised.',
};

/** One figure in the KPI strip, with its explanation attached. */
function Kpi({ label, info, children, sub }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <InfoDot label={label}>{info}</InfoDot>
      </p>
      <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">{children}</p>
      {sub}
    </div>
  );
}

/** A labelled quality measure with its own share bar. */
function QualityRow({ label, info, n, of, share, color, footnote }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1">
          {label}
          <InfoDot label={label}>{info}</InfoDot>
        </span>
        <span className="tabular text-muted-foreground">
          {count(n)}
          {of != null && <span className="text-muted-foreground/70"> / {count(of)}</span>}
          <span className="ml-1.5 font-medium text-foreground">{sharePct(share, 1)}</span>
        </span>
      </div>
      <Progress>
        <Progress.Section value={share * 100} color={color} />
      </Progress>
      {footnote && <p className="mt-1 text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}

export default function Overview() {
  const [range, setRange] = useState('all');
  const [tourRunning, setTourRunning] = useState(false);
  const index = useIndex();
  const routes = useRoutes();
  const audit = useAudit();
  const collection = useCollection();

  // Only the headline series blocks the page. Movers, quality and provenance
  // each fill in when their own request lands, instead of holding the whole
  // screen blank behind the slowest of four round trips.
  const state = queryState(index);
  if (state) return state;

  const points = index.data.points ?? [];
  const cov = index.data.coverage;
  const last = points[points.length - 1];

  // The published link factor IS the day-on-day relative. The previous code
  // divided one rounded level by another to rebuild it, which CLAUDE.md
  // prohibits ("nothing recomputes an index level in JavaScript") and which
  // would drift the moment the series is re-referenced.
  const dod = last?.link != null ? (last.link - 1) * 100 : null;

  const sliced = range === 'all' ? points : points.slice(-Number(range));
  const chartData = sliced.map((p) => ({ date: shortDate(p.period_start), APIx: p.level }));

  const movers = (routes.data?.routes ?? [])
    .filter((r) => r.has_data && r.pct_change_1p !== null)
    .sort((a, b) => Math.abs(b.pct_change_1p) - Math.abs(a.pct_change_1p))
    .slice(0, 6);

  const churn = audit.data?.churn ?? {};
  const churnDays = Object.keys(churn).sort();
  const latestChurn = churnDays.length ? churn[churnDays[churnDays.length - 1]] : null;

  const totalCells = last?.n_cells ?? 0;
  const imputed = last?.n_cells_imputed ?? 0;
  const thin = last?.n_cells_thin ?? 0;
  const retired = last?.n_cells_dead ?? 0;
  const screened = last?.n_items_screened ?? 0;
  const matched = last?.n_items_matched ?? 0;
  const prevItems = last?.n_items_prev ?? 0;
  const priced = totalCells - imputed;

  // Previously hardcoded as `new Set(['serpapi_google_flights','booking_com'])`
  // -- a literal presented as a measured fact, which would have kept saying
  // "2 sources" after a third was added or one failed.
  const sources = collection.data?.summary?.sources ?? null;

  return (
    <div className="flex flex-col gap-5">
      <GuidedTour run={tourRunning} onFinish={() => setTourRunning(false)} page="overview" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Overview"
          description={index.data.reference?.label}
          badges={[
            { label: `${cov.n_points} collection days` },
            ...(cov.is_provisional ? [{ label: 'provisional' }] : []),
          ]}
        />
        <div className="flex items-center gap-2">
          {STATIC && <Badge variant="outline">Static demo snapshot</Badge>}
          <Button variant="outline" size="sm" onClick={() => setTourRunning(true)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Restart tour
          </Button>
        </div>
      </div>

      <div data-tour="kpi-row">
        <Card className="flex-row flex-wrap items-center justify-between gap-6 p-5">
          <Kpi label="Index level" info={INFO.level} sub={<Delta value={dod} />}>
            {idx(last?.level)}
          </Kpi>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <Kpi label="Routes covered" info={INFO.routes}>
            {cov.routes_with_data} / {cov.routes_in_basket}
          </Kpi>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <Kpi
            label="Cells priced today"
            info={INFO.cells}
            sub={<p className="mt-0.5 text-xs text-muted-foreground">on {shortDate(cov.last_date)}</p>}
          >
            {count(totalCells)}
          </Kpi>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <Kpi
            label="Flights matched"
            info={INFO.match}
            sub={
              <p className="mt-0.5 text-xs text-muted-foreground">
                {latestChurn ? `${count(matched)} of ${count(prevItems)} flights` : 'awaiting audit'}
              </p>
            }
          >
            {latestChurn ? sharePct(latestChurn.match_rate, 1) : '—'}
          </Kpi>
        </Card>
      </div>

      <Card className="p-5" data-tour="primary-chart">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              Airfare price index
              <InfoDot label="the airfare price index">{INFO.chart}</InfoDot>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Reference window = 100 · {count(totalCells)} cells on the latest day
            </p>
          </div>
          <SegmentedControl value={range} onChange={setRange} data={RANGES} aria-label="Chart range" />
        </div>
        <AreaChart
          h={280}
          data={chartData}
          dataKey="date"
          series={[{ name: 'APIx', color: CHART }]}
          fillOpacity={0.12}
          withDots={sliced.length < 40}
          valueFormatter={(v) => v.toFixed(2)}
        />
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card className="p-0">
          <div className="border-b border-border p-5 pb-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              Biggest movers
              <InfoDot label="biggest movers">{INFO.movers}</InfoDot>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Day-on-day change by route{' '}
              {cov.last_date && <>· {shortDate(cov.last_date)}</>}
            </p>
          </div>
          <div className="p-5 pt-3">
            {routes.isLoading ? (
              <Skeleton className="h-[190px] w-full" />
            ) : movers.length ? (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Route</Table.Th>
                    <Table.Th ta="right">Weight</Table.Th>
                    <Table.Th ta="right">Index</Table.Th>
                    <Table.Th ta="right">Change</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {movers.map((r) => (
                    <Table.Tr key={r.pair}>
                      <Table.Td>
                        <Link href={`/routes/${r.pair}`} className="text-sm font-semibold text-primary hover:underline">
                          {r.pair}
                        </Link>
                      </Table.Td>
                      <Table.Td ta="right">{sharePct(r.weight)}</Table.Td>
                      <Table.Td ta="right">{idx(r.level)}</Table.Td>
                      <Table.Td ta="right"><Delta value={r.pct_change_1p} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                Day-on-day changes need a second collection day on these routes.
              </p>
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              Data quality
              <InfoDot label="data quality">{INFO.quality}</InfoDot>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The {count(totalCells)} cells priced on {shortDate(cov.last_date)}
            </p>
          </div>

          <QualityRow
            label="Priced from observed fares"
            info="Cells with at least one flight matched between yesterday and today, so their price change is measured rather than inferred."
            n={priced}
            of={totalCells}
            share={totalCells ? priced / totalCells : 0}
            color="teal"
          />
          <QualityRow
            label="Thin cells"
            info={INFO.thin}
            n={thin}
            of={totalCells}
            share={totalCells ? thin / totalCells : 0}
            color="yellow"
            footnote="Fewer than 3 matched flights. Counted in full, never dropped."
          />
          <QualityRow
            label="Imputed"
            info={INFO.imputed}
            n={imputed}
            of={totalCells}
            share={totalCells ? imputed / totalCells : 0}
            color="orange"
            footnote={`Carrying ${sharePct(last?.weight_imputed ?? 0, 2)} of basket weight. Carry-forward is prohibited.`}
          />

          <ColorKey
            items={[
              { color: 'var(--success)', label: 'Observed — a matched price was found' },
              { color: 'var(--warning)', label: 'Thin — priced from fewer than 3 flights' },
              { color: 'color-mix(in oklab, var(--warning) 70%, var(--destructive))', label: 'Estimated — inferred, not observed' },
            ]}
            className="border-t border-border pt-3"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              Screened <InfoDot label="screened fares">{INFO.screened}</InfoDot>
              <span className="tabular font-medium text-foreground">{count(screened)}</span>
            </span>
            <span className="flex items-center gap-1">
              Retired <InfoDot label="retired cells">{INFO.retired}</InfoDot>
              <span className="tabular font-medium text-foreground">{count(retired)}</span>
            </span>
            {(last?.quality ?? []).map((q) => (
              <Badge key={q} variant="outline" className="text-[10px]">{q}</Badge>
            ))}
          </div>
        </Card>
      </SimpleGrid>

      <Card className="p-5" data-tour="provenance">
        <p className="text-sm text-muted-foreground">
          {count(totalCells)} cells priced on the latest day
          {sources
            ? <> from {sources.length} {sources.length === 1 ? 'source' : 'sources'} ({sources.join(', ')})</>
            : collection.isLoading
              ? ' from the collection log'
              : ''}
          , across {cov.n_points} collection days to {shortDate(cov.last_date)}. Full detail in{' '}
          <Link href="/data" className="font-medium text-primary hover:underline">the collection log</Link>.
        </p>
      </Card>

      {!STATIC && (
        <Note>
          The series begins {shortDate(cov.first_date)} and has {cov.n_points} daily points.
          Every number here is provisional and the reference window will be re-referenced without
          revising any published link.
        </Note>
      )}
    </div>
  );
}
