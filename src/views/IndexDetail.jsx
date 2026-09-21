'use client';

import { Badge, Group, Paper, Stack, Table, Tabs, Text, Title } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { useAudit, useIndex } from '../api';
import { count, idx, pct, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { Note } from '../ui';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';

/** '2026-09-10' -> '10 Sep 2026'. Day-first, the Indian convention, and the
 *  locale is pinned rather than taken from the browser for the same reason
 *  the rest of the dashboard pins en-IN. */
const fullDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

/**
 * Complete ISO weeks inside the collected range.
 *
 * Calendar arithmetic only -- this counts days, it never touches an index
 * level. Whether a weekly series can exist is a question about coverage, and
 * answering it here means the tab explains itself from the data instead of
 * from a hardcoded sentence that goes stale.
 */
function isoWeekProgress(firstISO, lastISO) {
  if (!firstISO || !lastISO) return null;
  const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const DAY = 86400000;
  const first = toUTC(firstISO), last = toUTC(lastISO);
  const weeks = new Map();
  for (let t = first; t <= last; t += DAY) {
    const dt = new Date(t);
    // Monday of this date's ISO week.
    const dow = (dt.getUTCDay() + 6) % 7;
    const monday = t - dow * DAY;
    weeks.set(monday, (weeks.get(monday) ?? 0) + 1);
  }
  const complete = [...weeks.entries()].filter(([, n]) => n === 7).map(([m]) => m).sort();
  // When the next week would finish, so the panel can say how long is left.
  const lastDow = (new Date(last).getUTCDay() + 6) % 7;
  const nextSunday = last + (6 - lastDow) * DAY;
  return {
    complete: complete.length,
    completeRanges: complete.map((m) => `${fullDate(new Date(m).toISOString().slice(0, 10))} – ${fullDate(new Date(m + 6 * DAY).toISOString().slice(0, 10))}`),
    nextCompletes: new Date(nextSunday).toISOString().slice(0, 10),
    daysToNext: Math.round((nextSunday - last) / DAY),
  };
}

/** Panel shown for a frequency the engine has not published yet. */
function PendingFrequency({ title, reason, progress }) {
  return (
    <Paper>
      <Title order={2} mb="sm">{title}</Title>
      <Text size="sm" c="dimmed">{reason}</Text>
      {progress}
      <Text size="sm" c="dimmed" mt="md">
        Nothing is shown here rather than an approximation. Averaging the days
        we have and labelling the result &ldquo;weekly&rdquo; would be a different
        estimator wearing the same name, and the number would move when the real
        series arrived.
      </Text>
    </Paper>
  );
}

export default function IndexDetail() {
  const q = useIndex();
  const audit = useAudit();
  const state = queryState(q, audit);
  if (state) return state;

  const points = q.data.points ?? [];
  const cov = q.data.coverage;
  const chart = points.map((p) => ({ date: shortDate(p.period_start), APIx: p.level }));
  const pending = cov.frequencies_pending ?? {};
  const wk = isoWeekProgress(cov.first_date, cov.last_date);

  // Shown once above the table instead of on all 12 rows, where it was noise:
  // it describes the series, not any particular day.
  const seriesWide = 'BASE_WINDOW_PROVISIONAL';

  return (
    <Stack gap="lg">
      {pageHeader('Index detail', q.data.reference?.label,
        [{ label: `${points.length} points`, color: 'gray' }])}

      <Tabs defaultValue="D">
        <Tabs.List mb="lg" data-tour="frequency-tabs">
          <Tabs.Tab value="D">Daily</Tabs.Tab>
          <Tabs.Tab value="W">Weekly</Tabs.Tab>
          <Tabs.Tab value="M">Monthly</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="W">
          <PendingFrequency
            title="Weekly"
            reason={pending.W ?? 'Not published yet.'}
            progress={
              wk && (
                <Text size="sm" mt="sm">
                  <strong>{wk.complete} of 2</strong> complete ISO weeks collected so far
                  {wk.completeRanges.length > 0 && <> ({wk.completeRanges.join('; ')})</>}. A
                  week-on-week change needs two, because the first complete week is the base the
                  second is compared against. The next week completes{' '}
                  <strong>{fullDate(wk.nextCompletes)}</strong>
                  {wk.daysToNext > 0 && <> , {wk.daysToNext} collection day{wk.daysToNext === 1 ? '' : 's'} away</>}.
                </Text>
              )
            }
          />
        </Tabs.Panel>

        <Tabs.Panel value="M">
          <PendingFrequency
            title="Monthly"
            reason={pending.M ?? 'Not published yet.'}
            progress={
              <Text size="sm" mt="sm">
                Collection began {fullDate(cov.first_date)}, part-way through the month, so the
                first complete calendar month is the first one collected end to end.
              </Text>
            }
          />
        </Tabs.Panel>

        <Tabs.Panel value="D">
          <Stack gap="lg">
            <Paper>
              <Title order={2} mb="md" className="flex items-center gap-1.5">
                Daily series
                <InfoDot label="the daily series">
                  Each day&rsquo;s level relative to the reference window, which is fixed at 100.
                  A point above 100 means fares were higher than the window average that day.
                </InfoDot>
              </Title>
              <LineChart
                h={320} data={chart} dataKey="date" curveType="natural" withDots
                series={[{ name: 'APIx', color: 'indigo.6' }]}
                referenceLines={[{ y: 100, label: 'reference = 100', color: 'gray.5' }]}
                yAxisProps={{ domain: ['dataMin - 3', 'dataMax + 3'] }}
                valueFormatter={(v) => v.toFixed(2)}
              />
            </Paper>

            <Paper p={0}>
              <div className="flex flex-wrap items-center justify-between gap-2 p-6 pb-2">
                <Title order={2} className="flex items-center gap-1.5">
                  Every published point
                  <InfoDot label="this table">
                    One row per collection day. Every figure here is the value the engine
                    published for that day; nothing on this page is recalculated in the browser.
                  </InfoDot>
                </Title>
                <Badge size="xs" variant="light" color="orange">
                  all {points.length} points {seriesWide.toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </div>
              <Table striped verticalSpacing="sm" horizontalSpacing="sm" className="table-fixed">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th ta="right">Level</Table.Th>
                    <Table.Th ta="right">Change</Table.Th>
                    <Table.Th ta="right" className="hidden md:table-cell">Cells</Table.Th>
                    <Table.Th ta="right">Estimated</Table.Th>
                    <Table.Th ta="right" className="hidden lg:table-cell">Matched</Table.Th>
                    <Table.Th>Flags</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {points.map((p) => {
                    // The published link factor IS the day-on-day relative;
                    // this only renders it as a percentage.
                    const change = p.link != null ? (p.link - 1) * 100 : null;
                    const flags = (p.quality ?? []).filter((f) => f !== seriesWide);
                    return (
                      <Table.Tr key={p.period_start}>
                        <Table.Td className="whitespace-nowrap">{fullDate(p.period_start)}</Table.Td>
                        <Table.Td ta="right"><Text fw={600} size="sm">{idx(p.level)}</Text></Table.Td>
                        <Table.Td ta="right" title={p.link != null ? `link factor ${p.link.toFixed(6)}` : undefined}>
                          {change == null
                            ? <span className="text-muted-foreground">anchor</span>
                            : <span className={change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{pct(change)}</span>}
                        </Table.Td>
                        <Table.Td ta="right" className="hidden md:table-cell">
                          {count(p.n_cells)}
                          {p.n_cells_thin > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">({p.n_cells_thin} thin)</span>
                          )}
                        </Table.Td>
                        <Table.Td ta="right">
                          {p.n_cells_imputed > 0 ? (
                            <>
                              {p.n_cells_imputed}
                              <span className="ml-1 text-xs text-muted-foreground">
                                {sharePct(p.weight_imputed, 2)} wt
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Table.Td>
                        <Table.Td ta="right" className="hidden lg:table-cell whitespace-nowrap">
                          {p.n_items_prev
                            ? `${count(p.n_items_matched)} / ${count(p.n_items_prev)}`
                            : <span className="text-muted-foreground">anchor</span>}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {flags.map((f) => (
                              <Badge key={f} size="xs" variant="light"
                                     color={f === 'ANCHOR' ? 'gray' : 'orange'}>
                                {f.toLowerCase().replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              <div className="border-t border-border px-6 pt-3">
                <ColorKey
                  items={[
                    { color: 'var(--success)', label: 'Rose against the previous day' },
                    { color: 'var(--destructive)', label: 'Fell against the previous day' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  Estimated
                  <InfoDot label="estimated cells">
                    Cells with no usable matched price that day, filled from the movement of the
                    aggregate above them. This is inference we supply, not an observed fare.
                    Carrying yesterday&rsquo;s price forward is prohibited, because it would
                    silently report &ldquo;no change&rdquo;.
                  </InfoDot>
                  = filled from parent movement, not observed
                </span>
                <span className="flex items-center gap-1">
                  Thin
                  <InfoDot label="thin cells">
                    Priced from fewer than 3 matched flights. Counted in full: dropping them would
                    remove about 41% of cells and preferentially remove quiet routes, which is a
                    coverage bias rather than a quality improvement.
                  </InfoDot>
                  = fewer than 3 matched flights
                </span>
              </div>
            </Paper>

            <Paper>
              <Title order={2} mb="sm" className="flex items-center gap-1.5">
                Transitivity audit
                <InfoDot label="the transitivity audit">
                  Chaining day-by-day should land in the same place as comparing the last day
                  directly against the base. The gap between the two is drift, and a small number
                  here is evidence the chaining is arithmetically sound.
                </InfoDot>
              </Title>
              <Group gap="xl">
                <div>
                  <Text size="xs" c="dimmed">Chained</Text>
                  <Text fw={600}>{idx(audit.data.transitivity.chained_raw_level)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Direct fixed-base</Text>
                  <Text fw={600}>{idx(audit.data.transitivity.direct_fixed_base)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Drift</Text>
                  <Text fw={600}>{pct(audit.data.transitivity.drift_pct, 3)}</Text>
                </div>
              </Group>
              <Text size="xs" c="dimmed" mt="md">{audit.data.transitivity.note}</Text>
            </Paper>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
