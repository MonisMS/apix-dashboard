import { Alert, Badge, Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart } from '../compat/mantine-charts';
import { IconAlertTriangle, IconEyeOff } from '../compat/icons';
import { useAvailability } from '../api';
import { count, pct, rupees, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

export default function Availability() {
  const q = useAvailability();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const dis = d.disappearance;
  const bound = d.bias_bound;
  const obs = d.observed_availability;

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

      <Alert variant="light" color="red" icon={<IconEyeOff size={18} aria-hidden="true" />}
             title="We do not detect sold-out flights">
        <Text size="sm">{obs.statement}</Text>
        <Group gap="xs" mt="sm">
          <Badge variant="light" color="red">
            {count(obs.n_with_observed_availability)} of {count(obs.n_observations)} rows observed
          </Badge>
          <Badge variant="light" color="gray">
            seats_left on {count(obs.n_with_seats_left)} rows
          </Badge>
        </Group>
      </Alert>

      <Paper>
        <Title order={2} mb={4}>Were the flights that vanished priced differently?</Title>
        <Text size="xs" c="dimmed" mb="md">
          The log difference is the headline because it is the quantity the significance
          test operates on. The arithmetic mean is shown beside it and can disagree
          sharply when a few very high fares drag it.
        </Text>
        <BarChart
          h={240} data={chart} dataKey="day"
          series={[
            { name: 'Log difference %', color: 'indigo.6' },
            { name: 'Arithmetic mean %', color: 'gray.5' },
          ]}
          withTooltip valueFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
          yAxisProps={{ width: 52 }}
        />
      </Paper>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm">By transition</Title>
        <Table.ScrollContainer minWidth={860}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
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
                    <Text fw={700} size="sm"
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
        </Table.ScrollContainer>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Group gap="sm" mb="sm">
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
            <Title order={2}>What the data says</Title>
          </Group>
          <Text size="sm">{dis.reading}</Text>
          <Badge mt="md" variant="light"
                 color={dis.direction_consistent ? 'orange' : 'gray'}>
            direction {dis.direction_consistent ? 'consistent' : 'not consistent'}
          </Badge>
        </Card>

        <Card>
          <Title order={2} mb={4}>How big is the unknown?</Title>
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
                    <Text fw={700} size="sm">{v.toFixed(3)} pts</Text>
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
