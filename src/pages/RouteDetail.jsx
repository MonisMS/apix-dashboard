import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { AreaChart, BarChart } from '../compat/mantine-charts';
import { IconAlertTriangle } from '../compat/icons';
import { useParams } from 'react-router-dom';
import { useRoute } from '../api';
import { count, idx, pct, rupees, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

export default function RouteDetail() {
  const { pair } = useParams();
  const q = useRoute(pair);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const series = (d.points ?? []).map((p) => ({ date: shortDate(p.period_start), Index: p.level }));
  const leads = (d.by_lead_window ?? []).map((l) => ({
    window: `T+${l.lead_time_days}`,
    'Mean fare': l.mean_fare ?? 0,
  }));

  return (
    <Stack gap="lg">
      {pageHeader(
        d.pair,
        `${d.city_a.toLowerCase()} – ${d.city_b.toLowerCase()} · ${count(d.pax_cy)} passengers in CY2025`,
        [{ label: `${sharePct(d.weight_share)} of basket`, color: 'indigo' }],
      )}

      {!d.has_data && (
        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={18} aria-hidden="true" />}
               title="This route has not been collected">
          <Text size="sm">{d.availability.reason}</Text>
        </Alert>
      )}

      {d.has_data && (
        <>
          <Paper>
            <Title order={2} mb="md">Route index</Title>
            <AreaChart
              h={260} data={series} dataKey="date"
              series={[{ name: 'Index', color: 'indigo.6' }]}
              curveType="natural" withGradient fillOpacity={0.3} withDots
              yAxisProps={{ domain: ['dataMin - 3', 'dataMax + 3'] }}
              valueFormatter={(v) => v.toFixed(2)}
            />
            <Text size="xs" c="dimmed" mt="sm">
              Shares the headline's reference factor, so this level is directly comparable
              with the all-India index and with any other route.
            </Text>
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <Paper>
              <Title order={2} mb={4}>Mean fare by booking window</Title>
              <Text size="xs" c="dimmed" mb="md">The lead-time curve for this route</Text>
              <BarChart
                h={240} data={leads} dataKey="window"
                series={[{ name: 'Mean fare', color: 'cyan.6' }]}
                withTooltip valueFormatter={(v) => rupees(v)} yAxisProps={{ width: 64 }}
              />
            </Paper>

            <Paper p={0}>
              <Title order={2} p="lg" pb="sm">Carriers on this route</Title>
              {/* A 5-column table does not fit a phone. Scroll the table,
                  not the page. */}
              <Table.ScrollContainer minWidth={970}>
                <Table striped verticalSpacing="sm" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Carrier</Table.Th>
                      <Table.Th ta="right">Offers</Table.Th>
                      <Table.Th ta="right">Mean</Table.Th>
                      <Table.Th ta="right">Range</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(d.carriers ?? []).map((c) => (
                      <Table.Tr key={c.carrier}>
                        <Table.Td><Text size="sm" fw={600}>{c.carrier}</Text></Table.Td>
                        <Table.Td ta="right">{c.n_offers}</Table.Td>
                        <Table.Td ta="right">{rupees(c.mean_fare)}</Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs" c="dimmed">{rupees(c.min_fare)} – {rupees(c.max_fare)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </SimpleGrid>

          <Paper p={0}>
            <Title order={2} p="lg" pb="sm">Fare spread by collection day</Title>
            <Text size="xs" c="dimmed" px="lg" pb="sm">
              Descriptive statistics over observed offers. These are not the index.
            </Text>
            {/* A 7-column table does not fit a phone. Scroll the table,
                not the page. */}
            <Table.ScrollContainer minWidth={1150}>
              <Table striped verticalSpacing="sm" horizontalSpacing="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th ta="right">Offers</Table.Th>
                    <Table.Th ta="right">Min</Table.Th>
                    <Table.Th ta="right">Median</Table.Th>
                    <Table.Th ta="right">Mean</Table.Th>
                    <Table.Th ta="right">Max</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(d.fare_spread ?? []).map((s) => (
                    <Table.Tr key={s.date}>
                      <Table.Td>{shortDate(s.date)}</Table.Td>
                      <Table.Td ta="right">{s.n}</Table.Td>
                      <Table.Td ta="right">{rupees(s.min)}</Table.Td>
                      <Table.Td ta="right">{rupees(s.median)}</Table.Td>
                      <Table.Td ta="right">{rupees(s.mean)}</Table.Td>
                      <Table.Td ta="right">{rupees(s.max)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </>
      )}
    </Stack>
  );
}
