'use client';

import { useState } from 'react';
import { Alert, Badge, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { IconAlertTriangle } from '../compat/icons';
import { useCollection, useRunLog } from '../api';
import { count, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { Pager } from '../components/Pager';

const RUN_PAGE = 20;

export default function Collection() {
  const q = useCollection();
  const runs = useRunLog();
  const [page, setPage] = useState(0);
  const state = queryState(q, runs);
  if (state) return state;

  const d = q.data;
  const s = d.summary;
  const allRuns = runs.data?.runs ?? [];
  const shownRuns = allRuns.slice(page * RUN_PAGE, page * RUN_PAGE + RUN_PAGE);

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

      <div className="lc-stats" data-tour="collection-stats">
        {[
          ['Observations', count(s.observations),
           'Every individual fare we stored, across every route, day and booking window.'],
          ['Used by the index', count(s.rows_selected),
           `Of those, the ones the index actually priced. A fare is left out when a later sweep superseded it, or when it failed the genuineness screen. ${count(s.observations - s.rows_selected)} were not used.`],
          ['Sweeps', count(s.sweeps),
           'A sweep is one pass of the collector over the basket. Several can run on one day, and a day can be assembled from more than one of them.'],
          ['Basket pax covered', `${d.routes.basket_pax_covered_pct}%`,
           'The share of DGCA passenger traffic, across the whole basket, that sits on routes we actually collected.'],
        ].map(([label, value, info]) => (
          <div className="lc-stat" key={label}>
            <span className="k">{label} <InfoDot label={label}>{info}</InfoDot></span>
            <span className="v">{value}</span>
          </div>
        ))}
      </div>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          By collection day
          <InfoDot label="this table">
            One row per day the collector ran, showing how much it gathered and how close it
            kept to its scheduled time.
          </InfoDot>
        </Title>
        {/* A 8-column table does not fit a phone. Scroll the table,
            not the page. */}
          <Table striped verticalSpacing="sm" horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Observations</Table.Th>
                <Table.Th ta="right" className="hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1">Cells<InfoDot label="cells" side="left">
                    A cell is one route x airline x departure band x booking window — the
                    smallest unit the index prices. This is how many were priced that day.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right" className="hidden md:table-cell">
                  <span className="inline-flex items-center gap-1">Sweeps<InfoDot label="sweeps" side="left">
                    How many passes of the collector contributed to this day.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">Attempts<InfoDot label="attempts" side="left">
                    One attempt is one request to a source for one route at one booking window.
                    Twelve routes across five windows is sixty attempts for a complete sweep.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">Failed<InfoDot label="failed" side="left">
                    Attempts that returned no usable fares — a timeout, an error, or an empty
                    result. A failed attempt leaves a gap; it never becomes a guessed price.
                  </InfoDot></span>
                </Table.Th>
                <Table.Th ta="right">
                  <span className="inline-flex items-center gap-1">Slot<InfoDot label="the collection slot" side="left">
                    The collector aims for this time every day, so day-on-day changes are
                    measured at the same point in the booking cycle. How far each sweep actually
                    ran from the slot is published on /api/v1/collection.
                  </InfoDot></span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.days.map((day) => (
                <Table.Tr key={day.date}>
                  <Table.Td>{shortDate(day.date)}</Table.Td>
                  <Table.Td ta="right">{count(day.n_observations)}</Table.Td>
                  <Table.Td ta="right" className="hidden lg:table-cell">{day.n_cells}</Table.Td>
                  <Table.Td ta="right" className="hidden md:table-cell">{day.n_runs}</Table.Td>
                  <Table.Td ta="right">{day.attempts}</Table.Td>
                  <Table.Td ta="right">
                    {day.failed ? <Badge size="sm" color="red" variant="light">{day.failed}</Badge> : '0'}
                  </Table.Td>
                  <Table.Td ta="right" className="whitespace-nowrap">
                    {/* The scheduled slot only. The measured start time and the
                        drift from it are still computed and still published on
                        /api/v1/collection -- they are just not shown in this
                        column, at the user's request. */}
                    <Text size="xs">{day.nominal_time_ist} IST</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
      </Paper>

      <Paper>
        <Title order={2} mb="sm" className="flex items-center gap-1.5">
          Sweep selection
          <InfoDot label="sweep selection">
            When more than one sweep covers the same route and window on the same day, only one
            fare can be used. This is the rule that decides which, applied per cell rather than
            per day.
          </InfoDot>
        </Title>
        <Text size="sm" c="dimmed">{d.sweep_selection.rule}</Text>
        <Text size="sm" c="dimmed" mt="xs">{d.sweep_selection.genuineness_screen}</Text>
      </Paper>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          Recent fetches
          <InfoDot label="a fetch">
            One request to a source for one route at one booking window. This is the raw
            collector log: what was asked for, how many fares came back, and how long it took.
          </InfoDot>
        </Title>
          <Table striped verticalSpacing="xs" horizontalSpacing="sm">
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
              {shownRuns.map((r, i) => (
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
        <Pager page={page} pageSize={RUN_PAGE} total={allRuns.length} onPage={setPage}
               unit="fetches" />
      </Paper>
    </Stack>
  );
}
