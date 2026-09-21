'use client';

import { Badge, Card, Group, List, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { IconCircleCheck } from '../compat/icons';
import { useValidation } from '../api';
import { idx, pct } from '../format';
import { pageHeader, queryState } from '../state';

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
        <Title order={2} mb={4}>MoSPI published Airfare index</Title>
        <Text size="xs" c="dimmed" mb="md">
          {d.mospi.source} · {d.mospi.frequency} · {d.mospi.base} · {d.mospi.n_points} points
          ({d.mospi.first} to {d.mospi.last})
        </Text>
        <LineChart
          h={280} data={mospi} dataKey="period" curveType="natural"
          series={[{ name: 'MoSPI', color: 'grape.6' }]}
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
          <Title order={2} mb={4}>Pass criteria, fixed in advance</Title>
          <Text size="xs" c="dimmed" mb="md">{h.criteria_note}</Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={880}>
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
          </Table.ScrollContainer>
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
            <Title order={2}>The harness proves its own arithmetic</Title>
          </Group>
          <Text size="xs" c="dimmed" mb="md">
            The metrics run on cases whose answers are known, every time. A harness that
            has never produced a correct answer on a checkable case is not evidence.
          </Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={880}>
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
          </Table.ScrollContainer>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Title order={2} mb="sm">When a real answer first exists</Title>
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
            <Title order={2}>What we can show instead</Title>
          </Group>
          <List size="sm" spacing="xs">
            {(d.overlap.what_we_can_show_instead ?? []).map((s) => (
              <List.Item key={s}>{s}</List.Item>
            ))}
          </List>
        </Card>

        <Card>
          <Title order={2} mb="sm">Transitivity audit</Title>
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
          <Title order={2} mb={4}>The one piece of evidence available now</Title>
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
        <Title order={2} p="lg" pb="sm">Item match rate by day</Title>
        {/* A 6-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={1060}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
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
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
