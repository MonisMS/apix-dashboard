'use client';

import { useState } from 'react';
import { Badge, Card, Code, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { IconFilter } from '../compat/icons';
import { useCleaning } from '../api';
import { idx, pct, sharePct, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';
import { Pager } from '../components/Pager';

const LABEL = {
  none: 'No screening',
  hard_bound_only: 'Hard bound only (shipped)',
  hard_bound_and_mad: 'Hard bound + MAD',
};

const FLAG_PAGE = 15;

export default function Cleaning() {
  const q = useCleaning();
  const [page, setPage] = useState(0);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const sens = d.sensitivity ?? {};
  const regimes = Object.entries(sens);
  const maxDiff = Math.max(...regimes.map(([, v]) => Math.abs(v.diff_from_unscreened_pct ?? 0)), 0.1);
  const flags = d.flags ?? [];
  const shownFlags = flags.slice(page * FLAG_PAGE, page * FLAG_PAGE + FLAG_PAGE);

  return (
    <Stack gap="lg">
      {pageHeader('Cleaning', 'Outlier screening on day-on-day movements, not on price levels', [
        { label: `${d.n_flags} flagged`, color: d.n_flags ? 'orange' : 'gray' },
      ])}

      <Paper>
        <Title order={2} mb={4} className="flex items-center gap-1.5">
          What each screening rule does to the published number
          <InfoDot label="this comparison">
            The same days recomputed under three screening rules, shown as the difference from
            no screening at all. Choosing a rule without showing its effect is how a cleaning
            step quietly becomes an editorial one.
          </InfoDot>
        </Title>
        <Text size="xs" c="dimmed" mb="md">
          Choosing a screening rule without showing its effect is how a cleaning step
          quietly becomes an editorial one.
        </Text>
        <div className="flex flex-col gap-2">
          {regimes.map(([k, v]) => {
            const diff = v.diff_from_unscreened_pct ?? 0;
            const w = (Math.abs(diff) / maxDiff) * 50;
            const up = diff >= 0;
            return (
              <div key={k} className="grid grid-cols-[minmax(130px,auto)_1fr_minmax(140px,auto)] items-center gap-3">
                <span className="truncate text-sm">{LABEL[k] ?? k}</span>
                <div className="relative h-4">
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                  <span
                    className="absolute top-1/2 h-3.5 -translate-y-1/2"
                    style={{
                      left: up ? '50%' : `${50 - w}%`,
                      width: `${Math.max(w, 0.3)}%`,
                      background: diff === 0 ? 'var(--muted-foreground)' : up ? 'var(--warning)' : 'var(--chart-2)',
                      borderRadius: up ? '0 4px 4px 0' : '4px 0 0 4px',
                    }}
                  />
                </div>
                <span className="flex items-baseline justify-end gap-2 whitespace-nowrap">
                  <span className="tabular text-sm font-medium">{pct(diff, 3)}</span>
                  <span className="tabular text-xs text-muted-foreground">{v.n_screened} screened</span>
                </span>
              </div>
            );
          })}
        </div>
        <ColorKey
          className="mt-3"
          items={[
            { color: 'var(--muted-foreground)', label: 'No screening — the baseline' },
            { color: 'var(--chart-2)', label: 'Moves the index down' },
            { color: 'var(--warning)', label: 'Moves the index up' },
          ]}
          note="Bar length is how far that rule would move the published index."
        />
        {/* A 5-column table does not fit a phone. Scroll the table,
            not the page. */}
          <Table mt="md" striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Regime</Table.Th>
                <Table.Th ta="right">Flights screened</Table.Th>
                <Table.Th ta="right">Final level</Table.Th>
                <Table.Th ta="right">Difference</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(sens).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>{LABEL[k] ?? k}</Text>
                      {k === 'hard_bound_only' && (
                        <Badge size="xs" variant="light" color="teal">shipped</Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{v.n_screened}</Table.Td>
                  <Table.Td ta="right">{idx(v.final_raw_level)}</Table.Td>
                  <Table.Td ta="right">
                    <Badge size="sm" variant="light"
                           color={Math.abs(v.diff_from_unscreened_pct ?? 0) > 1 ? 'red' : 'gray'}>
                      {pct(v.diff_from_unscreened_pct, 3)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card>
          <Group gap="sm" mb="sm">
            <IconFilter size={20} aria-hidden="true" />
            <Title order={2} className="flex items-center gap-1.5">
              The rules
              <InfoDot label="the screening rules">
                Both rules act on how far a fare moved between two days, never on how expensive
                it is. An expensive route is not an outlier; an expensive route that was cheap
                yesterday might be. Hard bound: a fare that more than tripled, or fell below a
                third, is held out — that is what |ln(p_today / p_yesterday)| &gt; ln(3) says.
                The logarithm makes a tripling and a fall to a third the same size of move in
                opposite directions. MAD is the stricter alternative, switched off.
              </InfoDot>
            </Title>
          </Group>
          <Text size="sm" fw={600}>Hard bound — on</Text>
          <Text size="sm" c="dimmed">{d.hard_bound.description}</Text>
          <Code block mt="xs">{`|ln(p_t / p_t-1)| > ln(${d.hard_bound.threshold_ratio})`}</Code>
          <Text size="sm" fw={600} mt="md">Median / MAD — off</Text>
          <Text size="sm" c="dimmed">
            k = {d.mad.k}, minimum pool {d.mad.min_pool}, pooled {d.mad.pools}.
          </Text>
          <Text size="xs" c="dimmed" mt="md">{d.treatment}</Text>
        </Card>

        <Paper p={0}>
          <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
            By collection day
            <InfoDot label="this table">
              Matched moves are flights found on both a day and the day before — the only thing
              a price change can be measured on. Hard bound is how many that rule held out;
              MAD is what the switched-off rule would have held out.
            </InfoDot>
          </Title>
          {/* A 6-column table does not fit a phone. Scroll the table,
              not the page. */}
              <Table striped verticalSpacing="sm" horizontalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th ta="right">Matched moves</Table.Th>
                  <Table.Th ta="right">Hard bound</Table.Th>
                  <Table.Th ta="right">MAD</Table.Th>
                  <Table.Th ta="right">Share</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(d.per_day ?? {}).map(([date, v]) => (
                  <Table.Tr key={date}>
                    <Table.Td>{shortDate(date)}</Table.Td>
                    <Table.Td ta="right">{v.n_relatives}</Table.Td>
                    <Table.Td ta="right">{v.n_extreme}</Table.Td>
                    <Table.Td ta="right">{v.n_mad}</Table.Td>
                    <Table.Td ta="right">{sharePct(v.share_screened, 3)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
      </SimpleGrid>

      {d.flags?.length > 0 && (
        <Paper p={0}>
          <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
            Flagged observations
            <InfoDot label="EXTREME_MOVE">
              Every flag here is EXTREME_MOVE: one flight whose fare changed by more than three
              times between consecutive days. A move that large is far more likely to be a
              different fare class, a data error or a source glitch than a real overnight
              repricing, so it leaves the matched sample. The row stays in the database.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" px="lg" pb="sm">
            Quarantined from the matched sample. Still in the database, never deleted.
          </Text>
          {/* A 4-column table does not fit a phone. Scroll the table,
              not the page. */}
              <Table striped verticalSpacing="sm" horizontalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Observation</Table.Th>
                  <Table.Th>Flag</Table.Th>
                  <Table.Th>Detail</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shownFlags.map((f, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Code>{f.observation_id}</Code></Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color="orange">{f.flag}</Badge>
                    </Table.Td>
                    <Table.Td><Text size="xs">{f.detail}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
      )}
    </Stack>
  );
}
