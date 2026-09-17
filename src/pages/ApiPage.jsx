import { Anchor, Badge, Code, Group, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { useHealth } from '../api';
import { count } from '../format';
import { pageHeader, queryState } from '../state';

const ENDPOINTS = [
  ['/api/v1/health', 'Schema version, observation count, cache state'],
  ['/api/v1/index', 'The headline series APIX.ALL'],
  ['/api/v1/series', 'Catalogue of every series with its weight share'],
  ['/api/v1/routes', 'All basket routes, including those never collected'],
  ['/api/v1/routes/{pair}', 'One route: series, carriers, fare spread, windows'],
  ['/api/v1/carriers', 'Per-carrier index and share'],
  ['/api/v1/carriers/{code}', 'One carrier'],
  ['/api/v1/windows', 'The five advance-purchase sub-indices'],
  ['/api/v1/heatmap?metric=', 'Routes x dates matrix'],
  ['/api/v1/weights', 'The frozen weight tree and CPI context'],
  ['/api/v1/collection', 'Coverage, sweeps, the collection-hour warning'],
  ['/api/v1/collection/runs', 'The raw fetch log'],
  ['/api/v1/validation', 'APIx vs MoSPI item 294, and why they cannot be compared yet'],
  ['/api/v1/tariffs', 'Rule 135 published fare ladders'],
  ['/api/v1/methodology', 'Formulas, citations, worked examples'],
  ['/api/v1/cleaning', 'Outlier screening and its sensitivity'],
  ['/api/v1/availability', 'Disappearance analysis and the sold-out bound'],
  ['/api/v1/audit', 'Transitivity and churn'],
];

export default function ApiPage() {
  const q = useHealth();
  const state = queryState(q);
  if (state) return state;

  const h = q.data;

  return (
    <Stack gap="lg">
      {pageHeader('API', 'A read-only JSON interface over the index, for the NSO, the RBI or anyone else',
        [{ label: `v${h.api_version}`, color: 'indigo' },
         { label: h.status, color: h.status === 'ok' ? 'teal' : 'orange' }])}

      <Paper>
        <Title order={4} mb="sm">Service</Title>
        {/* A 4-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={880}>
          <Table variant="vertical" withTableBorder={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={220}>Schema version</Table.Th>
                <Table.Td>{h.database.schema_version} (expects {h.database.expected_schema_version})</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Observations</Table.Th>
                <Table.Td>{count(h.database.observations)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Last collected</Table.Th>
                <Table.Td>{h.database.last_collected_at}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Interactive docs</Table.Th>
                <Table.Td><Anchor href="/docs" target="_blank">/docs</Anchor></Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper>
        <Title order={4} mb="sm">Run it</Title>
        <Code block>{`cd /home/monis/sih2026
PYTHONPATH=.:api uvicorn api.main:app --reload --port 8000`}</Code>
      </Paper>

      <Paper p={0}>
        <Title order={4} p="lg" pb="sm">Endpoints</Title>
        {/* A 4-column table does not fit a phone. Scroll the table,
            not the page. */}
        <Table.ScrollContainer minWidth={880}>
          <Table striped verticalSpacing="sm" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Path</Table.Th>
                <Table.Th>Returns</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ENDPOINTS.map(([path, desc]) => (
                <Table.Tr key={path}>
                  <Table.Td><Code>{path}</Code></Table.Td>
                  <Table.Td><Text size="sm">{desc}</Text></Table.Td>
                  <Table.Td ta="right">
                    {!path.includes('{') && (
                      <Anchor href={path} target="_blank" size="xs">open</Anchor>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper>
        <Title order={4} mb="sm">Contract rules</Title>
        <Stack gap="sm">
          {[
            ['never writes',
             'Connections open read-only. A web process cannot alter the series.'],
            ['points: null',
             'Where a series cannot exist yet, points is null with a stated reason. An ' +
             'empty array would read as \u201ccollected, nothing moved\u201d.'],
            ['404 vs 200',
             'A route outside the basket 404s. A basket route with no fares returns 200 ' +
             'with NOT_COLLECTED, because it exists and the gap is the point.'],
          ].map(([tag, body]) => (
            <Group key={tag} gap="sm" align="flex-start" wrap="nowrap">
              <Badge variant="light" size="sm" style={{ flexShrink: 0 }}>{tag}</Badge>
              <Text size="sm">{body}</Text>
            </Group>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
