'use client';

import { Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { IconScale } from '../compat/icons';
import { useWeights } from '../api';
import { count, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';
import { Note } from '../ui';

export default function Weights() {
  const q = useWeights();
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const routes = d.provenance.route.routes ?? {};
  const entries = Object.entries(routes);
  const ordered = [...entries].sort((a, b) => b[1].weight - a[1].weight);
  const shade = (i) =>
    `color-mix(in oklab, var(--chart-2) ${Math.round(92 - (i / Math.max(ordered.length - 1, 1)) * 62)}%, var(--card))`;
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
        <Paper data-tour="route-weights">
          <Title order={2} mb="md" className="flex items-center gap-1.5">
            Weight by route
            <InfoDot label="this bar">
              The whole basket as one bar. Each segment is a route, widest first, and the
              widths add to 100%. It shows at a glance how concentrated the index is: how much
              of it rests on the largest few routes.
            </InfoDot>
          </Title>
          <div className="flex h-9 w-full gap-[2px] overflow-hidden">
            {ordered.map(([pair, v], i) => (
              <div
                key={pair}
                className="group relative flex items-center justify-center"
                style={{ width: `${v.weight * 100}%`, background: shade(i) }}
                title={`${pair} — ${sharePct(v.weight)} of the basket`}
              >
                {/* Hidden below sm: at phone width these wrapped to two lines
                    inside the segment. The key underneath names every route. */}
                {v.weight > 0.075 && (
                  <span className="hidden whitespace-nowrap px-1 text-[10px] font-medium text-foreground/90 sm:inline">
                    {pair}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {ordered.map(([pair, v], i) => (
              <span key={pair} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="inline-block h-2.5 w-2.5 shrink-0 border border-border"
                      style={{ background: shade(i) }} aria-hidden="true" />
                {pair} <span className="tabular">{sharePct(v.weight, 1)}</span>
              </span>
            ))}
          </div>
          <ColorKey
            className="mt-3"
            items={[{ color: 'var(--chart-2)', label: 'Share of the basket, darkest is largest' }]}
            note={`All ${ordered.length} routes shown; the widths sum to \u03a3w = ${d.sum}.`}
          />
        </Paper>

        <Card>
          <Group gap="sm" mb="sm">
            <IconScale size={20} aria-hidden="true" />
            <Title order={2} className="flex items-center gap-1.5">
              Where airfare sits in the CPI
              <InfoDot label="the CPI context">
                How much of the official Consumer Price Index the airfare item accounts for, and
                the groups it nests inside. It is the reason a large airfare move barely shifts
                headline inflation.
              </InfoDot>
            </Title>
          </Group>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
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
          <Text size="xs" c="dimmed" mt="md">{cpi.note}</Text>
          <Text size="xs" c="dimmed" mt="xs">{cpi.largest_contributor_note}</Text>
        </Card>
      </SimpleGrid>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          Route weights
          <InfoDot label="how a weight is derived">
            Passengers carried on the route (DGCA, CY2025) multiplied by its mean base fare,
            normalised so every route&rsquo;s share sums to 1. Expenditure, not passenger count.
          </InfoDot>
        </Title>
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
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
      </Paper>

      <Paper>
        <Title order={2} mb="sm" className="flex items-center gap-1.5">
          Lead-time weights
          <InfoDot label="lead-time weights">
            Each advance-purchase window carries an equal share of the headline. That is a
            declared assumption, not a measured booking-lag distribution — the real mix of when
            tickets are bought is not published.
          </InfoDot>
        </Title>
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
