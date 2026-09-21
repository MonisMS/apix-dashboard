'use client';

import { Group, Paper, SegmentedControl, Stack, Text, Title } from '../compat/mantine';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useHeatmap } from '../api';
import { shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { HeatGrid, HeatLegend } from '../components/HeatGrid';
import { InfoDot } from '../components/InfoDot';

const METRICS = [
  { label: 'Day-on-day %', value: 'pct_change' },
  { label: 'Index level', value: 'level' },
  { label: 'Mean fare', value: 'mean_fare' },
  { label: 'Offers', value: 'n_offers' },
];

/** What each metric means, and what a reader should look for in it. */
const ABOUT = {
  pct_change:
    'How much each route moved against the day before. Red is a fall, green a rise, and the ' +
    'strongest colour is the largest move in the grid. Scan for a column that is red or green ' +
    'right down its length: that is a day the whole market moved, rather than one route.',
  level:
    'Where each route’s own index stands, with 100 being its reference-window average. ' +
    'Darker is higher. A row that is dark all the way across is a route that has been ' +
    'expensive throughout, not one that spiked.',
  mean_fare:
    'The average fare observed for that route on that day, in rupees. This is the price ' +
    'itself, not the index, so long routes are darker simply because they cost more.',
  n_offers:
    'How many individual fares were collected for that route that day. This is coverage, not ' +
    'price: a pale row means thin sampling, and its index should be read with more caution.',
};

const compactFare = (v) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

export default function Heatmap() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const metric = METRICS.some((m) => m.value === params.get('metric'))
    ? params.get('metric')
    : 'pct_change';
  const setMetric = (v) => router.replace(`${pathname}?metric=${v}`, { scroll: false });
  const q = useHeatmap(metric);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const diverging = metric === 'pct_change';

  const fmt = (v) => {
    if (v === null || v === undefined) return '–';
    if (metric === 'pct_change') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    if (metric === 'mean_fare') return compactFare(v);
    if (metric === 'level') return v.toFixed(1);
    return String(Math.round(v));
  };
  const fmtLegend = (v) => {
    if (metric === 'pct_change') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    if (metric === 'mean_fare') return `₹${compactFare(v)}`;
    if (metric === 'level') return v.toFixed(1);
    return String(Math.round(v));
  };

  const xLabels = (d.x_labels ?? []).map(shortDate);
  const cells = (d.data ?? []).map((c) => ({ x: shortDate(c.x), y: c.y, value: c.value }));
  const values = cells.map((c) => c.value).filter((v) => v !== null && v !== undefined);
  const maxAbs = values.length ? Math.max(...values.map(Math.abs)) : 1;

  return (
    <Stack gap="lg">
      {pageHeader('Sector heatmap', 'Every basket route against every collection day', [
        { label: `${d.y_labels.length} routes × ${xLabels.length} days`, color: 'gray' },
      ])}

      <Paper>
        <Group justify="space-between" mb="md">
          <div>
            <Title order={2} className="flex items-center gap-1.5">
              Route × day
              <InfoDot label="this grid">
                One square per route per collection day. It exists to find patterns a single
                line chart hides: whether a move was market-wide or one route, and which routes
                are thinly sampled. Every square shows its own number, so nothing depends on
                telling two shades apart.
              </InfoDot>
            </Title>
            <Text size="xs" c="dimmed" mt={2}>{ABOUT[metric]}</Text>
          </div>
          <SegmentedControl
            size="xs" radius="xl" value={metric} onChange={setMetric} data={METRICS}
            aria-label="Choose which metric the heatmap shows"
          />
        </Group>

        {/* Fluid columns, so the grid always fits its container instead of
            growing 64px wider with every collection day and forcing a
            horizontal scroll. */}
        <HeatGrid
          xLabels={xLabels}
          yLabels={d.y_labels ?? []}
          cells={cells}
          diverging={diverging}
          format={fmt}
          naLabel={diverging ? 'no prior day to compare' : 'not collected'}
        />

        <div className="mt-4 border-t border-border pt-3">
          <HeatLegend
            diverging={diverging}
            min={diverging ? -maxAbs : Math.min(...values)}
            max={diverging ? maxAbs : Math.max(...values)}
            format={fmtLegend}
            naLabel={diverging ? 'no prior day to compare' : 'not collected'}
          />
          {diverging && (
            <Text size="xs" c="dimmed" mt="xs">
              The first column is hatched on every row because a day-on-day change needs a
              previous day, and {shortDate(d.x_labels?.[0])} is the first day collected. It is
              not missing data.
            </Text>
          )}
        </div>
      </Paper>
    </Stack>
  );
}
