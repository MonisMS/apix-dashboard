import { Anchor, Badge, Button, Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { IconReceipt2 } from '../compat/icons';
import { useState } from 'react';
import { useTariffs } from '../api';
import { rupees } from '../format';
import { pageHeader, queryState } from '../state';
import { Note } from '../ui';

export default function Tariffs() {
  const q = useTariffs();
  const [selected, setSelected] = useState(null);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const markets = d.markets ?? [];
  const pick = selected ?? markets.find((m) => m.min_levels?.length) ?? markets[0];

  const ladder = pick?.min_levels
    ? pick.min_levels.map((v, i) => ({
        level: `L${i + 1}`, Minimum: v, Maximum: pick.max_levels?.[i] ?? null,
      }))
    : [];

  return (
    <Stack gap="lg">
      {pageHeader('Published tariffs', 'Fare bands airlines publish under Rule 135 of the Aircraft Rules',
        [{ label: `${d.n_markets} markets`, color: 'gray' }])}

      <Note title="Published for the public, so no scraping question arises">
        <Text size="sm">{d.legal_basis}</Text>
        <Text size="sm" mt="xs" fw={600}>{d.caveat}</Text>
      </Note>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {Object.entries(d.sources ?? {}).map(([airline, src]) => (
          <Card key={airline}>
            <Group gap="sm" mb="xs">
              <IconReceipt2 size={20} aria-hidden="true" />
              <Title order={2}>{airline}</Title>
            </Group>
            <Text size="xs" c="dimmed">Found via {src.found_via}</Text>
            <Anchor href={src.url} target="_blank" rel="noopener noreferrer" size="xs" mt="xs"
                     style={{ wordBreak: 'break-all' }}>
              {src.url}
            </Anchor>
          </Card>
        ))}
      </SimpleGrid>

      {ladder.length > 0 && (
        <Paper>
          <Title order={2} mb={4}>
            Fare ladder — {pick.airline}, {pick.city_a} to {pick.city_b}
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            {pick.n_levels} published fare levels. Fuel charge (YQ) {rupees(pick.fuel_charge_yq)}.
          </Text>
          <LineChart
            h={280} data={ladder} dataKey="level" curveType="natural"
            series={[{ name: 'Minimum', color: 'teal.6' }, { name: 'Maximum', color: 'orange.6' }]}
            valueFormatter={(v) => rupees(v)} yAxisProps={{ width: 76 }}
          />
        </Paper>
      )}

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm">Markets</Title>
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Airline</Table.Th>
                <Table.Th>Market</Table.Th>
                <Table.Th ta="right">Stops</Table.Th>
                <Table.Th ta="right">Levels</Table.Th>
                <Table.Th ta="right">Lowest</Table.Th>
                <Table.Th ta="right">Highest</Table.Th>
                <Table.Th ta="right">YQ</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {markets.slice(0, 80).map((m, i) => (
                <Table.Tr
                  key={i}
                  onClick={() => setSelected(m)}
                  style={{ cursor: 'pointer' }}
                  bg={pick === m ? 'indigo.0' : undefined}
                >
                  <Table.Td>
                    <Badge size="sm" variant="light"
                           color={m.airline === 'Akasa Air' ? 'orange' : 'red'}>
                      {m.airline}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {/* A real button, not just a clickable row: the fare ladder has
                        to be reachable by keyboard, and a <tr> cannot be one. The
                        row click stays as a redundant affordance for the mouse. */}
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => setSelected(m)}
                      aria-label={`Show the fare ladder for ${m.airline}, ${m.city_a} to ${m.city_b}`}
                    >
                      {m.city_a} – {m.city_b}
                    </Button>
                  </Table.Td>
                  <Table.Td ta="right">{m.stops}</Table.Td>
                  <Table.Td ta="right">{m.n_levels}</Table.Td>
                  <Table.Td ta="right">{rupees(m.min_lowest)}</Table.Td>
                  <Table.Td ta="right">{rupees(m.max_highest)}</Table.Td>
                  <Table.Td ta="right">{rupees(m.fuel_charge_yq)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
