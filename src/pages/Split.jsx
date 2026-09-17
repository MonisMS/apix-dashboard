import {
  Alert, Badge, Card, Group, Paper, SimpleGrid, Stack, Table, Text, Title,
} from '../compat/mantine';
import { BarChart } from '../compat/mantine-charts';
import { IconCheck, IconInfoCircle, IconReceiptTax, IconX } from '../compat/icons';
import { useSplit } from '../api';
import { count, shortDate } from '../format';
import { pageHeader, queryState } from '../state';

/**
 * Base fare vs taxes — the money fields in PS deliverable (b).
 *
 * The page is built around the two things that are easy to get wrong here:
 * the split is a periodic study rather than the daily feed, and the "tax"
 * figure is the carrier's own taxes-and-fees line rather than a statutory
 * rate. Both are stated on the page, not buried in a footnote, because the
 * spread between carriers looks like an error until you know why it is there.
 */
export default function Split() {
  const q = useSplit();
  const state = queryState(q);
  if (state) return state;

  const d = q.data.split;

  if (!d.available) {
    return (
      <Stack gap="lg">
        {pageHeader('Base fare and taxes', 'PS deliverable (b): the four money fields')}
        <Alert variant="light" color="orange" icon={<IconInfoCircle size={18} aria-hidden="true" />}
               title="No split collected yet">
          <Text size="sm">{d.reason}</Text>
        </Alert>
      </Stack>
    );
  }

  const carrierChart = (d.by_carrier ?? []).map((c) => ({
    carrier: c.carrier,
    'Tax share': Number(c.tax_share_pct.toFixed(2)),
  }));

  const FIELDS = [
    ['base_fare', 'Base fare'],
    ['taxes', 'Taxes and airline fees'],
    ['udf', 'User Development Fee'],
    ['convenience_fee', 'Convenience fee'],
  ];

  return (
    <Stack gap="lg">
      {pageHeader(
        'Base fare and taxes',
        'PS deliverable (b) names four money fields. Two are observable; two are not.',
        [
          { label: `${count(d.observations)} split observations`, color: 'indigo' },
          { label: `${d.carriers_covered} carriers`, color: 'gray' },
          { label: `${d.routes_covered} of 12 routes`, color: 'gray' },
        ],
      )}

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} aria-hidden="true" />}
             title="This is a periodic study, not the daily feed">
        <Text size="sm">{d.why_not_daily}</Text>
        <Text size="sm" mt="xs">{d.why_not_backfilled}</Text>
      </Alert>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <Card>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Overall tax share</Text>
          <Text fw={700} fz={34} lh={1.15} mt={4}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
            {d.tax_share_pct_overall}%
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            of the all-in fare, across {count(d.observations)} observations
          </Text>
        </Card>
        <Card>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Study coverage</Text>
          <Text fw={700} fz={34} lh={1.15} mt={4}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
            {d.share_of_all_observations_pct}%
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            of all stored observations carry a split. The other {(100 - d.share_of_all_observations_pct).toFixed(1)}%
            keep NULL rather than a modelled figure.
          </Text>
        </Card>
        <Card>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Panel</Text>
          <Text fw={700} fz={34} lh={1.15} mt={4}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
            T+{(d.booking_window_days ?? []).join(', T+')}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {(d.study_days ?? []).map(shortDate).join(', ')} · source <b>{d.source}</b>
          </Text>
        </Card>
      </SimpleGrid>

      <Paper>
        <Title order={4} mb={4}>Tax share by carrier</Title>
        <Text size="xs" c="dimmed" mb="md">
          Akasa reports about 4% where IndiGo and Air India report about 24%, on the
          same routes on the same day. That is not an error and it is not a different
          tax regime — it is how each carrier splits the ticket in its own accounts.
          Normalising it would invent a statutory rate that does not exist, so the
          spread is published as it was observed.
        </Text>
        <BarChart
          h={260} data={carrierChart} dataKey="carrier"
          series={[{ name: 'Tax share', color: 'indigo.6' }]}
          withTooltip valueFormatter={(v) => `${v.toFixed(2)}%`}
          yAxisProps={{ width: 56 }}
        />
        {/* A 5-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={970}>
          <Table mt="md" striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Carrier</Table.Th>
                <Table.Th ta="right">Observations</Table.Th>
                <Table.Th ta="right">Mean tax share</Table.Th>
                <Table.Th ta="right">Range</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(d.by_carrier ?? []).map((c) => (
                <Table.Tr key={c.carrier}>
                  <Table.Td><Text size="sm" fw={600}>{c.carrier}</Text></Table.Td>
                  <Table.Td ta="right">{c.n}</Table.Td>
                  <Table.Td ta="right">
                    <Badge size="sm" variant="light"
                           color={c.tax_share_pct < 10 ? 'orange' : 'gray'}>
                      {c.tax_share_pct}%
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs" c="dimmed">{c.min_pct}% – {c.max_pct}%</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper p={0}>
        <Group gap="sm" p="lg" pb="sm">
          <IconReceiptTax size={20} aria-hidden="true" />
          <Title order={4}>What we can and cannot observe</Title>
        </Group>
        {/* A 4-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={880}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg" layout="fixed">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={240}>Field</Table.Th>
                <Table.Th w={140}>Observed</Table.Th>
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {FIELDS.map(([key, label]) => {
                const f = d.fields?.[key];
                if (!f) return null;
                return (
                  <Table.Tr key={key}>
                    <Table.Td><Text size="sm" fw={600}>{label}</Text></Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={f.observed ? 'teal' : 'gray'}
                             leftSection={f.observed ? <IconCheck size={12} aria-hidden="true" /> : <IconX size={12} aria-hidden="true" />}>
                        {f.observed ? 'Observed' : 'NULL'}
                      </Badge>
                    </Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{f.note}</Text></Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper p={0}>
          <Title order={4} p="lg" pb="sm">Tax share by route</Title>
          <Text size="xs" c="dimmed" px="lg" pb="sm">
            Route-level variation is mostly carrier mix: a route Akasa flies pulls the
            average down, not because the route is taxed differently.
          </Text>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Route</Table.Th>
                <Table.Th ta="right">n</Table.Th>
                <Table.Th ta="right">Mean</Table.Th>
                <Table.Th ta="right">Range</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(d.by_route ?? []).map((r) => (
                <Table.Tr key={r.route}>
                  <Table.Td><Text size="sm" fw={600}>{r.route}</Text></Table.Td>
                  <Table.Td ta="right">{r.n}</Table.Td>
                  <Table.Td ta="right">{r.tax_share_pct}%</Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs" c="dimmed">{r.min_pct}% – {r.max_pct}%</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
