import { Alert, Badge, Group, Paper, Stack, Table, Tabs, Text, Title, Tooltip } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { IconInfoCircle } from '../compat/icons';
import { useAudit, useIndex } from '../api';
import { count, idx, pct, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

export default function IndexDetail() {
  // No URL sync for the tab, deliberately. Daily is the only enabled value, so
  // a `?tab=` param would encode a choice nobody can make. Add it when Weekly
  // and Monthly actually exist.
  const q = useIndex();
  const audit = useAudit();
  const state = queryState(q, audit);
  if (state) return state;

  const points = q.data.points ?? [];
  const cov = q.data.coverage;
  const chart = points.map((p) => ({ date: shortDate(p.period_start), APIx: p.level }));

  const pending = cov.frequencies_pending ?? {};

  return (
    <Stack gap="lg">
      {pageHeader('Index detail', q.data.reference?.label,
        [{ label: `${points.length} points`, color: 'gray' }])}

      <Tabs defaultValue="D">
        <Tabs.List mb="lg">
          <Tabs.Tab value="D">Daily</Tabs.Tab>
          {/* A disabled control fires no pointer events, so a Tooltip wrapped
              straight round it never opens -- the reason the tab is off was
              unreachable. `data-disabled` styles it as disabled while leaving
              it focusable and hoverable, so the explanation is available to a
              mouse and to the keyboard. */}
          <Tooltip label={pending.W} withArrow events={{ hover: true, focus: true, touch: true }}>
            <Tabs.Tab value="W" data-disabled onClick={(e) => e.preventDefault()}>
              Weekly
            </Tabs.Tab>
          </Tooltip>
          <Tooltip label={pending.M} withArrow events={{ hover: true, focus: true, touch: true }}>
            <Tabs.Tab value="M" data-disabled onClick={(e) => e.preventDefault()}>
              Monthly
            </Tabs.Tab>
          </Tooltip>
        </Tabs.List>

        <Tabs.Panel value="D">
          <Stack gap="lg">
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} aria-hidden="true" />}>
              <Text size="sm">
                Weekly and monthly are disabled rather than approximated. Averaging three
                days and labelling it &ldquo;weekly&rdquo; would be a different estimator wearing
                the same name.
              </Text>
            </Alert>

            <Paper>
              <Title order={4} mb="md">Daily series</Title>
              <LineChart
                h={320} data={chart} dataKey="date" curveType="natural" withDots
                series={[{ name: 'APIx', color: 'indigo.6' }]}
                referenceLines={[{ y: 100, label: 'reference = 100', color: 'gray.5' }]}
                yAxisProps={{ domain: ['dataMin - 3', 'dataMax + 3'] }}
                valueFormatter={(v) => v.toFixed(2)}
              />
            </Paper>

            <Paper p={0}>
              <Title order={4} p="lg" pb="sm">Every published point</Title>
              <Table.ScrollContainer minWidth={980}>
                <Table striped verticalSpacing="sm" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th ta="right">Level</Table.Th>
                      <Table.Th ta="right">Link</Table.Th>
                      <Table.Th ta="right">Cells</Table.Th>
                      <Table.Th ta="right">Imputed</Table.Th>
                      <Table.Th ta="right">Thin</Table.Th>
                      <Table.Th ta="right">Matched / prev</Table.Th>
                      <Table.Th ta="right">Imputed weight</Table.Th>
                      <Table.Th>Flags</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {points.map((p) => (
                      <Table.Tr key={p.period_start}>
                        <Table.Td>{p.period_start}</Table.Td>
                        <Table.Td ta="right"><Text fw={700} size="sm">{idx(p.level)}</Text></Table.Td>
                        <Table.Td ta="right">{p.link ? p.link.toFixed(6) : '—'}</Table.Td>
                        <Table.Td ta="right">{count(p.n_cells)}</Table.Td>
                        <Table.Td ta="right">{p.n_cells_imputed}</Table.Td>
                        <Table.Td ta="right">{p.n_cells_thin}</Table.Td>
                        <Table.Td ta="right">
                          {p.n_items_prev ? `${p.n_items_matched} / ${p.n_items_prev}` : '—'}
                        </Table.Td>
                        <Table.Td ta="right">{sharePct(p.weight_imputed, 2)}</Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {(p.quality ?? []).map((f) => (
                              <Badge key={f} size="xs" variant="light"
                                     color={f === 'ANCHOR' ? 'gray' : 'orange'}>
                                {f.toLowerCase().replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>

            <Paper>
              <Title order={4} mb="sm">Transitivity audit</Title>
              <Group gap="xl">
                <div>
                  <Text size="xs" c="dimmed">Chained</Text>
                  <Text fw={700}>{idx(audit.data.transitivity.chained_raw_level)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Direct fixed-base</Text>
                  <Text fw={700}>{idx(audit.data.transitivity.direct_fixed_base)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Drift</Text>
                  <Text fw={700}>{pct(audit.data.transitivity.drift_pct, 3)}</Text>
                </div>
              </Group>
              <Text size="xs" c="dimmed" mt="md">{audit.data.transitivity.note}</Text>
            </Paper>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
