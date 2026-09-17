import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart, LineChart } from '../compat/mantine-charts';
import { IconInfoCircle } from '../compat/icons';
import { useWindows } from '../api';
import { idx, rupees, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { SERIES_COLORS } from '../chartTokens';

export default function Windows() {
  const q = useWindows();
  const state = queryState(q);
  if (state) return state;

  const windows = q.data.windows ?? [];
  const dates = windows[0]?.points?.map((p) => p.period_start) ?? [];

  // One row per date, one column per window: five separate records, as asked.
  const chart = dates.map((date, i) => {
    const row = { date: shortDate(date) };
    windows.forEach((w) => { row[`T+${w.lead_time_days}`] = w.points[i]?.level; });
    return row;
  });

  const elasticity = windows.map((w) => ({
    window: `T+${w.lead_time_days}`,
    'Mean fare': w.mean_fare ?? 0,
  }));

  return (
    <Stack gap="lg">
      {pageHeader('Booking windows',
        'Each advance-purchase window published separately, and blended into the headline',
        [{ label: `${windows.length} windows`, color: 'gray' }])}

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} aria-hidden="true" />} title="Why five windows and not one">
        <Text size="sm">{q.data.mospi_note}</Text>
        <Text size="sm" mt="xs">{q.data.weighting_note}</Text>
      </Alert>

      <Paper>
        <Title order={2} mb={4}>Index by advance-purchase window</Title>
        <Text size="xs" c="dimmed" mb="md">
          All five share the headline's reference, so they are directly comparable
        </Text>
        <LineChart
          h={320} data={chart} dataKey="date" curveType="natural" withDots
          series={windows.map((w, i) => ({
            name: `T+${w.lead_time_days}`,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
          }))}
          yAxisProps={{ domain: ['dataMin - 3', 'dataMax + 3'] }}
          valueFormatter={(v) => v.toFixed(2)}
        />
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb={4}>Lead-time curve</Title>
          <Text size="xs" c="dimmed" mb="md">Mean observed fare by how far ahead the seat was priced</Text>
          <BarChart
            h={260} data={elasticity} dataKey="window"
            series={[{ name: 'Mean fare', color: 'teal.6' }]}
            withTooltip valueFormatter={(v) => rupees(v)} yAxisProps={{ width: 64 }}
          />
        </Paper>

        <Paper p={0}>
          <Title order={2} p="lg" pb="sm">Windows</Title>
          {/* A 6-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={1060}>
            <Table striped verticalSpacing="sm" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Window</Table.Th>
                  <Table.Th ta="right">Weight</Table.Th>
                  <Table.Th ta="right">Offers</Table.Th>
                  <Table.Th ta="right">Mean fare</Table.Th>
                  <Table.Th ta="right">Index</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {windows.map((w) => (
                  <Table.Tr key={w.lead_time_days}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={600}>T+{w.lead_time_days}</Text>
                        {w.brackets_mospi_spec && (
                          <Badge size="xs" variant="light" color="indigo">
                            brackets MoSPI 21d
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">{sharePct(w.weight_in_headline, 0)}</Table.Td>
                    <Table.Td ta="right">{w.n_offers}</Table.Td>
                    <Table.Td ta="right">{rupees(w.mean_fare)}</Table.Td>
                    <Table.Td ta="right">
                      <Text fw={700} size="sm">
                        {idx(w.points[w.points.length - 1]?.level)}
                      </Text>
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
