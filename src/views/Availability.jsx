'use client';

import { Badge, Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart } from '../compat/mantine-charts';
import { IconAlertTriangle } from '../compat/icons';
import { useAvailability } from '../api';
import { pct, rupees, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';

export default function Availability() {
  const q = useAvailability();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const dis = d.disappearance;
  const bound = d.bias_bound;

  const chart = (dis.transitions ?? []).map((t) => ({
    day: shortDate(t.to),
    'Log difference %': t.price_differential_pct,
    'Arithmetic mean %': t.arithmetic_mean_differential_pct,
  }));

  const worst = bound.per_day?.[0]?.index_bias_pp ?? {};

  return (
    <Stack gap="lg">
      {pageHeader('Availability', 'Flights that stop appearing, and what we cannot tell about why', [
        { label: `${(dis.mean_vanish_rate * 100).toFixed(1)}% vanish daily`, color: 'orange' },
      ])}

      <Paper>
        <Title order={2} mb={4} className="flex items-center gap-1.5">
          Were the flights that vanished priced differently?
          <InfoDot label="this chart">
            A vanished flight is one priced on a day and absent the next. We cannot see why:
            a sell-out and a truncated result list look identical from outside. This only
            compares what they cost against the flights that stayed.
          </InfoDot>
        </Title>
        <Text size="xs" c="dimmed" mb="md">
          The log difference is the headline because it is the quantity the significance
          test operates on. The arithmetic mean is shown beside it and can disagree
          sharply when a few very high fares drag it.
        </Text>
        <BarChart
          h={240} data={chart} dataKey="day"
          series={[
            { name: 'Log difference %', color: 'var(--chart-2)' },
            { name: 'Arithmetic mean %', color: 'var(--warning)' },
          ]}
          withTooltip valueFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
          yAxisProps={{ width: 52 }}
        />
        <ColorKey
          className="mt-3"
          items={[
            { color: 'var(--chart-2)', label: 'Log difference — the figure the significance test uses' },
            { color: 'var(--warning)', label: 'Arithmetic mean — pulled by a few very high fares' },
          ]}
          note="Above zero, the flights that vanished were dearer than those that stayed."
        />
      </Paper>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          By transition
          <InfoDot label="this table">
            One row per pair of consecutive collection days. &ldquo;Chance?&rdquo; is Welch&rsquo;s
            t-test on log fares at the 5% level — &ldquo;unlikely&rdquo; means a gap that big would
            rarely appear if vanishing were unrelated to price. It says nothing about the cause.
          </InfoDot>
        </Title>
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Day</Table.Th>
                <Table.Th ta="right">Vanished</Table.Th>
                <Table.Th ta="right">Rate</Table.Th>
                <Table.Th ta="right">Median vanished</Table.Th>
                <Table.Th ta="right">Median survived</Table.Th>
                <Table.Th ta="right">Log diff</Table.Th>
                <Table.Th ta="right">Chance?</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(dis.transitions ?? []).map((t) => (
                <Table.Tr key={t.to}>
                  <Table.Td>{shortDate(t.from)} → {shortDate(t.to)}</Table.Td>
                  <Table.Td ta="right">{t.n_vanished}</Table.Td>
                  <Table.Td ta="right">{sharePct(t.vanish_rate, 1)}</Table.Td>
                  <Table.Td ta="right">{rupees(t.median_fare_vanished)}</Table.Td>
                  <Table.Td ta="right">{rupees(t.median_fare_survived)}</Table.Td>
                  <Table.Td ta="right">
                    <Text fw={600} size="sm"
                          c={t.price_differential_pct > 0 ? 'teal' : 'red'}>
                      {pct(t.price_differential_pct)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Badge size="sm" variant="light"
                           color={t.test.significant_5pct ? 'orange' : 'gray'}>
                      {t.test.significant_5pct ? 'unlikely' : 'likely chance'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Group gap="sm" mb="sm">
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
            <Title order={2} className="flex items-center gap-1.5">
              What the data says
              <InfoDot label="this reading">
                Summarises every transition above. &ldquo;Direction consistent&rdquo; means the
                vanished flights were reliably cheaper (or reliably dearer) each time; when it is
                not consistent, there is no stable pattern to correct for.
              </InfoDot>
            </Title>
          </Group>
          <Text size="sm">{dis.reading}</Text>
          <Badge mt="md" variant="light"
                 color={dis.direction_consistent ? 'orange' : 'gray'}>
            direction {dis.direction_consistent ? 'consistent' : 'not consistent'}
          </Badge>
        </Card>

        <Card>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            How big is the unknown?
            <InfoDot label="this table">
              A what-if, not a finding. Read a row as: if the vanished flights would have moved
              this much differently from the ones that stayed, the published index would be off
              by this many points. We do not claim any of these values is the real one.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            If the vanished flights would have moved differently from the ones that
            stayed, the index is off by roughly their weight times that difference.
          </Text>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>If they moved this much differently</Table.Th>
                <Table.Th ta="right">Index would be off by</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(worst).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Td>{k}</Table.Td>
                  <Table.Td ta="right">
                    <Text fw={600} size="sm">{v.toFixed(3)} pts</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="md">{bound.interpretation}</Text>
          <Text size="xs" c="dimmed" mt="xs" fw={600}>{bound.note}</Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
