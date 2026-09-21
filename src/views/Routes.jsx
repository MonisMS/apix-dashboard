'use client';

import { Alert, Badge, Group, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { IconAlertTriangle } from '../compat/icons';
import Link from 'next/link';
import { useRoutes } from '../api';
import { count, idx, pct, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';

export default function Routes() {
  const q = useRoutes();
  const state = queryState(q);
  if (state) return state;

  const rows = q.data.routes ?? [];
  const cov = q.data.coverage;
  const withData = rows.filter((r) => r.has_data);

  const above = withData.filter((r) => (r.level ?? 0) >= 100);
  const noData = rows.filter((r) => !r.has_data);
  // Dearest first, so the chart reads top-to-bottom as one ordered shape.
  const byLevel = [...withData].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  // Bar geometry only: the printed figure is always the published level.
  const maxDev = Math.max(...withData.map((r) => Math.abs((r.level ?? 100) - 100)), 1);

  return (
    <Stack gap="lg">
      {pageHeader('Routes', 'Every route in the DGCA-derived basket, including those not yet collected', [
        { label: `${withData.length} of ${rows.length} with fares`, color: 'gray' },
      ])}

      {cov.routes_without_fares.length > 0 && (
        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={18} aria-hidden="true" />}
               title={`${cov.routes_without_fares.length} basket routes have no fares yet`}>
          <Text size="sm">
            {cov.routes_without_fares.join(', ')} are in the basket but the collector has
            not swept them. They carry zero weight and are shown below rather than hidden —
            a coverage gap you cannot see is one nobody fixes.
          </Text>
        </Alert>
      )}

      <Paper>
        <Title order={2} mb={4} className="flex items-center gap-1.5">
          How far each route is from its reference
          <InfoDot label="this chart">
            Every route&rsquo;s own index, measured against 100 — the average of the reference
            window. Bars to the right are routes that have got dearer since then; bars to the
            left are routes that have got cheaper. The longer the bar, the bigger the gap.
          </InfoDot>
        </Title>
        <Text size="xs" c="dimmed" mb="md">
          Sorted dearest to cheapest · {above.length} of {withData.length} routes are above the reference
        </Text>

        <div className="flex flex-col">
          {byLevel.map((r) => {
            const dev = (r.level ?? 100) - 100;
            const up = dev >= 0;
            const w = maxDev ? (Math.abs(dev) / maxDev) * 50 : 0;
            return (
              <div
                key={r.pair}
                className="grid grid-cols-[minmax(72px,auto)_1fr_minmax(96px,auto)] items-center gap-3 py-[3px]"
              >
                <Link
                  href={`/routes/${r.pair}`}
                  className="truncate text-sm font-medium text-primary hover:underline"
                  translate="no"
                >
                  {r.pair}
                </Link>

                <div className="relative h-4">
                  {/* Solid hairline baseline: this is the reference, so it is
                      the thing every bar is measured from. */}
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                  <span
                    className="absolute top-1/2 h-3.5 -translate-y-1/2"
                    style={{
                      left: up ? '50%' : `${50 - w}%`,
                      width: `${Math.max(w, 0.25)}%`,
                      background: up ? 'var(--success)' : 'var(--destructive)',
                      // 4px rounded data-end, square where it meets the baseline.
                      borderRadius: up ? '0 4px 4px 0' : '4px 0 0 4px',
                    }}
                  />
                </div>

                <div className="flex items-baseline justify-end gap-2 whitespace-nowrap">
                  <span className="tabular text-sm font-medium">{idx(r.level)}</span>
                  <span className="tabular text-xs text-muted-foreground">{sharePct(r.weight, 1)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-1 grid grid-cols-[minmax(72px,auto)_1fr_minmax(96px,auto)] gap-3 text-[11px] text-muted-foreground">
          <span />
          <span className="text-center">100 — reference window average</span>
          <span className="text-right">level · weight</span>
        </div>

        {noData.length > 0 && (
          <Text size="xs" c="dimmed" mt="sm">
            Not shown: {noData.map((r) => r.pair).join(', ')} — in the basket but no fares
            collected yet, so they have no level to place.
          </Text>
        )}

        <ColorKey
          className="mt-3"
          items={[
            { color: 'var(--success)', label: 'Dearer than the reference window' },
            { color: 'var(--destructive)', label: 'Cheaper than the reference window' },
          ]}
          note="Bar length is the distance from 100; the figure on the right is the published level, and beside it the share of the basket that route carries."
        />
      </Paper>

      <Paper p={0}>
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Route</Table.Th>
                <Table.Th>Cities</Table.Th>
                <Table.Th ta="right" className="hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1">DGCA pax<InfoDot label="DGCA passengers" side="left">
                    Passengers carried on this route in calendar year 2025, from DGCA&rsquo;s published
                    traffic data. It is what sets the route&rsquo;s weight; it is not something we collected.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right">Weight</Table.Th>
                <Table.Th ta="right">Mean fare</Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">Index<InfoDot label="the route index" side="left">
                    This route&rsquo;s own price index, on the same reference window as the headline,
                    where 100 is that window&rsquo;s average. 95 means fares are about 5% below it.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">Day-on-day<InfoDot label="day-on-day" side="left">
                    How far this route&rsquo;s index moved against the previous collection day. Published
                    by the engine, not recalculated here.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right" className="hidden md:table-cell">
                  <span className="inline-flex items-center gap-1">Cells<InfoDot label="cells" side="left">
                    A cell is one airline x departure-time band x advance-purchase window on this
                    route. It is the smallest unit the index prices, and this counts how many were
                    priced on the latest day.
                  </InfoDot></span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.pair}>
                  <Table.Td>
                    {/* nowrap: an identifier, not prose. "BLR-DEL" was breaking
                        after the hyphen and reading as two rows. */}
                    {r.has_data ? (
                      <Text component={Link} href={`/routes/${r.pair}`} fw={600} size="sm"
                            c="indigo" style={{ whiteSpace: 'nowrap' }} translate="no">
                        {r.pair}
                      </Text>
                    ) : (
                      <Text fw={600} size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}
                            translate="no">{r.pair}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" tt="capitalize">
                      {r.city_a.toLowerCase()} – {r.city_b.toLowerCase()}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="hidden lg:table-cell">{count(r.pax_cy)}</Table.Td>
                  <Table.Td ta="right">{r.has_data ? sharePct(r.weight) : '—'}</Table.Td>
                  <Table.Td ta="right">{rupees(r.mean_fare_latest)}</Table.Td>
                  <Table.Td ta="right"><Text fw={600} size="sm">{idx(r.level)}</Text></Table.Td>
                  <Table.Td ta="right">
                    {r.has_data ? (
                      <span className={r.pct_change_1p >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                        {pct(r.pct_change_1p)}
                      </span>
                    ) : (
                      <Badge size="sm" variant="light" color="gray">not collected</Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right" className="hidden md:table-cell">{count(r.n_cells)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        <div className="border-t border-border px-6 py-3">
          <ColorKey
            items={[
              { color: 'var(--success)', label: 'Rose against the previous collection day' },
              { color: 'var(--destructive)', label: 'Fell against the previous collection day' },
            ]}
            note="Colour repeats what the sign already says; neither is needed to read the number."
          />
        </div>
      </Paper>
    </Stack>
  );
}
