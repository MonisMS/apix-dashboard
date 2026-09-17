import { Alert, Badge, Card, Code, Group, List, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { IconAlertTriangle, IconCircleCheck } from '../compat/icons';
import { useMethodology } from '../api';
import { pageHeader, queryState } from '../state';

export default function Methodology() {
  const q = useMethodology();
  const state = queryState(q);
  if (state) return state;

  const m = q.data.methodology;
  const f = m.formulas;

  return (
    <Stack gap="lg">
      {pageHeader('Methodology', 'Two formulas, two levels — and why they are not in conflict')}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Badge variant="light" color="indigo" mb="sm">Elementary level</Badge>
          <Title order={2} mb="xs">Jevons — geometric</Title>
          <Code block>{f.elementary}</Code>
          <Text size="xs" c="dimmed" mt="sm">{f.elementary_source}</Text>
          <Text size="sm" mt="md">
            Inside a cell there are no weights, so the unweighted geometric mean of matched
            price relatives is the right average. It treats a doubling and a halving as
            equal and opposite.
          </Text>
        </Card>

        <Card>
          <Badge variant="light" color="teal" mb="sm">Higher level</Badge>
          <Title order={2} mb="xs">Young — arithmetic</Title>
          <Code block>{f.higher_level}</Code>
          <Text size="xs" c="dimmed" mt="sm">{f.higher_level_source}</Text>
          <Text size="sm" mt="md">
            Combining cells, weights exist, and the index is a weighted arithmetic mean of
            index levels. Geometric at the bottom, arithmetic at the top.
          </Text>
        </Card>
      </SimpleGrid>

      <Paper>
        <Title order={2} mb="sm">Reproducing MoSPI&rsquo;s own worked examples</Title>
        <Text size="sm" c="dimmed" mb="md">
          The Expert Group Report publishes four worked examples. Our engine reproduces all
          four to four decimal places, so the arithmetic is checkable rather than asserted.
        </Text>
        {/* A 5-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={970}>
          <Table striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Example</Table.Th>
                <Table.Th ta="right">MoSPI</Table.Th>
                <Table.Th ta="right">APIx</Table.Th>
                <Table.Th ta="right">Match</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(m.worked_examples ?? []).map((e) => (
                <Table.Tr key={e.name}>
                  <Table.Td><Text size="sm">{e.name}</Text></Table.Td>
                  <Table.Td ta="right">{e.mospi_value}</Table.Td>
                  <Table.Td ta="right">{e.apix_value}</Table.Td>
                  <Table.Td ta="right">
                    {e.matches && <IconCircleCheck size={18} color="var(--mantine-color-teal-6)" />}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb="sm">The cell specification</Title>
          <Text size="sm">{m.cell}</Text>
          <Text size="sm" mt="md" fw={600}>The item tracked over time</Text>
          <Text size="sm">{m.item}</Text>
          <Text size="sm" mt="md" fw={600}>Imputation</Text>
          <Text size="sm">{m.imputation}</Text>
          <Code block mt="xs">{f.imputation}</Code>
          <Text size="xs" c="dimmed" mt="xs">{f.imputation_source}</Text>
        </Paper>

        <Paper>
          <Title order={2} mb="sm">Product specification</Title>
          <Table variant="vertical" withTableBorder={false}>
            <Table.Tbody>
              {Object.entries(m.product_specification ?? {}).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Th w={150}>
                    <Text size="xs" tt="capitalize">{k.replace(/_/g, ' ')}</Text>
                  </Table.Th>
                  <Table.Td><Text size="xs">{v}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </SimpleGrid>

      <Alert variant="light" color="orange" icon={<IconAlertTriangle size={18} aria-hidden="true" />}
             title="What we do not claim">
        <List size="sm" spacing="xs">
          {(m.caveats ?? []).map((c) => <List.Item key={c}>{c}</List.Item>)}
        </List>
      </Alert>
    </Stack>
  );
}
