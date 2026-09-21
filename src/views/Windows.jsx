'use client';

import { Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart, LineChart } from '../compat/mantine-charts';
import { useWindows } from '../api';
import { count, idx, pct, rupees, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { SERIES_COLORS } from '../chartTokens';
import { InfoDot } from '../components/InfoDot';

/**
 * One small multiple: a single booking window's series.
 *
 * All five used to share one axis, which put a 77.6 and a 130.1 on the same
 * scale with twelve crossing lines. Separate panels on a SHARED domain keep
 * the comparison honest -- the panels are directly comparable because the
 * axis is identical -- while letting each shape actually be read.
 */
function WindowPanel({ w, domain, color, info }) {
  const pts = w.points ?? [];
  const latest = pts[pts.length - 1];
  const data = pts.map((p) => ({ date: shortDate(p.period_start), level: p.level }));
  return (
    <div className="border border-border p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-semibold">
          T+{w.lead_time_days}
          {w.brackets_mospi_spec && <span className="text-primary" aria-hidden="true">*</span>}
          <InfoDot label={`the T+${w.lead_time_days} window`}>{info}</InfoDot>
        </span>
        <span className="tabular text-sm font-medium">{idx(latest?.level)}</span>
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>booked {w.lead_time_days} day{w.lead_time_days === 1 ? '' : 's'} ahead</span>
        {latest?.pct_change_1p != null && (
          <span
            className={
              latest.pct_change_1p < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }
          >
            {pct(latest.pct_change_1p)}
          </span>
        )}
      </div>
      <LineChart
        h={96}
        data={data}
        dataKey="date"
        withDots={false}
        series={[{ name: 'level', color }]}
        xAxisProps={{ hide: true }}
        yAxisProps={{ hide: true, domain, width: 0 }}
        referenceLines={[{ y: 100, color: 'gray.5' }]}
        valueFormatter={(v) => (v == null ? '—' : v.toFixed(2))}
      />
    </div>
  );
}

export default function Windows() {
  const q = useWindows();
  const state = queryState(q);
  if (state) return state;

  const windows = q.data.windows ?? [];

  // One shared scale across every panel, padded, so the panels can be
  // compared against each other and against the reference line at 100.
  const levels = windows.flatMap((w) => (w.points ?? []).map((p) => p.level)).filter((v) => v != null);
  const domain = levels.length
    ? [Math.floor(Math.min(...levels, 100) - 3), Math.ceil(Math.max(...levels, 100) + 3)]
    : ['auto', 'auto'];

  const fareCurve = windows.map((w) => ({
    window: `T+${w.lead_time_days}`,
    'Mean fare': w.mean_fare ?? 0,
  }));

  const anyMospi = windows.some((w) => w.brackets_mospi_spec);

  return (
    <Stack gap="lg">
      {pageHeader('Booking windows',
        'Each advance-purchase window published separately, and blended into the headline',
        [{ label: `${windows.length} windows`, color: 'gray' }])}

      <Paper>
        <Title order={2} mb={4} className="flex items-center gap-1.5">
          Index by advance-purchase window
          <InfoDot label="these five panels">
            How the price of a seat bought N days before departure has moved. Every panel uses
            the same vertical scale and the same reference of 100, so their heights and shapes
            are directly comparable.
          </InfoDot>
        </Title>
        <Text size="xs" c="dimmed" mb="md">
          Shared scale, reference = 100 · latest level and day-on-day change on each panel
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
          {windows.map((w, i) => (
            <WindowPanel
              key={w.lead_time_days}
              w={w}
              domain={domain}
              color={SERIES_COLORS[i % SERIES_COLORS.length]}
              info={
                w.brackets_mospi_spec
                  ? q.data.mospi_note
                  : `Fares for departures ${w.lead_time_days} day${w.lead_time_days === 1 ? '' : 's'} after the search date. Indexed on the same reference window as the headline.`
              }
            />
          ))}
        </SimpleGrid>
        {anyMospi && (
          <Text size="xs" c="dimmed" mt="sm">
            <span className="text-primary">*</span> {q.data.mospi_note}
          </Text>
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            Fare by booking window
            <InfoDot label="the fare curve">
              The average fare actually observed at each lead time, in rupees. This is the price
              level, not the index -- it answers &ldquo;what does booking earlier cost?&rdquo;
              rather than &ldquo;how has it moved?&rdquo;. Offered fares, not tickets sold.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">Mean observed fare by how far ahead the seat was priced</Text>
          <BarChart
            h={260} data={fareCurve} dataKey="window"
            series={[{ name: 'Mean fare', color: 'teal.6' }]}
            withTooltip valueFormatter={(v) => rupees(v)} yAxisProps={{ width: 64 }}
          />
        </Paper>

        <Paper p={0}>
          <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
            Windows
            <InfoDot label="this table">
              One row per advance-purchase window, with the share of the headline it carries,
              how many offers it was built from, and where its own index stands.
            </InfoDot>
          </Title>
          {/* Previously Table.ScrollContainer minWidth={1060} -- inside a
              half-width grid column, which forced a horizontal scrollbar on
              every screen size. Five columns fit without it. */}
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Window</Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">
                    Weight
                    <InfoDot label="window weight" side="left">{q.data.weighting_note}</InfoDot>
                  </span>
                </Table.Th>
                <Table.Th ta="right">Offers</Table.Th>
                <Table.Th ta="right">Mean fare</Table.Th>
                <Table.Th ta="right">Index</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {windows.map((w) => (
                <Table.Tr key={w.lead_time_days}>
                  <Table.Td className="whitespace-nowrap font-semibold">
                    T+{w.lead_time_days}
                    {w.brackets_mospi_spec && <span className="ml-0.5 text-primary" aria-hidden="true">*</span>}
                  </Table.Td>
                  <Table.Td ta="right">{sharePct(w.weight_in_headline, 0)}</Table.Td>
                  <Table.Td ta="right">{count(w.n_offers)}</Table.Td>
                  <Table.Td ta="right">{rupees(w.mean_fare)}</Table.Td>
                  <Table.Td ta="right">
                    <Text fw={600} size="sm">{idx(w.points[w.points.length - 1]?.level)}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <div className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
            Each window carries an equal {sharePct(windows[0]?.weight_in_headline ?? 0.2, 0)} of the
            headline.{' '}
            <InfoDot label="why the weights are equal">{q.data.weighting_note}</InfoDot>
          </div>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
