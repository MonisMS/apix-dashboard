'use client';

import { Badge, Paper, SimpleGrid, Stack, Table, Text, Title } from '../compat/mantine';
import { useCarriers } from '../api';
import { count, idx, pct, rupees, sharePct } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';

const INFO = {
  share:
    'The share of all collected fares that belong to each airline. This describes our sample, ' +
    'not the airline’s share of the market — we see the fares a searcher is shown, not ' +
    'tickets sold.',
  weight:
    'How much of the index each airline carries. Derived from offers x mean fare, so it is an ' +
    'expenditure share of what we observed, not a passenger count.',
  level:
    'Each airline’s own index, on the same reference window as the headline, where 100 is ' +
    'that window’s average. Above 100 means its fares are higher than they were then.',
  dod: 'Change against the previous collection day, as published by the engine.',
  cells:
    'A cell is one route x this airline x departure-time band x advance-purchase window. Fewer ' +
    'than 10 and the airline’s index rests on a thin sample.',
};

/** Ranked horizontal bars. Replaces a 7-slice donut drawn from a single-hue
 *  green ramp, where neighbouring slices were near-indistinguishable and the
 *  reader had to match colours back to a legend to learn anything. A ranked
 *  bar is read directly, and length is a far better encoding of share than
 *  angle. */
