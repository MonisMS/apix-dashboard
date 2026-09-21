import { sql, num, isoDate } from '../db';
import { METHODOLOGY } from '../notes';
import type { Vintage } from '../envelope';

/**
 * Drill-downs over the published vintage.
 *
 * Nothing here computes an index. Every level, link and digest was produced by
 * the Python engine and written by apix/store/publish.py; this layer selects
 * and reshapes. If you find yourself wanting to multiply two numbers together
 * to make a level, that belongs in the engine, not here.
 */

export async function coverage(v: Vintage) {
  const [basket, withData, days] = await Promise.all([
    sql`SELECT origin, destination FROM route_basket ORDER BY origin, destination`,
    sql`
      SELECT DISTINCT origin, destination
        FROM v_selected_observation WHERE index_run_id = ${v.runId}
    `,
    sql`
      SELECT MIN(obs_date) AS first, MAX(obs_date) AS last, COUNT(*)::int AS n
        FROM collection_day_stat WHERE index_run_id = ${v.runId}
    `,
  ]);

  const inBasket = (basket as Record<string, string>[]).map(
    (r) => `${r.origin}-${r.destination}`,
  );
  const have = new Set(
    (withData as Record<string, string>[]).map((r) => `${r.origin}-${r.destination}`),
  );
  const d = (days as Record<string, unknown>[])[0];

  return {
    n_points: num(d.n),
    first_date: isoDate(d.first),
    last_date: isoDate(d.last),
    routes_in_basket: inBasket.length,
    routes_with_data: have.size,
    routes_without_fares: inBasket.filter((r) => !have.has(r)),
    frequencies_available: ['D'],
    frequencies_pending: {
      W: 'needs two complete ISO weeks of collection',
      M: 'needs one complete calendar month of collection',
    },
    is_provisional: v.reference.is_provisional,
    note:
      'Offered fares, not transacted fares. The reference window is ' +
      'provisional and will be re-referenced without revising any link.',
  };
}

/** Shape a stored row into the published point. The caller supplies series_id. */
function shapePoint(r: Record<string, unknown>) {
  return {
    freq: r.freq,
    period_start: isoDate(r.period_start),
    period_end: isoDate(r.period_end),
    level: num(r.level),
    link: num(r.link),
    n_cells: num(r.n_cells),
    n_cells_imputed: num(r.n_cells_imputed),
    n_cells_thin: num(r.n_cells_thin),
    n_cells_dead: num(r.n_cells_dead),
    n_items_matched: num(r.n_items_matched),
    n_items_prev: num(r.n_items_prev),
    n_items_screened: num(r.n_items_screened),
    weight_covered: num(r.weight_covered),
    weight_imputed: num(r.weight_imputed),
    n_days: num(r.n_days),
    is_provisional: Boolean(r.is_provisional),
    quality: (r.quality as string[]) ?? [],
    repro_hash: r.repro_hash,
  };
}

export async function headlinePoints(v: Vintage) {
  const rows = (await sql`
    SELECT period_start, period_end, freq, level, link, n_cells, n_cells_imputed,
           n_cells_thin, n_cells_dead, n_items_matched, n_items_prev,
           n_items_screened, weight_covered, weight_imputed, n_days,
           is_provisional, quality, repro_hash
      FROM index_point
     WHERE index_run_id = ${v.runId} AND series_id = 'APIX.ALL'
     ORDER BY period_start
  `) as Record<string, unknown>[];
  return rows.map((r) => ({ series_id: 'APIX.ALL', ...shapePoint(r) }));
}

