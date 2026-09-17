import {
  Alert, Group, Paper, ScrollArea, SegmentedControl, Stack, Text, Title,
} from '../compat/mantine';
import { MatrixChart } from '../compat/mantine-charts';
import { IconInfoCircle } from '../compat/icons';
import { useSearchParams } from 'react-router-dom';
import { useHeatmap } from '../api';
import { rupees, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

const METRICS = [
  { label: 'Day-on-day %', value: 'pct_change' },
  { label: 'Index level', value: 'level' },
  { label: 'Mean fare', value: 'mean_fare' },
  { label: 'Offers', value: 'n_offers' },
];

// Day-on-day change is signed, so it needs a diverging scale: falling fares must
// not look the same as rising ones. The other metrics are one-directional and
// use a single hue.
const DIVERGING = ['red.7', 'red.4', 'gray.2', 'teal.4', 'teal.7'];
const SEQUENTIAL = ['indigo.1', 'indigo.3', 'indigo.5', 'indigo.7', 'indigo.9'];

export default function Heatmap() {
  // In the URL, not component state: a heatmap someone is pointing at is worth
  // linking to, and back/forward should move between metrics.
  const [params, setParams] = useSearchParams();
  const metric = METRICS.some((m) => m.value === params.get('metric'))
    ? params.get('metric')
    : 'pct_change';
  const setMetric = (v) => setParams({ metric: v }, { replace: true });
  const q = useHeatmap(metric);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const signed = metric === 'pct_change';
  const values = (d.data ?? []).map((c) => c.value).filter((v) => v !== null);
  const maxAbs = values.length ? Math.max(...values.map(Math.abs)) : 1;

  const data = (d.data ?? []).map((c) => ({
    x: shortDate(c.x),
    y: c.y,
    value: c.value,
  }));

  const fmt = (v) => {
    if (v === null || v === undefined) return 'no data';
    if (metric === 'pct_change') return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    if (metric === 'mean_fare') return rupees(v);
    if (metric === 'level') return v.toFixed(2);
    return String(v);
  };

  return (
    <Stack gap="lg">
      {pageHeader('Sector heatmap', 'Every basket route against every collection day', [
        { label: `${d.y_labels.length} routes`, color: 'gray' },
      ])}

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} aria-hidden="true" />}>
        <Text size="sm">{d.note}</Text>
      </Alert>

      <Paper>
        <Group justify="space-between" mb="lg">
          <div>
            <Title order={4}>Route × day</Title>
            <Text size="xs" c="dimmed">
              {signed
                ? 'Red is a fall, green is a rise, scaled symmetrically around zero'
                : 'Darker is higher'}
            </Text>
          </div>
          <SegmentedControl
            size="xs"
            radius="xl"
            value={metric}
            onChange={setMetric}
            data={METRICS}
            aria-label="Choose which metric the heatmap shows"
          />
        </Group>
        {/* The matrix is a fixed 64px per cell, so its width grows with every
            collection day. At 5 days it already overflowed a phone by 161px,
            and by end-September it would overflow a laptop too. Scroll the
            chart rather than the page. */}
        <ScrollArea type="auto" offsetScrollbars>
          <MatrixChart
            data={data}
            xLabels={(d.x_labels ?? []).map(shortDate)}
            yLabels={d.y_labels}
            colors={signed ? DIVERGING : SEQUENTIAL}
            domain={signed ? [-maxAbs, maxAbs] : undefined}
            cellSize={64}
            gap={4}
            cellRadius={6}
            yLabelsWidth={92}
            xLabelsHeight={28}
            xLabelsRotation={0}
            fontSize={12}
            emptyColor="gray.1"
            withXLabels
            withYLabels
            withTooltip
            withLegend
            legendLabels={signed ? ['Falling', 'Rising'] : ['Low', 'High']}
            getTooltipLabel={(c) => `${c.y} · ${c.x} — ${fmt(c.value)}`}
          />
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
