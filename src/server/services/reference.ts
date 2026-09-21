import { sql, num, isoDate } from '../db';
import type { Vintage } from '../envelope';
import {
  CAVEATS, CPI_CONSTANTS, FORMULAS, METHODOLOGY, PRODUCT_SPEC, SPLIT_NOTES,
  TARIFF_NOTES, WEIGHTS_EXPLANATION, WORKED_EXAMPLES,
} from '../notes';

/** Reference-data endpoints: weights, methodology, tariffs, the fare split. */

type Row = Record<string, unknown>;

const r8 = (n: number) => Number(n.toFixed(8));
const r2 = (n: number) => Number(n.toFixed(2));

async function provenance(v: Vintage): Promise<Record<string, any>> {
  const rows = (await sql`
    SELECT ws.provenance FROM index_run r
      JOIN weight_set ws ON ws.id = r.weight_set_id WHERE r.id = ${v.runId}
  `) as Row[];
  return (rows[0]?.provenance as Record<string, any>) ?? {};
}

export async function cpiContext() {
  const [totalRows, sectorRows, topRows] = await Promise.all([
    sql`SELECT COALESCE(SUM(share_in_all_india_pct), 0)::float8 AS total FROM cpi_weight_row`,
    sql`SELECT sector, SUM(share_in_all_india_pct)::float8 AS s
          FROM cpi_weight_row GROUP BY sector`,
    sql`SELECT state_name, sector, share_in_all_india_pct
          FROM cpi_weight_row ORDER BY share_in_all_india_pct DESC LIMIT 8`,
  ]);

  const bySector: Record<string, number> = {};
  for (const r of sectorRows as Row[]) bySector[String(r.sector)] = Number((num(r.s) as number).toFixed(6));

  return {
    airfare_weight_pct: Number((num((totalRows as Row[])[0].total) as number).toFixed(6)),
    by_sector: bySector,
    ...CPI_CONSTANTS,
    top_contributing_states: (topRows as Row[]).map((r) => ({
      state: r.state_name,
      sector: r.sector,
      share_in_all_india_pct: num(r.share_in_all_india_pct),
    })),
  };
}

export async function weightsTree(v: Vintage) {
  const [prov, cells] = await Promise.all([
    provenance(v),
    sql`SELECT w.origin, w.destination, w.lead_time_days, w.carrier, w.weight
          FROM weight w JOIN index_run r ON r.weight_set_id = w.weight_set_id
         WHERE r.id = ${v.runId} AND w.level = 'CELL'`,
  ]);

  const byRoute: Record<string, number> = {};
  const byLead: Record<string, number> = {};
  const byCarrier: Record<string, number> = {};
  let total = 0;
  for (const c of cells as Row[]) {
    const w = num(c.weight) as number;
    const pair = `${c.origin}-${c.destination}`;
    byRoute[pair] = (byRoute[pair] ?? 0) + w;
    byLead[String(c.lead_time_days)] = (byLead[String(c.lead_time_days)] ?? 0) + w;
    byCarrier[String(c.carrier)] = (byCarrier[String(c.carrier)] ?? 0) + w;
    total += w;
  }

  const desc = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, x]) => [k, r8(x)]));
  const byKeyNum = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, x]) => [k, r8(x)]));

  return {
    provenance: prov,
    n_cells: (cells as Row[]).length,
    sum: Number(total.toFixed(12)),
    by_route: desc(byRoute),
    by_lead: byKeyNum(byLead),
    by_carrier: desc(byCarrier),
    explanation: WEIGHTS_EXPLANATION,
  };
}

export async function methodologyFull(v: Vintage) {
  const prov = await provenance(v);
  return {
    ...METHODOLOGY,
    weights: prov,
    product_specification: PRODUCT_SPEC,
    formulas: FORMULAS,
    worked_examples: WORKED_EXAMPLES,
    caveats: CAVEATS,
  };
}

