'use client';

import { Badge, Button, Paper, Stack, Table, Text, Title } from '../compat/mantine';
import { LineChart } from '../compat/mantine-charts';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTariffs } from '../api';
import { count, rupees, shortDate } from '../format';
import { pageHeader, queryState } from '../state';
import { InfoDot } from '../components/InfoDot';
import { ColorKey } from '../components/ColorKey';
import { Pager } from '../components/Pager';

const PAGE = 25;

/** Fixed per airline, so a filter or a re-sort never repaints them. */
const AIRLINE_COLOR = {
  'Akasa Air': 'var(--warning)',
  SpiceJet: 'var(--destructive)',
};
const colorFor = (a) => AIRLINE_COLOR[a] ?? 'var(--muted-foreground)';

export default function Tariffs() {
  const q = useTariffs();
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const state = queryState(q);
  if (state) return state;

  const d = q.data;
  const markets = d.markets ?? [];
  const pick = selected ?? markets.find((m) => m.min_levels?.length) ?? markets[0];
  const sources = Object.entries(d.sources ?? {});

  const ladder = pick?.min_levels
    ? pick.min_levels.map((v, i) => ({
        level: `L${i + 1}`, Minimum: v, Maximum: pick.max_levels?.[i] ?? null,
      }))
    : [];

  const shown = markets.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <Stack gap="lg">
      {pageHeader('Published tariffs', 'Fare bands airlines publish under Rule 135 of the Aircraft Rules',
        [{ label: `${d.n_markets} markets`, color: 'gray' }])}

      {/* The legal basis and the "a band is not a price" caveat used to be a
          full-width paragraph block at the top of the page. Both are still
          here, on the things they qualify, rather than as a wall of text
          before anyone reaches the data. */}
      <Paper className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Source documents
            <InfoDot label="these source documents">
              {d.legal_basis} Each link is the airline&rsquo;s own published fare sheet, which is
              where every figure on this page comes from.
            </InfoDot>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            {sources.map(([airline, src]) => (
              <a
                key={airline}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                title={`Found via ${src.found_via}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 border border-border"
                  style={{ background: colorFor(airline) }}
                  aria-hidden="true"
                />
                {airline} fare sheet
                <span className="text-xs font-normal text-muted-foreground">(PDF)</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Retrieved</p>
            <p className="tabular mt-0.5 text-sm font-medium">{shortDate(d.retrieved)}</p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Fare rows read
              <InfoDot label="fare rows read">
                Individual fare-level rows parsed out of the two PDFs, across every market.
              </InfoDot>
            </p>
            <p className="tabular mt-0.5 text-sm font-medium">{count(d.n_rows)}</p>
          </div>
          <div className="max-w-[26rem] text-xs text-muted-foreground">{d.caveat}</div>
        </div>
      </Paper>

      {ladder.length > 0 && (
        <Paper>
          <Title order={2} mb={4} className="flex items-center gap-1.5">
            Fare ladder — {pick.airline}, {pick.city_a} to {pick.city_b}
            <InfoDot label="a fare ladder">
              The published steps a fare must sit on for this market. Each step L1…Ln has a floor
              and a ceiling; an airline may sell at a step, not between them. This is the
              permitted band, not a price anyone paid.
            </InfoDot>
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            {pick.n_levels} published fare levels · fuel charge (YQ) {rupees(pick.fuel_charge_yq)}
            {' '}· select any market below to change this chart
          </Text>
          <LineChart
            h={280} data={ladder} dataKey="level"
            series={[{ name: 'Minimum', color: 'teal.6' }, { name: 'Maximum', color: 'orange.6' }]}
            valueFormatter={(v) => rupees(v)} yAxisProps={{ width: 76 }}
          />
          <ColorKey
            className="mt-3"
            items={[
              { color: 'var(--success)', label: 'Minimum — the floor of each published step' },
              { color: 'var(--warning)', label: 'Maximum — the ceiling of each published step' },
            ]}
            note="Steps are discrete: the line joins them to show the shape, it does not mean fares exist in between."
          />
        </Paper>
      )}

      <Paper p={0}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-6 pb-2">
          <Title order={2} className="flex items-center gap-1.5">
            Markets
            <InfoDot label="a market">
              One origin–destination pair as the airline&rsquo;s own tariff sheet names it. These
              are the airline&rsquo;s published markets, not the DGCA basket this index is built
              on, so they do not line up one-to-one with the routes elsewhere in the dashboard.
            </InfoDot>
          </Title>
          <ColorKey
            items={sources.map(([airline]) => ({ color: colorFor(airline), label: airline }))}
            note="Row colour marks which airline published the tariff."
          />
        </div>
        <Table striped verticalSpacing="sm" horizontalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Airline</Table.Th>
              <Table.Th>Market</Table.Th>
              <Table.Th ta="right" className="hidden md:table-cell">Stops</Table.Th>
              <Table.Th ta="right">
                <span className="inline-flex items-center gap-1">Levels<InfoDot label="levels" side="left">
                  How many discrete fare steps the airline publishes for this market.
                </InfoDot></span>
              </Table.Th>
              <Table.Th ta="right">Lowest</Table.Th>
              <Table.Th ta="right">Highest</Table.Th>
              <Table.Th ta="right" className="hidden lg:table-cell">
                <span className="inline-flex items-center gap-1">YQ<InfoDot label="YQ" side="left">
                  The carrier&rsquo;s own fuel charge, added on top of the fare band. It is the
                  airline&rsquo;s accounting line, not a statutory rate or a tax.
                </InfoDot></span>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((m, i) => (
              <Table.Tr key={`${m.airline}-${m.city_a}-${m.city_b}-${i}`}>
                <Table.Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 border border-border"
                      style={{ background: colorFor(m.airline) }}
                      aria-hidden="true"
                    />
                    <span className="text-sm">{m.airline}</span>
                  </span>
                </Table.Td>
                <Table.Td>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => setSelected(m)}
                    aria-label={`Show the fare ladder for ${m.airline}, ${m.city_a} to ${m.city_b}`}
                  >
                    {m.city_a} – {m.city_b}
                  </Button>
                  {pick === m && (
                    <Badge size="xs" variant="light" color="indigo" ml={6}>charted</Badge>
                  )}
                </Table.Td>
                <Table.Td ta="right" className="hidden md:table-cell">{m.stops}</Table.Td>
                <Table.Td ta="right">{m.n_levels}</Table.Td>
                <Table.Td ta="right">{rupees(m.min_lowest)}</Table.Td>
                <Table.Td ta="right">{rupees(m.max_highest)}</Table.Td>
                <Table.Td ta="right" className="hidden lg:table-cell">{rupees(m.fuel_charge_yq)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {/* Was markets.slice(0, 80) against 118 markets: 38 were dropped with
            no indication, while the page header still said 118. */}
        <Pager page={page} pageSize={PAGE} total={markets.length} onPage={setPage} unit="markets" />
      </Paper>
    </Stack>
  );
}
