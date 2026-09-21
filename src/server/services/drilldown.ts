import { sql, num, isoDate } from '../db';
import { ApiError, type Vintage } from '../envelope';
import { coverage } from './index';

/**
 * Route, carrier and window drill-downs.
 *
 * Levels and digests are read from index_point -- they were computed by the
 * Python engine. Only fare statistics (means, medians, offer counts) are
 * aggregated here, because they are plain descriptive statistics over the
 * selected observations rather than part of the index.
 *
 * Aggregates run against v_selected_observation, never fare_observation: the
 * engine's eight standing filters plus the latest-genuine-sweep rule select
 * ~16k of 23k rows, and querying the raw table would quietly include fares the
 * index itself excluded.
 */

const PS_NAMED_FIVE = new Set([
  'IndiGo', 'Air India', 'Air India Express', 'Akasa Air', 'SpiceJet',
]);

type Row = Record<string, unknown>;

/** Latest point of each series, keyed by series_id. */
async function latestBySeries(v: Vintage, kind: string) {
  const rows = (await sql`
    SELECT DISTINCT ON (series_id) series_id, level, pct_change_1p, period_start
      FROM index_point p
     WHERE p.index_run_id = ${v.runId}
       AND p.series_id IN (SELECT series_id FROM series
                            WHERE index_run_id = ${v.runId} AND kind = ${kind})
     ORDER BY series_id, period_start DESC
  `) as Row[];
  return new Map(rows.map((r) => [String(r.series_id), r]));
}

async function seriesPoints(v: Vintage, seriesId: string) {
  const rows = (await sql`
    SELECT period_start, period_end, freq, level, pct_change_1p, repro_hash
      FROM index_point
     WHERE index_run_id = ${v.runId} AND series_id = ${seriesId}
     ORDER BY period_start
  `) as Row[];
  return rows.map((r) => ({
    period_start: isoDate(r.period_start),
    period_end: isoDate(r.period_end),
    freq: r.freq,
    level: num(r.level),
    pct_change_1p: num(r.pct_change_1p),
    repro_hash: r.repro_hash,
  }));
}

async function provenance(v: Vintage): Promise<Record<string, any>> {
  const rows = (await sql`
    SELECT ws.provenance FROM index_run r
      JOIN weight_set ws ON ws.id = r.weight_set_id
     WHERE r.id = ${v.runId}
  `) as Row[];
  return (rows[0]?.provenance as Record<string, any>) ?? {};
}

// --- routes ---------------------------------------------------------------

export async function routeList(v: Vintage) {
  const [basket, shares, latest, cells, lastDay, prov, cov] = await Promise.all([
    sql`SELECT origin, destination, city_a, city_b, pax_cy, national_share_pct
          FROM route_basket ORDER BY origin, destination`,
    sql`SELECT series_id, origin, destination, weight_share FROM series
         WHERE index_run_id = ${v.runId} AND kind = 'route'`,
    latestBySeries(v, 'route'),
    sql`SELECT origin, destination, COUNT(*)::int AS n FROM weight w
          JOIN index_run r ON r.weight_set_id = w.weight_set_id
         WHERE r.id = ${v.runId} AND w.level = 'CELL'
         GROUP BY origin, destination`,
    sql`SELECT origin, destination, COUNT(*)::int AS n,
               round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
          FROM v_selected_observation
         WHERE index_run_id = ${v.runId}
           AND obs_date = (SELECT MAX(obs_date) FROM v_selected_observation
                            WHERE index_run_id = ${v.runId})
         GROUP BY origin, destination`,
    provenance(v),
    coverage(v),
  ]);

  const shareBy = new Map(
    (shares as Row[]).map((r) => [`${r.origin}-${r.destination}`, r]),
  );
  const cellBy = new Map(
    (cells as Row[]).map((r) => [`${r.origin}-${r.destination}`, num(r.n)]),
  );
  const lastBy = new Map(
    (lastDay as Row[]).map((r) => [`${r.origin}-${r.destination}`, r]),
  );
  const provRoutes = prov?.route?.routes ?? {};

  const rows = (basket as Row[]).map((r) => {
    const pair = `${r.origin}-${r.destination}`;
    const s = shareBy.get(pair);
    const base = {
      pair,
      origin: r.origin,
      destination: r.destination,
      city_a: r.city_a,
      city_b: r.city_b,
      pax_cy: num(r.pax_cy),
      national_share_pct: num(r.national_share_pct),
      has_data: Boolean(s),
    };
    if (!s) {
      return {
        ...base, weight: 0.0, level: null, pct_change_1p: null, n_cells: 0,
        mean_fare_latest: null, n_offers_latest: 0,
        reason: 'no fares collected on this route yet',
      };
    }
    const p = latest.get(String(s.series_id));
    const l = lastBy.get(pair);
    return {
      ...base,
      weight: num(s.weight_share),
      mean_fare_base: provRoutes[pair]?.mean_fare_base ?? null,
      level: num(p?.level),
      pct_change_1p: num(p?.pct_change_1p),
      n_cells: cellBy.get(pair) ?? 0,
      mean_fare_latest: l ? num(l.mean_fare) : null,
      n_offers_latest: l ? (num(l.n) as number) : 0,
    };
  });

  rows.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  return { n_routes: rows.length, coverage: cov, routes: rows };
}