function ShareBars({ rows, total }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => {
        const share = total ? c.n_offers / total : 0;
        return (
          <div key={c.carrier} className="grid grid-cols-[minmax(84px,auto)_1fr_auto] items-center gap-2">
            <span className="truncate text-sm" title={c.carrier}>{c.carrier}</span>
            <span className="h-3 bg-muted">
              <span
                className="block h-3"
                style={{ width: `${Math.max(share * 100, 0.6)}%`, background: 'var(--chart-2)' }}
              />
            </span>
            <span className="tabular w-20 text-right text-xs text-muted-foreground">
              {sharePct(share, 1)} · {count(c.n_offers)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Index level against the reference of 100, so above/below reads instantly. */
function LevelBars({ rows }) {
  const span = Math.max(...rows.map((c) => Math.abs((c.level ?? 100) - 100)), 5);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => {
        const delta = (c.level ?? 100) - 100;
        const w = (Math.abs(delta) / span) * 50;
        const up = delta >= 0;
        return (
          <div key={c.carrier} className="grid grid-cols-[minmax(84px,auto)_1fr_auto] items-center gap-2">
            <span className="truncate text-sm" title={c.carrier}>{c.carrier}</span>
            <span className="relative flex h-3 items-center">
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className="absolute h-3"
                style={{
                  left: up ? '50%' : `${50 - w}%`,
                  width: `${Math.max(w, 0.4)}%`,
                  background: up ? 'var(--success)' : 'var(--destructive)',
                }}
              />
            </span>
            <span className="tabular w-14 text-right text-xs">{idx(c.level)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Carriers() {
  const q = useCarriers();
  const state = queryState(q);
  if (state) return state;

  const rows = q.data.carriers ?? [];
  const totalOffers = rows.reduce((n, c) => n + (c.n_offers ?? 0), 0);
  const byShare = [...rows].sort((a, b) => (b.n_offers ?? 0) - (a.n_offers ?? 0));
  const byLevel = [...rows].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const named = rows.filter((c) => c.in_ps_named_five);
  const namedShare = totalOffers
    ? named.reduce((n, c) => n + (c.n_offers ?? 0), 0) / totalOffers
    : 0;
  const biggest = byShare[0];

  return (
    <Stack gap="lg">
      {pageHeader('Carriers', 'The airline is part of the cell specification, so each carrier has its own index',
        [{ label: `${rows.length} observed`, color: 'gray' }])}

      <Paper className="flex flex-row flex-wrap items-center justify-between gap-6">
        <div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Airlines observed
            <InfoDot label="airlines observed">
              Every airline that appeared in a collected fare. {q.data.note}
            </InfoDot>
          </p>
          <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">{rows.length}</p>
        </div>
        <div className="hidden h-10 w-px bg-border sm:block" />
        <div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Share held by the named five
            <InfoDot label="the named five">{q.data.note}</InfoDot>
          </p>
          <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">
            {sharePct(namedShare, 1)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{named.length} of {rows.length} airlines</p>
        </div>
        <div className="hidden h-10 w-px bg-border sm:block" />
        <div>
          <p className="text-xs text-muted-foreground">Largest by offers</p>
          <p className="tabular mt-0.5 text-[22px] font-medium leading-tight">{biggest?.carrier ?? '—'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {sharePct(totalOffers ? (biggest?.n_offers ?? 0) / totalOffers : 0, 1)} of offers
          </p>
        </div>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            Share of observed offers
            <InfoDot label="share of observed offers">{INFO.share}</InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">Describes our sample, not the market</Text>
          <ShareBars rows={byShare} total={totalOffers} />
          <ColorKey
            className="mt-3"
            items={[{ color: 'var(--chart-2)', label: 'Share of all fares we collected' }]}
            note="Bar length is the share; the figures repeat it as a percentage and a count."
          />
        </Paper>

        <Paper>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            Index level by carrier
            <InfoDot label="index level by carrier">{INFO.level}</InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">Distance from the reference window, where 100 is the average</Text>
          <LevelBars rows={byLevel} />
          <ColorKey
            className="mt-3"
            items={[
              { color: 'var(--success)', label: 'Above 100 — dearer than the reference window' },
              { color: 'var(--destructive)', label: 'Below 100 — cheaper than the reference window' },
            ]}
            note="Bars run out from the centre line, which is 100."
          />
        </Paper>
      </SimpleGrid>

      <Paper p={0}>
        <Title order={2} p="lg" pb="sm" className="flex items-center gap-1.5">
          Carrier indices
          <InfoDot label="this table">
            One row per airline, with the share of the index it carries, the sample behind it,
            and where its own index stands.
          </InfoDot>
        </Title>
        {/* Was Table.ScrollContainer minWidth={1150} inside a half-width grid
            column, so it scrolled sideways at every screen size. Full width
            and six columns fit without it. */}
        <Table striped verticalSpacing="sm" horizontalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Carrier</Table.Th>
              <Table.Th ta="right">
                <span className="inline-flex items-center gap-1">Weight<InfoDot label="weight" side="left">{INFO.weight}</InfoDot></span>
              </Table.Th>
              <Table.Th ta="right">Offers</Table.Th>
              <Table.Th ta="right">
                <span className="inline-flex items-center gap-1">Cells<InfoDot label="cells" side="left">{INFO.cells}</InfoDot></span>
              </Table.Th>
              <Table.Th ta="right">Mean fare</Table.Th>
              <Table.Th ta="right">Index</Table.Th>
              <Table.Th ta="right">
                <span className="inline-flex items-center gap-1">Day-on-day<InfoDot label="day-on-day" side="left">{INFO.dod}</InfoDot></span>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {byShare.map((c) => (
              <Table.Tr key={c.carrier}>
                <Table.Td className="whitespace-nowrap">
                  <span className="text-sm font-semibold">{c.carrier}</span>
                  {!c.in_ps_named_five && (
                    <Badge size="xs" variant="light" color="gray" ml={6}>outside the five</Badge>
                  )}
                  {c.n_cells < 10 && (
                    <Badge size="xs" variant="light" color="yellow" ml={6}>thin</Badge>
                  )}
                </Table.Td>
                <Table.Td ta="right">{sharePct(c.weight_share)}</Table.Td>
                <Table.Td ta="right">{count(c.n_offers)}</Table.Td>
                <Table.Td ta="right">{count(c.n_cells)}</Table.Td>
                <Table.Td ta="right">{rupees(c.mean_fare)}</Table.Td>
                <Table.Td ta="right"><Text fw={600} size="sm">{idx(c.level)}</Text></Table.Td>
                <Table.Td ta="right">
                  <span className={c.pct_change_1p >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                    {pct(c.pct_change_1p)}
                  </span>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
