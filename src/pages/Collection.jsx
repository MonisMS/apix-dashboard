import { Alert, Badge, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { IconAlertTriangle } from '../compat/icons';
import { useCollection, useRunLog } from '../api';
import { count, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

export default function Collection() {
  const q = useCollection();
  const runs = useRunLog();
  const state = queryState(q, runs);
  if (state) return state;

  const d = q.data;
  const s = d.summary;

  return (
    <Stack gap="lg">
      {pageHeader('Collection', 'What we tried to collect, what we got, and what that costs the index',
        [{ label: `${s.days} days`, color: 'gray' }, { label: `${count(s.observations)} observations`, color: 'gray' }])}

      {d.routes.never_attempted.length > 0 && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} aria-hidden="true" />}
               title={`${d.routes.never_attempted.length} basket routes were never attempted`}>
          <Text size="sm">
            {d.routes.never_attempted.join(', ')}. These are a coverage gap we chose, not a
            failed collection — the collector has no run row for them at all.
          </Text>
        </Alert>
      )}

      <div className="lc-stats">
        {[
          ['Observations', count(s.observations)],
          ['Used by the index', count(s.rows_selected)],
          ['Sweeps', count(s.sweeps)],
          ['Basket pax covered', `${d.routes.basket_pax_covered_pct}%`],
        ].map(([label, value]) => (
          <div className="lc-stat" key={label}>
            <span className="k">{label}</span>
            <span className="v">{value}</span>
          </div>
        ))}
      </div>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm">By collection day</Title>
        {/* A 8-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={1240}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Observations</Table.Th>
                <Table.Th ta="right">Cells</Table.Th>
                <Table.Th ta="right">Sweeps</Table.Th>
                <Table.Th ta="right">Attempts</Table.Th>
                <Table.Th ta="right">Failed</Table.Th>
                <Table.Th ta="right">Collection slot</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.days.map((day) => (
                <Table.Tr key={day.date}>
                  <Table.Td>{shortDate(day.date)}</Table.Td>
                  <Table.Td ta="right">{count(day.n_observations)}</Table.Td>
                  <Table.Td ta="right">{day.n_cells}</Table.Td>
                  <Table.Td ta="right">{day.n_runs}</Table.Td>
                  <Table.Td ta="right">{day.attempts}</Table.Td>
                  <Table.Td ta="right">
                    {day.failed ? <Badge size="sm" color="red" variant="light">{day.failed}</Badge> : '0'}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{day.nominal_time_ist} IST</Text>
                    <Text size="xs" c="dimmed">
                      actual {day.actual_ist.first}–{day.actual_ist.last}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper>
        <Title order={2} mb="sm">Sweep selection</Title>
        <Text size="sm" c="dimmed">{d.sweep_selection.rule}</Text>
        <Text size="sm" c="dimmed" mt="xs">{d.sweep_selection.genuineness_screen}</Text>
      </Paper>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm">Recent fetches</Title>
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing="xs" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Started</Table.Th>
                <Table.Th>Route</Table.Th>
                <Table.Th ta="right">Window</Table.Th>
                <Table.Th ta="right">Quotes</Table.Th>
                <Table.Th ta="right">Elapsed</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(runs.data.runs ?? []).slice(0, 40).map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td><Text size="xs" c="dimmed">{r.started_at.slice(0, 19)}</Text></Table.Td>
                  <Table.Td><Text size="sm" fw={600}>{r.route}</Text></Table.Td>
                  <Table.Td ta="right">T+{r.lead_time_days}</Table.Td>
                  <Table.Td ta="right">{r.n_quotes}</Table.Td>
                  <Table.Td ta="right">{(r.elapsed_ms / 1000).toFixed(1)}s</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={r.status === 'OK' ? 'teal' : 'red'}>
                      {r.status}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