export async function routeDetail(v: Vintage, pairRaw: string) {
  const pair = pairRaw.toUpperCase();
  const [origin, destination] = pair.split('-');

  const basket = (await sql`
    SELECT origin, destination, city_a, city_b, pax_cy FROM route_basket
     WHERE origin = ${origin ?? ''} AND destination = ${destination ?? ''}
  `) as Row[];
  if (!basket.length) return null;
  const r = basket[0];

  const seriesId = `APIX.ROUTE.${pair}`;
  const [srow, points, leadRows, carriers, spread, cov] = await Promise.all([
    sql`SELECT weight_share FROM series
         WHERE index_run_id = ${v.runId} AND series_id = ${seriesId}`,
    seriesPoints(v, seriesId),
    sql`
      SELECT s.lead_time_days, s.weight_share, p.level
        FROM series s
        LEFT JOIN LATERAL (
          SELECT level FROM index_point ip
           WHERE ip.index_run_id = s.index_run_id AND ip.series_id = s.series_id
           ORDER BY period_start DESC LIMIT 1
        ) p ON true
       WHERE s.index_run_id = ${v.runId} AND s.kind = 'route_window'
         AND s.origin = ${origin} AND s.destination = ${destination}
       ORDER BY s.lead_time_days
    `,
    sql`
      SELECT carrier, COUNT(*)::int AS n_offers,
             round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare,
             MIN(total_fare) AS min_fare, MAX(total_fare) AS max_fare
        FROM v_selected_observation
       WHERE index_run_id = ${v.runId} AND origin = ${origin} AND destination = ${destination}
       GROUP BY carrier ORDER BY COUNT(*) DESC
    `,
    sql`
      SELECT obs_date, COUNT(*)::int AS n, MIN(total_fare) AS min,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY total_fare))::numeric, 2)::float8 AS median,
             round(AVG(total_fare)::numeric, 2)::float8 AS mean,
             MAX(total_fare) AS max
        FROM v_selected_observation
       WHERE index_run_id = ${v.runId} AND origin = ${origin} AND destination = ${destination}
       GROUP BY obs_date ORDER BY obs_date
    `,
    coverage(v),
  ]);

  const share = num((srow as Row[])[0]?.weight_share) ?? 0;
  const available = points.length > 0;

  // The per-lead fare means span every day, not just the latest.
  const leadFares = (await sql`
    SELECT lead_time_days, COUNT(*)::int AS n,
           round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
      FROM v_selected_observation
     WHERE index_run_id = ${v.runId} AND origin = ${origin} AND destination = ${destination}
     GROUP BY lead_time_days
  `) as Row[];
  const fareBy = new Map(leadFares.map((x) => [num(x.lead_time_days), x]));

  return {
    series_id: seriesId,
    pair,
    origin,
    destination,
    city_a: r.city_a,
    city_b: r.city_b,
    pax_cy: num(r.pax_cy),
    weight_share: share,
    has_data: available,
    availability: {
      state: available ? 'AVAILABLE' : 'NOT_COLLECTED',
      reason: available
        ? null
        : `${pair} is in the DGCA basket but the collector has never ` +
          `swept it, so it carries zero weight and has no series. This is a ` +
          `coverage gap we chose, not a failed collection.`,
    },
    reference: v.reference,
    // null, never [] -- an empty array reads as "collected, nothing moved".
    points: available ? points : null,
    by_lead_window: (leadRows as Row[]).map((x) => {
      const f = fareBy.get(num(x.lead_time_days));
      return {
        lead_time_days: num(x.lead_time_days),
        weight_share: num(x.weight_share),
        level: num(x.level),
        mean_fare: f ? num(f.mean_fare) : null,
        n_offers: f ? (num(f.n) as number) : 0,
      };
    }),
    carriers: (carriers as Row[]).map((c) => ({
      carrier: c.carrier,
      n_offers: num(c.n_offers),
      mean_fare: num(c.mean_fare),
      min_fare: num(c.min_fare),
      max_fare: num(c.max_fare),
    })),
    fare_spread: (spread as Row[]).map((s) => ({
      date: isoDate(s.obs_date),
      n: num(s.n),
      min: num(s.min),
      median: num(s.median),
      mean: num(s.mean),
      max: num(s.max),
    })),
    coverage: cov,
  };
}

