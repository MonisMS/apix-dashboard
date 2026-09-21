'use client';

import { useState } from 'react';
import { Badge, Group, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useHealth } from '../api';
import { count } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';

/**
 * Each endpoint, what it returns, and — where it takes a parameter — how to
 * fill it in and a worked example that actually resolves.
 */
const ENDPOINTS = [
  ['/api/v1/health', 'Schema version, observation count, database state'],
  ['/api/v1/index', 'The headline series APIX.ALL'],
  ['/api/v1/series', 'Catalogue of every series with its weight share'],
  ['/api/v1/routes', 'All basket routes, including those never collected'],
  ['/api/v1/routes/{pair}', 'One route: series, carriers, fare spread, windows', {
    name: 'pair',
    how: 'Two IATA airport codes joined by a hyphen, uppercase, origin first — as listed on the Routes page.',
    example: '/api/v1/routes/DEL-BOM',
  }],
  ['/api/v1/carriers', 'Per-carrier index and share'],
  ['/api/v1/carriers/{code}', 'One carrier', {
    name: 'code',
    how: 'The airline name exactly as the Carriers page shows it, URL-encoded if it contains a space. Not the two-letter IATA code.',
    example: '/api/v1/carriers/IndiGo',
  }],
  ['/api/v1/windows', 'The five advance-purchase sub-indices'],
  ['/api/v1/heatmap?metric=level', 'Routes x dates matrix', {
    name: 'metric',
    how: 'One of pct_change, level, mean_fare or n_offers. Defaults to pct_change if omitted.',
    example: '/api/v1/heatmap?metric=mean_fare',
  }],
  ['/api/v1/weights', 'The frozen weight tree and CPI context'],
  ['/api/v1/collection', 'Coverage, sweeps, and how far each sweep ran from its slot'],
  ['/api/v1/collection/runs?limit=60', 'The raw fetch log', {
    name: 'limit',
    how: 'How many of the most recent fetches to return. Defaults to 200.',
    example: '/api/v1/collection/runs?limit=20',
  }],
  ['/api/v1/validation', 'APIx vs MoSPI item 294, and why they cannot be compared yet'],
  ['/api/v1/tariffs', 'Rule 135 published fare ladders'],
  ['/api/v1/methodology', 'Formulas, citations, worked examples'],
  ['/api/v1/cleaning', 'Outlier screening and its sensitivity'],
  ['/api/v1/availability', 'Disappearance analysis and the sold-out bound'],
  ['/api/v1/split', 'Base fare against taxes, from the periodic panel'],
  ['/api/v1/audit', 'Transitivity and churn'],
];

function CopyButton({ value, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { setDone(false); }
      }}
      aria-label={done ? 'Copied' : `Copy ${label}`}
      className="shrink-0 border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {done ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
    </button>
  );
}

export default function ApiPage() {
  const q = useHealth();
  const state = queryState(q);
  if (state) return state;

  const h = q.data;
  // Prefer the canonical public origin, so a copied endpoint is usable by
  // whoever it is pasted to. window.location.origin would copy
  // http://localhost:3000 from a dev machine, or a one-off preview host from
  // a preview deployment.
  const base =
    process.env.NEXT_PUBLIC_APIX_SITE_URL ||
    (typeof window === 'undefined' ? '' : window.location.origin);

  return (
    <Stack gap="lg">
      {pageHeader('API', 'A read-only JSON interface over the index, for the NSO, the RBI or anyone else',
        [{ label: `v${h.api_version}`, color: 'indigo' },
         { label: h.status, color: h.status === 'ok' ? 'teal' : 'orange' }])}

      <Paper>
        <Title order={2} mb="sm" className="flex items-center gap-1.5">
          Service
          <InfoDot label="service status">
            Live state of the database behind the API, read fresh on every request. If this
            says degraded, every number in the dashboard should be treated with suspicion.
          </InfoDot>
        </Title>
        <Table variant="vertical" withTableBorder={false}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Th w={220}>
                <span className="inline-flex items-center gap-1">Schema version<InfoDot label="schema version">
                  The database migration level this deployment is running, and the lowest level
                  these handlers need. Ahead is fine; behind means tables they read do not exist yet.
                </InfoDot></span>
              </Table.Th>
              {/* Was h.database.expected_schema_version, which the API does not
                  return -- it rendered as "9 (expects )". */}
              <Table.Td>
                {h.database.schema_version} · needs at least {h.database.minimum_schema_version}
              </Table.Td>
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
              <Table.Th>
                <span className="inline-flex items-center gap-1">Write access<InfoDot label="write access">
                  Whether the role this web process connects as could modify the data. The API
                  is meant to be read-only; this reports it rather than asserting it.
                </InfoDot></span>
              </Table.Th>
              <Table.Td>
                <Badge size="sm" variant="light" color={h.database.api_can_write ? 'orange' : 'teal'}>
                  {h.database.api_can_write ? 'role can write' : 'read-only'}
                </Badge>
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>Base URL</Table.Th>
              <Table.Td>
                <span className="inline-flex items-center gap-2">
                  <code className="bg-muted px-1.5 py-0.5 text-xs">{base}/api/v1</code>
                  <CopyButton value={`${base}/api/v1`} label="the base URL" />
                </span>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          Endpoints
          <InfoDot label="these endpoints">
            Every one is a plain GET returning JSON, with no key and no authentication. Click a
            path to open its live response in a new tab, or copy it to use elsewhere.
          </InfoDot>
        </Title>
        <Table striped verticalSpacing="sm" horizontalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Path</Table.Th>
              <Table.Th>Returns</Table.Th>
              <Table.Th ta="right" />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ENDPOINTS.map(([path, desc, param]) => {
              const href = param?.example ?? path;
              return (
                <Table.Tr key={path}>
                  <Table.Td className="align-top">
                    <span className="flex items-center gap-1.5">
                      {/* Every path is a link now, parameterised ones pointing
                          at a worked example that actually resolves. */}
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {path}
                      </a>
                      {param && (
                        <InfoDot label={`the ${param.name} parameter`}>
                          <span className="block font-medium">{'{'}{param.name}{'}'}</span>
                          {param.how}
                          <span className="mt-1 block font-mono text-[11px]">{param.example}</span>
                        </InfoDot>
                      )}
                      <CopyButton value={`${base}${href}`} label={path} />
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top"><Text size="sm">{desc}</Text></Table.Td>
                  <Table.Td ta="right" className="align-top whitespace-nowrap">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      view response
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper>
        <Title order={2} mb="sm" className="flex items-center gap-1.5">
          Contract rules
          <InfoDot label="contract rules">
            Promises this API keeps, so a consumer can rely on the shape of a response as well
            as its contents.
          </InfoDot>
        </Title>
        <Stack gap="sm">
          {[
            ['never writes',
             'Connections open read-only. A web process cannot alter the series.'],
            ['points: null',
             'Where a series cannot exist yet, points is null with a stated reason. An ' +
             'empty array would read as “collected, nothing moved”.'],
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
