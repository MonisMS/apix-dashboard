'use client';

import { Badge, Card, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { IconCircleCheck } from '../compat/icons';
import { useMethodology } from '../api';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { Formula } from '../components/Formula';

export default function Methodology() {
  const q = useMethodology();
  const state = queryState(q);
  if (state) return state;

  const m = q.data.methodology;
  const f = m.formulas;
  // "a x b x c; constraints (citation)" -- shown as the dimensions it really
  // is rather than one dense sentence.
  const [dimsRaw, ...restCell] = String(m.cell ?? '').split(';');
  const dims = dimsRaw.split(/\s+x\s+/).map((x) => x.trim()).filter(Boolean);
  const cellRest = restCell.join(';').trim();

  return (
    <Stack gap="lg">
      {pageHeader('Methodology', 'Two formulas, two levels — and why they are not in conflict')}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" data-tour="formulas">
        <Card>
          <Badge variant="light" color="indigo" mb="sm">Elementary level</Badge>
          <Title order={2} mb="xs" className="flex items-center gap-1.5">
            Jevons — geometric
            <InfoDot label="the Jevons formula">
              Read it as: today&rsquo;s cell index is yesterday&rsquo;s, multiplied by the
              geometric mean of how each matched flight&rsquo;s price changed. p with subscript t
              and superscript i is the price of flight i on day t.
            </InfoDot>
          </Title>
          <Formula source={f.elementary_source}>{f.elementary}</Formula>
          <Text size="sm" mt="md">
            Inside a cell there are no weights, so the unweighted geometric mean of matched
            price relatives is the right average. It treats a doubling and a halving as
            equal and opposite.
          </Text>
        </Card>

        <Card>
          <Badge variant="light" color="teal" mb="sm">Higher level</Badge>
          <Title order={2} mb="xs" className="flex items-center gap-1.5">
            Young — arithmetic
            <InfoDot label="the Young formula">
              Read it as: the index is each cell&rsquo;s index multiplied by its weight, added
              up, with the weights summing to 1. Sigma means &ldquo;add up over every j&rdquo;.
            </InfoDot>
          </Title>
          <Formula source={f.higher_level_source}>{f.higher_level}</Formula>
          <Text size="sm" mt="md">
            Combining cells, weights exist, and the index is a weighted arithmetic mean of
            index levels. Geometric at the bottom, arithmetic at the top.
          </Text>
        </Card>
      </SimpleGrid>

      <Paper>
        <Title order={2} mb="sm" className="flex items-center gap-1.5">
          Reproducing MoSPI&rsquo;s own worked examples
          <InfoDot label="the worked examples">
            MoSPI&rsquo;s Expert Group Report publishes four examples with the answers printed.
            Running our engine on the same inputs should return the same numbers — it does, to
            four decimal places, which makes the arithmetic checkable rather than asserted.
          </InfoDot>
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          The Expert Group Report publishes four worked examples. Our engine reproduces all
          four to four decimal places, so the arithmetic is checkable rather than asserted.
        </Text>
        {/* A 5-column table does not fit a phone. Scroll the table,
            not the page. */}
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
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb="sm" className="flex items-center gap-1.5">
            The cell specification
            <InfoDot label="a cell">
              The smallest thing the index prices. A price change is only ever measured inside
              one cell, between the same flight on two days.
            </InfoDot>
          </Title>
          <div className="flex flex-wrap items-center gap-1.5">
            {dims.map((x, i) => (
              <span key={x} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground">×</span>}
                <span className="border border-border bg-muted/50 px-2 py-0.5 text-xs">{x}</span>
              </span>
            ))}
          </div>
          {cellRest && <Text size="xs" c="dimmed" mt="xs">{cellRest}</Text>}

          <Text size="sm" mt="md" fw={600}>The item tracked over time</Text>
          <Text size="sm">{m.item}</Text>

          <Text size="sm" mt="md" fw={600} className="flex items-center gap-1.5">
            Imputation
            <InfoDot label="imputation">
              When a cell has no usable matched price, it follows the movement of the aggregate
              above it. Carrying yesterday&rsquo;s price forward is prohibited, because it would
              silently report &ldquo;no change&rdquo;.
            </InfoDot>
          </Text>
          <Text size="sm">{m.imputation}</Text>
          <Formula className="mt-2" source={f.imputation_source}>{f.imputation}</Formula>
        </Paper>

        <Paper>
          <Title order={2} mb="sm" className="flex items-center gap-1.5">
            Product specification
            <InfoDot label="the product specification">
              The exact thing being priced, held constant so that a change in the index is a
              change in price and not a change in what was measured.
            </InfoDot>
          </Title>
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

    </Stack>
  );
}