// --- carriers -------------------------------------------------------------

export async function carrierList(v: Vintage) {
  const [shares, latest, cells, fares, cov] = await Promise.all([
    sql`SELECT series_id, carrier, weight_share FROM series
         WHERE index_run_id = ${v.runId} AND kind = 'carrier'`,
    latestBySeries(v, 'carrier'),
    sql`SELECT carrier, COUNT(*)::int AS n FROM weight w
          JOIN index_run r ON r.weight_set_id = w.weight_set_id
         WHERE r.id = ${v.runId} AND w.level = 'CELL' GROUP BY carrier`,
    sql`SELECT carrier, COUNT(*)::int AS n_offers,
               round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
          FROM v_selected_observation WHERE index_run_id = ${v.runId}
         GROUP BY carrier`,
    coverage(v),
  ]);

  const shareBy = new Map((shares as Row[]).map((r) => [String(r.carrier), r]));
  const cellBy = new Map((cells as Row[]).map((r) => [String(r.carrier), num(r.n)]));

  const rows = (fares as Row[]).map((f) => {
    const name = String(f.carrier);
    const s = shareBy.get(name);
    const p = s ? latest.get(String(s.series_id)) : undefined;
    return {
      carrier: name,
      weight_share: num(s?.weight_share) ?? 0,
      n_offers: num(f.n_offers) as number,
      mean_fare: num(f.mean_fare),
      n_cells: cellBy.get(name) ?? 0,
      level: num(p?.level),
      pct_change_1p: num(p?.pct_change_1p),
      in_ps_named_five: PS_NAMED_FIVE.has(name),
    };
  });
  rows.sort((a, b) => b.n_offers - a.n_offers);

  return {
    n_carriers: rows.length,
    carriers: rows,
    coverage: cov,
    note:
      'The problem statement names five carriers. Others appearing in the ' +
      'data (Star Air, Alliance Air) are priced but have no inclusion rule ' +
      'agreed yet -- see OPEN_QUESTIONS B13.',
  };
}

export async function carrierDetail(v: Vintage, code: string) {
  // Mirrors the Python slug match: exact name, or lowercase-with-hyphens.
  const rows = (await sql`
    SELECT series_id, carrier, weight_share FROM series
     WHERE index_run_id = ${v.runId} AND kind = 'carrier'
       AND (lower(carrier) = lower(${code})
            OR lower(replace(carrier, ' ', '-')) = lower(${code}))
  `) as Row[];
  if (!rows.length) return null;
  const name = String(rows[0].carrier);

  const [points, routes, byLead, cov] = await Promise.all([
    seriesPoints(v, String(rows[0].series_id)),
    sql`SELECT DISTINCT origin, destination FROM weight w
          JOIN index_run r ON r.weight_set_id = w.weight_set_id
         WHERE r.id = ${v.runId} AND w.level = 'CELL' AND w.carrier = ${name}
         ORDER BY origin, destination`,
    sql`SELECT lead_time_days, COUNT(*)::int AS n_offers,
               round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
          FROM v_selected_observation
         WHERE index_run_id = ${v.runId} AND carrier = ${name}
         GROUP BY lead_time_days ORDER BY lead_time_days`,
    coverage(v),
  ]);

  return {
    series_id: `APIX.CARRIER.${name}`,
    carrier: name,
    weight_share: num(rows[0].weight_share),
    routes: (routes as Row[]).map((r) => `${r.origin}-${r.destination}`),
    points,
    by_lead_window: (byLead as Row[]).map((r) => ({
      lead_time_days: num(r.lead_time_days),
      n_offers: num(r.n_offers),
      mean_fare: num(r.mean_fare),
    })),
    reference: v.reference,
    coverage: cov,
  };
}

// --- windows --------------------------------------------------------------

