import { Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { DonutChart } from '../compat/mantine-charts';
import { useCarriers } from '../api';
import { idx, pct, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';
import { SERIES_COLORS } from '../chartTokens';
import { Note } from '../ui';

export default function Carriers() {
  const q = useCarriers();
  const state = queryState(q);
  if (state) return state;

  const rows = q.data.carriers ?? [];
  const donut = rows.map((c, i) => ({
    name: c.carrier,
    value: c.n_offers,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));

  return (
    <Stack gap="lg">
      {pageHeader('Carriers', 'The airline is part of the cell specification, so each carrier has its own index',
        [{ label: `${rows.length} observed`, color: 'gray' }])}

      <Note><Text size="sm">{q.data.note}</Text></Note>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb={4}>Share of observed offers</Title>
          <Text size="xs" c="dimmed" mb="md">Describes our sample, not the market</Text>
          <Group justify="center">
            <DonutChart size={200} thickness={26} data={donut} withTooltip
                        tooltipDataSource="segment" chartLabel={`${rows.length} carriers`} />
          </Group>
        </Paper>

        <Paper p={0}>
          <Title order={2} p="lg" pb="sm">Carrier indices</Title>
          {/* A 7-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={1150}>
            <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Carrier</Table.Th>
                  <Table.Th ta="right">Weight</Table.Th>
                  <Table.Th ta="right">Offers</Table.Th>
                  <Table.Th ta="right">Mean fare</Table.Th>
                  <Table.Th ta="right">Index</Table.Th>
                  <Table.Th ta="right">Day-on-day</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((c) => (
                  <Table.Tr key={c.carrier}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={600}>{c.carrier}</Text>
                        {!c.in_ps_named_five && (
                          <Badge size="xs" variant="light" color="gray">outside PS five</Badge>
                        )}
                        {c.n_cells < 10 && (
                          <Badge size="xs" variant="light" color="yellow">thin</Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">{sharePct(c.weight_share)}</Table.Td>
                    <Table.Td ta="right">{c.n_offers}</Table.Td>
                    <Table.Td ta="right">{rupees(c.mean_fare)}</Table.Td>
                    <Table.Td ta="right"><Text fw={600} size="sm">{idx(c.level)}</Text></Table.Td>
                    <Table.Td ta="right">
                      <Badge size="sm" variant="light" color={c.pct_change_1p >= 0 ? 'teal' : 'red'}>
                        {pct(c.pct_change_1p)}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
