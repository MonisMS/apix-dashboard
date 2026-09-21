'use client';

import { Badge, Card, Group, List, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { IconCircleCheck } from '../compat/icons';
import { useValidation } from '../api';
import { idx, pct } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';

export default function Validation() {
  const q = useValidation();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const mospi = (d.mospi.points ?? []).map((p) => ({ period: p.label, MoSPI: p.index }));
  const t = d.audit.transitivity;
  const h = d.harness;

  return (
    <Stack gap="lg">
      {pageHeader('Validation', 'APIx against MoSPI’s published Airfare item 294',
        [{ label: d.overlap.has_overlap ? 'overlapping' : 'no overlap', color: d.overlap.has_overlap ? 'teal' : 'orange' }])}

      <Paper>
        <Title order={2} mb={4} className="flex items-center gap-1.5">
          MoSPI published Airfare index
          <InfoDot label="this chart">
            The official Airfare series (item 294) MoSPI publishes monthly, shown on its own. APIx starts after it ends, so plotting both on one axis would imply a comparison that does not exist.
          </InfoDot>
        </Title>
        <Text size="xs" c="dimmed" mb="md">
          {d.mospi.source} · {d.mospi.frequency} · {d.mospi.base} · {d.mospi.n_points} points
          ({d.mospi.first} to {d.mospi.last})
        </Text>
        <LineChart
          h={280} data={mospi} dataKey="period" curveType="natural"
          series={[{ name: 'MoSPI', color: 'var(--chart-2)' }]}
          xAxisProps={{ angle: -40, textAnchor: 'end', height: 70 }}
          valueFormatter={(v) => v.toFixed(2)}
        />
        <Text size="xs" c="dimmed" mt="sm">
          APIx begins {d.apix.first}, after this series ends. Plotting them on one axis
          would imply a comparison that does not exist, so they are shown apart.
        </Text>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            Pass criteria, fixed in advance
            <InfoDot label="pass criteria">
              The four thresholds APIx must meet against MoSPI, written down before any comparison was possible. Fixing them in advance is what stops the test being tuned afterwards to whatever result appeared.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">{h.criteria_note}</Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
            <Table variant="vertical" withTableBorder={false}>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th w={230}>Direction agrees</Table.Th>
                  <Table.Td>at least {(h.criteria.min_sign_agreement * 100).toFixed(0)}% of months</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Correlation</Table.Th>
                  <Table.Td>r ≥ {h.criteria.min_correlation}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Mean absolute error</Table.Th>
                  <Table.Td>≤ {h.criteria.max_mean_abs_error_pp} pp</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Mean bias</Table.Th>
                  <Table.Td>within ±{h.criteria.max_abs_mean_bias_pp} pp</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          <Text size="xs" c="dimmed" mt="md">
            Calibrated against MoSPI&rsquo;s own volatility: their airfare index moves with
            a standard deviation of {h.mospi_profile.mom_sd_pct} pp per month, so a
            {' '}{h.criteria.max_mean_abs_error_pp} pp mean error is about half their own
            monthly noise.
          </Text>
        </Card>

        <Card>
          <Group gap="sm" mb="sm">
            <IconCircleCheck size={20}
              color={h.harness_works ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-red-6)'} />
            <Title order={2} className="flex items-center gap-1.5">
              The harness proves its own arithmetic
              <InfoDot label="the self test">
                The comparison code is run against cases whose answers are already known — a series compared with itself must score r = 1, an unrelated one must not. If the harness cannot get those right, nothing else it reports is evidence.
              </InfoDot>
            </Title>
          </Group>
          <Text size="xs" c="dimmed" mb="md">
            The metrics run on cases whose answers are known, every time. A harness that
            has never produced a correct answer on a checkable case is not evidence.
          </Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
            <Table striped verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Case</Table.Th>
                  <Table.Th ta="right">r</Table.Th>
                  <Table.Th ta="right">Result</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(h.harness_self_test).map(([name, t]) => (
                  <Table.Tr key={name}>
                    <Table.Td>
                      <Text size="xs" tt="capitalize">{name.replace(/_/g, ' ')}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{t.correlation ?? '—'}</Table.Td>
                    <Table.Td ta="right">
                      <Badge size="xs" variant="light" color={t.passes ? 'teal' : 'red'}>
                        {t.passes ? 'as expected' : 'WRONG'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Title order={2} mb="sm" className="flex items-center gap-1.5">
            When a real answer first exists
            <InfoDot label="first comparable month">
              A month-on-month comparison needs one complete calendar month of APIx collection that MoSPI has also published. This is the earliest that can happen, and how many collection days are still needed.
            </InfoDot>
          </Title>
          <Table variant="vertical" withTableBorder={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={220}>First comparable month</Table.Th>
                <Table.Td><Text fw={600}>{h.first_comparable.month}</Text></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Days needed</Table.Th>
                <Table.Td>
                  {h.first_comparable.days_required} of {h.first_comparable.days_available_in_month} remaining
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Room to miss</Table.Th>
                <Table.Td>
                  <Badge variant="light" color={h.first_comparable.at_risk ? 'orange' : 'teal'}>
                    {h.first_comparable.slack_days} day(s)
                  </Badge>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="md">{h.first_comparable.note}</Text>
        </Card>

        <Card>
          <Group gap="sm" mb="sm">
            <IconCircleCheck size={20} color="var(--mantine-color-teal-6)" />
            <Title order={2} className="flex items-center gap-1.5">
              What we can show instead
              <InfoDot label="evidence available now">
                With no overlap, correlation against MoSPI cannot be computed. These are the checks that can be run today, stated instead of a number nobody could verify.
              </InfoDot>
            </Title>
          </Group>
          <List size="sm" spacing="xs">
            {(d.overlap.what_we_can_show_instead ?? []).map((s) => (
              <List.Item key={s}>{s}</List.Item>
            ))}
          </List>
        </Card>

        <Card>
          <Title order={2} mb="sm" className="flex items-center gap-1.5">
            Transitivity audit
            <InfoDot label="transitivity">
              Chaining day by day should land on the same level as comparing the last day directly against the base. The gap is drift; a small number is evidence the chaining is arithmetically sound.
            </InfoDot>
          </Title>
          <Table variant="vertical" withTableBorder={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={200}>Chained</Table.Th>
                <Table.Td>{idx(t.chained_raw_level)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Direct fixed-base</Table.Th>
                <Table.Td>{idx(t.direct_fixed_base)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Drift</Table.Th>
                <Table.Td>
                  <Badge variant="light" color={Math.abs(t.drift_pct) < 1 ? 'teal' : 'orange'}>
                    {pct(t.drift_pct, 3)}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="md">{t.note}</Text>
        </Card>
      </SimpleGrid>

      {h.seasonal_context?.n_years > 0 && (
        <Paper>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            The one piece of evidence available now
            <InfoDot label="seasonal context">
              What MoSPI’s own airfare index did in this same calendar month in previous years, beside what APIx is doing now. Context, not a comparison: different years, different samples.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            MoSPI&rsquo;s own history for this calendar month, against what APIx is doing
          </Text>
          <Group gap="xl">
            {h.seasonal_context.observations.map((o) => (
              <div key={o.period}>
                <Text size="xs" c="dimmed">{o.period}</Text>
                <Text fw={600} c={o.pct < 0 ? 'red' : 'teal'}>{pct(o.pct)}</Text>
              </div>
            ))}
            <div>
              <Text size="xs" c="dimmed">APIx so far</Text>
              <Text fw={600} c="red">falling</Text>
            </div>
          </Group>
          <Text size="xs" c="dimmed" mt="md">{h.seasonal_context.caveat}</Text>
        </Paper>
      )}

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          Item match rate by day
          <InfoDot label="match rate">
            The share of yesterday’s priced flights found again today. The index compares a flight with itself, so an unmatched flight contributes no price change and its cell must be imputed.
          </InfoDot>
        </Title>
        {/* A 6-column table does not fit a phone. Scroll the table,
            not the page. */}
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Matched</Table.Th>
                <Table.Th ta="right">Previous day</Table.Th>
                <Table.Th ta="right">Match rate</Table.Th>
                <Table.Th ta="right">Cells imputed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(d.audit.churn ?? {}).map(([date, c]) => (
                <Table.Tr key={date}>
                  <Table.Td>{date}</Table.Td>
                  <Table.Td ta="right">{c.items_matched}</Table.Td>
                  <Table.Td ta="right">{c.items_prev}</Table.Td>
                  <Table.Td ta="right">
                    <Badge size="sm" variant="light" color="teal">
                      {(c.match_rate * 100).toFixed(1)}%
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">{c.cells_imputed}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
      </Paper>
    </Stack>
  );
}