export async function windows(v: Vintage) {
  const [shares, fares, prov, cov] = await Promise.all([
    sql`SELECT series_id, lead_time_days, weight_share FROM series
         WHERE index_run_id = ${v.runId} AND kind = 'window'
         ORDER BY lead_time_days`,
    sql`SELECT lead_time_days, COUNT(*)::int AS n_offers,
               round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
          FROM v_selected_observation WHERE index_run_id = ${v.runId}
         GROUP BY lead_time_days`,
    provenance(v),
    coverage(v),
  ]);

  const fareBy = new Map((fares as Row[]).map((r) => [num(r.lead_time_days), r]));
  const leadW = prov?.lead?.weights ?? {};
  const MOSPI_COMPARABLE = new Set([15, 30]);

  const out = [];
  for (const s of shares as Row[]) {
    const lead = num(s.lead_time_days) as number;
    const f = fareBy.get(lead);
    out.push({
      series_id: String(s.series_id),
      lead_time_days: lead,
      weight_in_headline: Number(leadW[String(lead)] ?? 0),
      weight_share_of_basket: num(s.weight_share),
      mean_fare: f ? num(f.mean_fare) : null,
      n_offers: f ? (num(f.n_offers) as number) : 0,
      points: await seriesPoints(v, String(s.series_id)),
      brackets_mospi_spec: MOSPI_COMPARABLE.has(lead),
    });
  }

  return {
    windows: out,
    reference: v.reference,
    coverage: cov,
    weighting_note:
      'Uniform 0.2 per window is a DECLARED ASSUMPTION, not a ' +
      'derived booking-lag distribution and not attributed to ' +
      'anyone. ONS collects domestic air fares at a single window; ' +
      'its 10:45:45 split is long-haul only.',
    mospi_note:
      "MoSPI's domestic spec is 21 days advance purchase. T+15 and " +
      'T+30 bracket it; neither equals it.',
  };
}

// --- heatmap --------------------------------------------------------------

const METRICS = new Set(['pct_change', 'level', 'mean_fare', 'n_offers']);

export async function heatmap(v: Vintage, metric = 'pct_change') {
  if (!METRICS.has(metric)) {
    throw new ApiError('BAD_METRIC', `Unknown metric '${metric}'.`, 400, {
      allowed: [...METRICS],
    });
  }

  const [dates, routeSeries, cov] = await Promise.all([
    sql`SELECT obs_date FROM collection_day_stat
         WHERE index_run_id = ${v.runId} ORDER BY obs_date`,
    sql`SELECT series_id, origin, destination FROM series
         WHERE index_run_id = ${v.runId} AND kind = 'route'
         ORDER BY origin, destination`,
    coverage(v),
  ]);

  const xLabels = (dates as Row[]).map((r) => isoDate(r.obs_date) as string);
  const yLabels = (routeSeries as Row[]).map((r) => `${r.origin}-${r.destination}`);

  // One query per metric family rather than per cell.
  const values = new Map<string, number | null>();
  if (metric === 'pct_change' || metric === 'level') {
    const rows = (await sql`
      SELECT s.origin, s.destination, p.period_start, p.level, p.pct_change_1p
        FROM series s JOIN index_point p
          ON p.index_run_id = s.index_run_id AND p.series_id = s.series_id
       WHERE s.index_run_id = ${v.runId} AND s.kind = 'route'
    `) as Row[];
    for (const r of rows) {
      const key = `${r.origin}-${r.destination}|${isoDate(r.period_start)}`;
      values.set(key, metric === 'level' ? num(r.level) : num(r.pct_change_1p));
    }
  } else {
    const rows = (await sql`
      SELECT origin, destination, obs_date, COUNT(*)::int AS n,
             round(AVG(total_fare)::numeric, 2)::float8 AS mean_fare
        FROM v_selected_observation WHERE index_run_id = ${v.runId}
       GROUP BY origin, destination, obs_date
    `) as Row[];
    for (const r of rows) {
      const key = `${r.origin}-${r.destination}|${isoDate(r.obs_date)}`;
      values.set(key, metric === 'mean_fare' ? num(r.mean_fare) : num(r.n));
    }
  }

  const data = [];
  for (const pair of yLabels) {
    for (const date of xLabels) {
      const val = values.get(`${pair}|${date}`);
      // n_offers is a count: absent means zero, not unknown.
      data.push({
        x: date,
        y: pair,
        value: val === undefined ? (metric === 'n_offers' ? 0 : null) : val,
      });
    }
  }

  return {
    metric,
    x_labels: xLabels,
    y_labels: yLabels,
    data,
    note:
      `${xLabels.length} collection days so far, so the matrix has ` +
      `${xLabels.length} columns. The first column has no day-on-day change ` +
      `by definition.`,
    coverage: cov,
  };
}
