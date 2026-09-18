import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, SegmentedControl, SimpleGrid, Table } from '../compat/mantine';
import { AreaChart } from '../compat/mantine-charts';
import { useAudit, useIndex, useRoutes } from '../api';
import { count, idx, lastChange, sharePct, shortDate } from '../format';
import { Delta, Note, PageHeader, queryState } from '../ui';
import { CHART } from '../chartTokens';
import { GuidedTour } from '../components/GuidedTour';

const STATIC = import.meta.env.VITE_API_STATIC === '1';

const RANGES = [
  { label: '7D', value: '7' },
  { label: '30D', value: '30' },
  { label: 'All', value: 'all' },
];

export default function Overview() {
  const [range, setRange] = useState('all');
  const [tourRunning, setTourRunning] = useState(false);
  const index = useIndex();
  const routes = useRoutes();
  const audit = useAudit();

  const state = queryState(index, routes, audit);
  if (state) return state;

  const points = index.data.points ?? [];
  const cov = index.data.coverage;
  const last = points[points.length - 1];
  const dod = lastChange(points.map((p, i) => ({
    ...p,
    pct_change_1p: i ? (p.level / points[i - 1].level - 1) * 100 : null,
  })));

  const sliced = range === 'all' ? points : points.slice(-Number(range));
  const chartData = sliced.map((p) => ({ date: shortDate(p.period_start), APIx: p.level }));

  const withData = (routes.data.routes ?? []).filter((r) => r.has_data);
  const movers = withData
    .filter((r) => r.pct_change_1p !== null)
    .sort((a, b) => Math.abs(b.pct_change_1p) - Math.abs(a.pct_change_1p))
    .slice(0, 6);

  const churn = audit.data.churn ?? {};
  const churnDays = Object.keys(churn).sort();
  const latestChurn = churnDays.length ? churn[churnDays[churnDays.length - 1]] : null;
  const totalCells = last?.n_cells ?? 0;
  const imputed = last?.n_cells_imputed ?? 0;
  const nSources = new Set(['serpapi_google_flights', 'booking_com']).size;

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
          <div>
            <p className="text-xs text-muted-foreground">Index level</p>
            <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">{idx(last?.level)}</p>
            <Delta value={dod} />
          </div>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <div>
            <p className="text-xs text-muted-foreground">Routes covered</p>
            <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">
              {cov.routes_with_data} / {cov.routes_in_basket}
            </p>
          </div>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <div>
            <p className="text-xs text-muted-foreground">Cells priced</p>
            <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">{count(totalCells)}</p>
          </div>
          <div className="hidden h-10 w-px bg-border sm:block" />
          <div>
            <p className="text-xs text-muted-foreground">Item match rate</p>
            <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">
              {latestChurn ? sharePct(latestChurn.match_rate, 1) : '—'}
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-5" data-tour="primary-chart">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Airfare price index</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Jevons elementary · Young aggregation · {count(totalCells)} cells
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
            <h2 className="text-sm font-semibold">Biggest movers</h2>
            <p className="mt-1 text-sm text-muted-foreground">Day-on-day change by route</p>
          </div>
          <div className="p-5 pt-3">
            {movers.length ? (
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
                        <Link to={`/routes/${r.pair}`} className="text-sm font-semibold text-primary hover:underline">
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

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Data quality</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            How the latest day&rsquo;s {count(totalCells)} cells were priced
          </p>
          <Progress>
            <Progress.Section value={(imputed / (totalCells || 1)) * 100} color="orange" />
          </Progress>
          <p className="mt-3 text-xs text-muted-foreground">
            {imputed} of {totalCells} cells imputed from parent movement. Carry-forward is prohibited.
          </p>
        </Card>
      </SimpleGrid>

      <Card className="p-5" data-tour="provenance">
        <p className="text-sm text-muted-foreground">
          {count(totalCells)} cells priced from {nSources} sources across {cov.n_points} collection
          days, last verified {shortDate(cov.last_date)}. Full detail in{' '}
          <Link to="/data" className="font-medium text-primary hover:underline">the collection log</Link>.
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
