import { Badge, Card, Code, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart } from '../compat/mantine-charts';
import { IconFilter } from '../compat/icons';
import { useCleaning } from '../api';
import { idx, pct, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

const LABEL = {
  none: 'No screening',
  hard_bound_only: 'Hard bound only (shipped)',
  hard_bound_and_mad: 'Hard bound + MAD',
};

export default function Cleaning() {
  const q = useCleaning();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const sens = d.sensitivity ?? {};
  const chart = Object.entries(sens)
    .filter(([, v]) => v.final_raw_level)
    .map(([k, v]) => ({
      regime: LABEL[k] ?? k,
      'Index level': Number(v.final_raw_level.toFixed(3)),
    }));

  return (
    <Stack gap="lg">
      {pageHeader('Cleaning', 'Outlier screening on day-on-day movements, not on price levels', [
        { label: `${d.n_flags} flagged`, color: d.n_flags ? 'orange' : 'gray' },
      ])}

      <Paper>
        <Title order={2} mb={4}>What each screening rule does to the published number</Title>
        <Text size="xs" c="dimmed" mb="md">
          Choosing a screening rule without showing its effect is how a cleaning step
          quietly becomes an editorial one.
        </Text>
        <BarChart
          h={240} data={chart} dataKey="regime"
          series={[{ name: 'Index level', color: 'indigo.6' }]}
          withTooltip valueFormatter={(v) => v.toFixed(3)}
          yAxisProps={{ domain: ['dataMin - 2', 'dataMax + 2'], width: 56 }}
        />
        {/* A 5-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={970}>
          <Table mt="md" striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Regime</Table.Th>
                <Table.Th ta="right">Flights screened</Table.Th>
                <Table.Th ta="right">Final level</Table.Th>
                <Table.Th ta="right">Difference</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(sens).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>{LABEL[k] ?? k}</Text>
                      {k === 'hard_bound_only' && (
                        <Badge size="xs" variant="light" color="teal">shipped</Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{v.n_screened}</Table.Td>
                  <Table.Td ta="right">{idx(v.final_raw_level)}</Table.Td>
                  <Table.Td ta="right">
                    <Badge size="sm" variant="light"
                           color={Math.abs(v.diff_from_unscreened_pct ?? 0) > 1 ? 'red' : 'gray'}>
                      {pct(v.diff_from_unscreened_pct, 3)}
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
            <IconFilter size={20} aria-hidden="true" />
            <Title order={2}>The rules</Title>
          </Group>
          <Text size="sm" fw={600}>Hard bound — on</Text>
          <Text size="sm" c="dimmed">{d.hard_bound.description}</Text>
          <Code block mt="xs">{`|ln(p_t / p_t-1)| > ln(${d.hard_bound.threshold_ratio})`}</Code>
          <Text size="sm" fw={600} mt="md">Median / MAD — off</Text>
          <Text size="sm" c="dimmed">
            k = {d.mad.k}, minimum pool {d.mad.min_pool}, pooled {d.mad.pools}.
          </Text>
          <Text size="xs" c="dimmed" mt="md">{d.treatment}</Text>
        </Card>

        <Paper p={0}>
          <Title order={2} p="lg" pb="sm">By collection day</Title>
          {/* A 6-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={1060}>
            <Table striped verticalSpacing="sm" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th ta="right">Matched moves</Table.Th>
                  <Table.Th ta="right">Hard bound</Table.Th>
                  <Table.Th ta="right">MAD</Table.Th>
                  <Table.Th ta="right">Share</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(d.per_day ?? {}).map(([date, v]) => (
                  <Table.Tr key={date}>
                    <Table.Td>{shortDate(date)}</Table.Td>
                    <Table.Td ta="right">{v.n_relatives}</Table.Td>
                    <Table.Td ta="right">{v.n_extreme}</Table.Td>
                    <Table.Td ta="right">{v.n_mad}</Table.Td>
                    <Table.Td ta="right">{sharePct(v.share_screened, 3)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </SimpleGrid>

      {d.flags?.length > 0 && (
        <Paper p={0}>
          <Title order={2} p="lg" pb="sm">Flagged observations</Title>
          <Text size="xs" c="dimmed" px="lg" pb="sm">
            Quarantined from the matched sample. Still in the database, never deleted.
          </Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
          <Table.ScrollContainer minWidth={880}>
            <Table striped verticalSpacing="sm" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Observation</Table.Th>
                  <Table.Th>Flag</Table.Th>
                  <Table.Th>Detail</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.flags.map((f, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Code>{f.observation_id}</Code></Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color="orange">{f.flag}</Badge>
                    </Table.Td>
                    <Table.Td><Text size="xs">{f.detail}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}