export async function naiveComparison(v: Vintage) {
  const [pts, meta] = await Promise.all([
    sql`
      SELECT period_start, level, n_obs FROM naive_point
       WHERE index_run_id = ${v.runId} ORDER BY period_start
    `,
    sql`
      SELECT naive_base_day, naive_divergence_pp FROM index_run WHERE id = ${v.runId}
    `,
  ]);
  const rows = pts as Record<string, unknown>[];
  if (!rows.length) return { points: [], note: 'needs at least two collection days' };
  const m = (meta as Record<string, unknown>[])[0];
  return {
    series_id: 'APIX.NAIVE_UNMATCHED',
    label: 'Unmatched mean fare (not the index)',
    is_simulated: false,
    points: rows.map((r) => ({
      period_start: isoDate(r.period_start),
      period_end: isoDate(r.period_start),
      freq: 'D',
      level: num(r.level),
      n_obs: num(r.n_obs),
    })),
    base_day: isoDate(m.naive_base_day),
    divergence_pp: num(m.naive_divergence_pp),
    note:
      'The arithmetic mean of every fare quoted that day, indexed to ' +
      'the first collection day. Same observations as the published ' +
      'index, no matching. The gap is sample churn being reported as ' +
      'inflation.',
  };
}

export async function methodology(v: Vintage) {
  const rows = (await sql`
    SELECT ws.provenance
      FROM index_run r JOIN weight_set ws ON ws.id = r.weight_set_id
     WHERE r.id = ${v.runId}
  `) as Record<string, unknown>[];
  return { ...METHODOLOGY, weights: rows[0]?.provenance ?? null };
}

export async function headline(v: Vintage) {
  const [points, cov, naive, meth] = await Promise.all([
    headlinePoints(v),
    coverage(v),
    naiveComparison(v),
    methodology(v),
  ]);
  return {
    series_id: 'APIX.ALL',
    reference: v.reference,
    methodology: meth,
    coverage: cov,
    weight_share: 1.0,
    points,
    naive_comparison: naive,
  };
}

export async function catalogue(v: Vintage) {
  const rows = (await sql`
    SELECT series_id, kind, weight_share
      FROM series WHERE index_run_id = ${v.runId}
       -- route_window is an internal series backing route_detail's
       -- by_lead_window block; it was never part of the public catalogue.
       AND kind <> 'route_window'
     ORDER BY CASE kind WHEN 'headline' THEN 0 WHEN 'route' THEN 1
                        WHEN 'carrier' THEN 2 ELSE 3 END,
              -- Windows sort by lead time, not by name: alphabetically
              -- APIX.LEAD.T15 precedes T7, which is not the order
              -- config.LEAD_TIMES defines or the dashboard expects.
              COALESCE(lead_time_days, 0), series_id
  `) as Record<string, unknown>[];
  return {
    n_series: rows.length,
    series: rows.map((r) => ({
      series_id: r.series_id,
      kind: r.kind,
      weight_share: num(r.weight_share),
    })),
    note:
      "Sub-series share the headline's reference factor so they are " +
      'directly comparable. They do not re-aggregate to the headline ' +
      'unless the subset partitions the basket.',
  };
}

export async function audit(v: Vintage) {
  const [runRows, churnRows] = await Promise.all([
    sql`
      SELECT audit_chained_raw_level, audit_direct_fixed_base, audit_drift_pct
        FROM index_run WHERE id = ${v.runId}
    `,
    sql`
      SELECT obs_date, items_matched, items_prev, match_rate, cells_imputed, cells_thin
        FROM audit_churn WHERE index_run_id = ${v.runId} ORDER BY obs_date
    `,
  ]);
  const r = (runRows as Record<string, unknown>[])[0];
  const churn: Record<string, unknown> = {};
  for (const c of churnRows as Record<string, unknown>[]) {
    churn[isoDate(c.obs_date) as string] = {
      items_matched: num(c.items_matched),
      items_prev: num(c.items_prev),
      match_rate: num(c.match_rate),
      cells_imputed: num(c.cells_imputed),
      cells_thin: num(c.cells_thin),
    };
  }
  return {
    transitivity: {
      chained_raw_level: num(r.audit_chained_raw_level),
      direct_fixed_base: num(r.audit_direct_fixed_base),
      drift_pct: num(r.audit_drift_pct),
      note:
        'Jevons is transitive (Manual 8.383), so on a CONSTANT sample ' +
        'these are identical. The gap is caused by sample churn: cells ' +
        'matched day-to-day but not first-to-last, and vice versa.',
    },
    churn,
  };
}
