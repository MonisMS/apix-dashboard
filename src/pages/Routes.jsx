import { Alert, Badge, Group, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { BarChart } from '../compat/mantine-charts';
import { IconInfoCircle } from '../compat/icons';
import { Link } from 'react-router-dom';
import { useRoutes } from '../api';
import { count, idx, pct, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';

export default function Routes() {
  const q = useRoutes();
  const state = queryState(q);
  if (state) return state;

  const rows = q.data.routes ?? [];
  const cov = q.data.coverage;
  const withData = rows.filter((r) => r.has_data);

  const weightChart = withData.map((r) => ({
    route: r.pair,
    'Basket weight %': Number((r.weight * 100).toFixed(2)),
  }));

  return (
    <Stack gap="lg">
      {pageHeader('Routes', 'Every route in the DGCA-derived basket, including those not yet collected', [
        { label: `${withData.length} of ${rows.length} with fares`, color: 'gray' },
      ])}

      {cov.routes_without_fares.length > 0 && (
        <Alert variant="light" color="orange" icon={<IconInfoCircle size={18} aria-hidden="true" />}
               title={`${cov.routes_without_fares.length} basket routes have no fares yet`}>
          <Text size="sm">
            {cov.routes_without_fares.join(', ')} are in the basket but the collector has
            not swept them. They carry zero weight and are shown below rather than hidden —
            a coverage gap you cannot see is one nobody fixes.
          </Text>
        </Alert>
      )}

      <Paper>
        <Title order={2} mb="md">Basket weight by route</Title>
        <BarChart
          h={280} data={weightChart} dataKey="route"
          series={[{ name: 'Basket weight %', color: 'indigo.6' }]}
          withTooltip valueFormatter={(v) => `${v}%`}
          xAxisProps={{ angle: -35, textAnchor: 'end', height: 62 }}
        />
      </Paper>

      <Paper p={0}>
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Route</Table.Th>
                <Table.Th>Cities</Table.Th>
                <Table.Th ta="right">DGCA pax (CY2025)</Table.Th>
                <Table.Th ta="right">Weight</Table.Th>
                <Table.Th ta="right">Mean fare</Table.Th>
                <Table.Th ta="right">Index</Table.Th>
                <Table.Th ta="right">Day-on-day</Table.Th>
                <Table.Th ta="right">Cells</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.pair}>
                  <Table.Td>
                    {/* nowrap: an identifier, not prose. "BLR-DEL" was breaking
                        after the hyphen and reading as two rows. */}
                    {r.has_data ? (
                      <Text component={Link} to={`/routes/${r.pair}`} fw={600} size="sm"
                            c="indigo" style={{ whiteSpace: 'nowrap' }} translate="no">
                        {r.pair}
                      </Text>
                    ) : (
                      <Text fw={600} size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}
                            translate="no">{r.pair}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" tt="capitalize">
                      {r.city_a.toLowerCase()} – {r.city_b.toLowerCase()}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{count(r.pax_cy)}</Table.Td>
                  <Table.Td ta="right">{r.has_data ? sharePct(r.weight) : '—'}</Table.Td>
                  <Table.Td ta="right">{rupees(r.mean_fare_latest)}</Table.Td>
                  <Table.Td ta="right"><Text fw={700} size="sm">{idx(r.level)}</Text></Table.Td>
                  <Table.Td ta="right">
                    {r.has_data ? (
                      <Badge size="sm" variant="light" color={r.pct_change_1p >= 0 ? 'teal' : 'red'}>
                        {pct(r.pct_change_1p)}
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="light" color="gray">not collected</Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{r.n_cells}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
