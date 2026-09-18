import { Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { DonutChart } from '../compat/mantine-charts';
import { IconScale } from '../compat/icons';
import { useWeights } from '../api';
import { count, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';
import { SERIES_COLORS } from '../chartTokens';
import { Note } from '../ui';

export default function Weights() {
  const q = useWeights();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const routes = d.provenance.route.routes ?? {};
  const entries = Object.entries(routes);
  const donut = entries.slice(0, 9).map(([pair, v], i) => ({
    name: pair, value: Number((v.weight * 100).toFixed(2)),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
  const cpi = d.cpi_context;

  return (
    <Stack gap="lg">
      {pageHeader('Basket & weights', d.provenance.route.method,
        [{ label: `${d.n_cells} cells`, color: 'gray' }, { label: `Σw = ${d.sum}`, color: 'teal' }])}

      <Note title="Expenditure shares, not passenger counts">
        <Text size="sm">{d.explanation.what_changed}</Text>
        <Text size="sm" mt="xs" fw={600}>{d.explanation.example}</Text>
        <Text size="xs" c="dimmed" mt="xs">{d.explanation.caveat}</Text>
      </Note>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb="md">Weight by route</Title>
          <Group justify="center">
            <DonutChart size={210} thickness={28} data={donut} withTooltip
                        tooltipDataSource="segment" chartLabel="basket"
                        valueFormatter={(v) => `${v}%`} />
          </Group>
        </Paper>

        <Card>
          <Group gap="sm" mb="sm">
            <IconScale size={20} aria-hidden="true" />
            <Title order={2}>Where airfare sits in the CPI</Title>
          </Group>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={880}>
            <Table variant="vertical" withTableBorder={false}>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th w={260}>Airfare item weight</Table.Th>
                  <Table.Td><Text fw={600}>{cpi.airfare_weight_pct}%</Text></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Group 07.3 passenger transport</Table.Th>
                  <Table.Td>{cpi.group_07_3_passenger_transport_services_pct}%</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Division 07 Transport</Table.Th>
                  <Table.Td>{cpi.division_07_transport_pct}%</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Division 08 Info & communication</Table.Th>
                  <Table.Td>{cpi.division_08_information_and_communication_pct}%</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mt="md">{cpi.note}</Text>
          <Text size="xs" c="dimmed" mt="xs">{cpi.largest_contributor_note}</Text>
        </Card>
      </SimpleGrid>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm">Route weights</Title>
        <Table.ScrollContainer minWidth={720}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Route</Table.Th>
                <Table.Th ta="right">DGCA passengers</Table.Th>
                <Table.Th ta="right">Mean fare (base)</Table.Th>
                <Table.Th ta="right">Weight</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map(([pair, v]) => (
                <Table.Tr key={pair}>
                  <Table.Td><Text size="sm" fw={600}>{pair}</Text></Table.Td>
                  <Table.Td ta="right">{count(v.pax_cy)}</Table.Td>
                  <Table.Td ta="right">{rupees(v.mean_fare_base)}</Table.Td>
                  <Table.Td ta="right"><Text fw={600} size="sm">{sharePct(v.weight)}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper>
        <Title order={2} mb="sm">Lead-time weights</Title>
        <Text size="sm" c="dimmed">{d.provenance.lead.method}</Text>
        <Group mt="md" gap="xs">
          {Object.entries(d.provenance.lead.weights).map(([lead, w]) => (
            <Card key={lead} p="sm" withBorder>
              <Text size="xs" c="dimmed">T+{lead}</Text>
              <Text fw={600}>{sharePct(w, 0)}</Text>
            </Card>
          ))}
        </Group>
      </Paper>
    </Stack>
  );
}