export async function tariffs() {
  const [rows, sources, meta] = await Promise.all([
    // Ordered by id so that, where a market appears twice, the later row
    // wins the fold below -- matching reference.py's dict assignment.
    sql`SELECT airline, city_a, city_b, bound, origin, destination, stops,
               fuel_charge_yq, n_levels, lowest_level, highest_level, levels
          FROM tariff_row ORDER BY id`,
    sql`SELECT airline, url, found_via FROM tariff_source`,
    sql`SELECT k, v FROM tariff_meta`,
  ]);

  // One entry per market, with the min- and max-bound sheets folded together.
  const markets = new Map<string, { min?: Row; max?: Row }>();
  for (const r of rows as Row[]) {
    const key = `${r.airline}\u0000${r.city_a}\u0000${r.city_b}`;
    const m = markets.get(key) ?? {};
    m[r.bound === 'min' ? 'min' : 'max'] = r;
    markets.set(key, m);
  }

  const out = [...markets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { min: lo, max: hi }]) => {
      const any = (lo ?? hi) as Row;
      const [airline, city_a, city_b] = key.split('\u0000');
      return {
        airline, city_a, city_b,
        origin: any.origin ?? null,
        destination: any.destination ?? null,
        stops: num(any.stops),
        fuel_charge_yq: num(any.fuel_charge_yq),
        n_levels: num(any.n_levels),
        min_lowest: lo ? num(lo.lowest_level) : null,
        min_highest: lo ? num(lo.highest_level) : null,
        max_lowest: hi ? num(hi.lowest_level) : null,
        max_highest: hi ? num(hi.highest_level) : null,
        min_levels: lo ? (lo.levels as number[]) : null,
        max_levels: hi ? (hi.levels as number[]) : null,
      };
    });

  const metaBy = Object.fromEntries((meta as Row[]).map((m) => [String(m.k), m.v]));
  const srcBy = Object.fromEntries(
    (sources as Row[]).map((s) => [String(s.airline), { url: s.url, found_via: s.found_via }]),
  );

  return {
    retrieved: metaBy.retrieved ?? null,
    sources: srcBy,
    n_markets: out.length,
    n_rows: (rows as Row[]).length,
    markets: out,
    ...TARIFF_NOTES,
  };
}

export async function fareSplit() {
  // Against fare_observation, not the selected view: the split panel is a
  // separate study whose rows are not part of the daily index sample.
  const rows = (await sql`
    SELECT origin, destination, carrier, lead_time_days, base_fare, taxes,
           total_fare, source, (collected_at AT TIME ZONE 'UTC')::date AS day
      FROM fare_observation
     WHERE base_fare IS NOT NULL AND taxes IS NOT NULL
     ORDER BY origin, destination, carrier
  `) as Row[];

  if (!rows.length) {
    return {
      available: false,
      reason:
        'No observation carries a base/tax split yet. ' +
        'Run `python3 apix/split_study.py`.',
      observations: null, by_carrier: null, by_route: null,
    };
  }

  const totalRows = num(
    ((await sql`SELECT COUNT(*)::int AS n FROM fare_observation`) as Row[])[0].n,
  ) as number;

  const share = (r: Row) => ((num(r.taxes) as number) / (num(r.total_fare) as number)) * 100;
  const byCarrier = new Map<string, number[]>();
  const byRoute = new Map<string, number[]>();
  const days = new Set<string>();
  const windows = new Set<number>();
  const all: number[] = [];

  for (const r of rows) {
    const s = share(r);
    all.push(s);
    const c = String(r.carrier);
    const p = `${r.origin}-${r.destination}`;
    (byCarrier.get(c) ?? byCarrier.set(c, []).get(c)!).push(s);
    (byRoute.get(p) ?? byRoute.set(p, []).get(p)!).push(s);
    days.add(isoDate(r.day) as string);
    windows.add(num(r.lead_time_days) as number);
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const summarise = (m: Map<string, number[]>, key: string) =>
    [...m.entries()]
      .map(([k, xs]) => ({
        [key]: k,
        n: xs.length,
        tax_share_pct: r2(mean(xs)),
        min_pct: r2(Math.min(...xs)),
        max_pct: r2(Math.max(...xs)),
      }))
      .sort((a, b) => (b.n as number) - (a.n as number));

  return {
    available: true,
    observations: rows.length,
    share_of_all_observations_pct: r2((rows.length / totalRows) * 100),
    routes_covered: byRoute.size,
    carriers_covered: byCarrier.size,
    study_days: [...days].sort(),
    booking_window_days: [...windows].sort((a, b) => a - b),
    source: rows[0].source,
    tax_share_pct_overall: r2(mean(all)),
    by_carrier: summarise(byCarrier, 'carrier'),
    by_route: summarise(byRoute, 'route'),
    ...SPLIT_NOTES,
  };
}
