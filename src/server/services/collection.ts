import { sql, num, isoDate } from '../db';
import type { Vintage } from '../envelope';

/**
 * The collection log: what was actually swept, when, and how.
 *
 * The sweep-timing arithmetic is done in SQL with named timezones, not ported
 * to JavaScript. The Python original parses a naive-UTC string, adds a
 * hardcoded +5:30, then anchors against the same day's 10:45 -- a `Date`-based
 * port would silently apply the container's timezone (UTC on Vercel, IST on a
 * developer laptop) and produce plausible-looking wrong drift minutes. Naming
 * 'Asia/Kolkata' in the query removes the ambiguity entirely.
 */

type Row = Record<string, unknown>;

/** The nominal scheduled slot every day is labelled against. */
const NOMINAL_IST = '10:45';
const INDEX_SOURCE_NOTE = 'Daily fare sweep';

export async function coverage(v: Vintage) {
  const [
    basket, attemptedRows, withFaresRows, backfill, backfillSrc, backfillRoutes,
    dayRows, summary, cellRows, exclusions, runHeader,
  ] = await Promise.all([
    sql`SELECT origin, destination, pax_cy FROM route_basket ORDER BY origin, destination`,
    sql`SELECT DISTINCT origin, destination FROM collection_run`,
    sql`SELECT DISTINCT origin, destination FROM fare_observation
         WHERE NOT starts_with(source, 'external_')`,
    sql`SELECT COUNT(*)::int AS n, MIN(obs_date) AS lo, MAX(obs_date) AS hi
          FROM fare_observation WHERE starts_with(source, 'external_')`,
    sql`SELECT DISTINCT source FROM fare_observation
         WHERE starts_with(source, 'external_')`,
    sql`SELECT DISTINCT origin, destination FROM fare_observation
         WHERE starts_with(source, 'external_') ORDER BY origin, destination`,
    sql`
      WITH obs AS (
        SELECT obs_date, COUNT(*)::int AS n_obs,
               MIN(collected_at) AS lo, MAX(collected_at) AS hi,
               array_agg(DISTINCT run_id) AS runs
          FROM fare_observation
         WHERE NOT starts_with(source, 'external_')
         GROUP BY obs_date
      ), att AS (
        SELECT start_date,
               COUNT(*)::int AS attempts,
               COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
               COUNT(*) FILTER (WHERE status <> 'OK')::int AS failed
          FROM collection_run GROUP BY start_date
      )
      SELECT o.obs_date, o.n_obs, o.runs,
             COALESCE(a.attempts, 0) AS attempts,
             COALESCE(a.ok, 0) AS ok,
             COALESCE(a.failed, 0) AS failed,
             to_char(o.lo AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist_first,
             to_char(o.hi AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist_last,
             to_char(o.lo AT TIME ZONE 'UTC', 'HH24:MI') AS utc_first,
             to_char(o.hi AT TIME ZONE 'UTC', 'HH24:MI') AS utc_last,
             round(EXTRACT(EPOCH FROM (
                 (o.lo AT TIME ZONE 'Asia/Kolkata')
               - (date_trunc('day', o.lo AT TIME ZONE 'Asia/Kolkata')
                  + interval '10 hours 45 minutes')
             )) / 60)::int AS drift_minutes
        FROM obs o LEFT JOIN att a ON a.start_date = o.obs_date
       ORDER BY o.obs_date
    `,
    sql`
      SELECT (SELECT COUNT(*)::int FROM fare_observation
               WHERE NOT starts_with(source, 'external_')) AS observations,
             (SELECT COUNT(*)::int FROM collection_run) AS collection_runs,
             (SELECT COUNT(DISTINCT run_id)::int FROM collection_run) AS sweeps
    `,
    sql`SELECT obs_date, n_cells FROM collection_day_stat WHERE index_run_id = ${v.runId}`,
    sql`SELECT run_id, reason FROM sweep_exclusion WHERE index_run_id = ${v.runId}`,
    sql`SELECT n_obs_in, n_obs_selected FROM index_run WHERE id = ${v.runId}`,
  ]);

  // First-appearance order, not alphabetical: SQLite returned these in table
  // scan order and the published snapshot records that order.
  const sources = (await sql`
    SELECT source FROM fare_observation
     WHERE NOT starts_with(source, 'external_')
     GROUP BY source ORDER BY MIN(id)
  `) as Row[];

  const inBasket = (basket as Row[]).map((r) => `${r.origin}-${r.destination}`);
  const attempted = new Set(
    (attemptedRows as Row[]).map((r) => `${r.origin}-${r.destination}`),
  );
  const withFares = new Set(
    (withFaresRows as Row[]).map((r) => `${r.origin}-${r.destination}`),
  );
  const cellsBy = new Map(
    (cellRows as Row[]).map((r) => [isoDate(r.obs_date), num(r.n_cells)]),
  );

  const days = (dayRows as Row[]).map((d) => ({
    date: isoDate(d.obs_date),
    n_observations: num(d.n_obs),
    n_cells: cellsBy.get(isoDate(d.obs_date)) ?? 0,
    n_runs: (d.runs as string[]).length,
    runs: [...(d.runs as string[])].sort(),
    attempts: num(d.attempts),
    ok: num(d.ok),
    failed: num(d.failed),
    nominal_time_ist: NOMINAL_IST,
    actual_ist: { first: d.ist_first, last: d.ist_last },
    drift_minutes: num(d.drift_minutes),
    hour_spread: { first: d.utc_first, last: d.utc_last },
  }));

  const varies = new Set(days.map((d) => String(d.actual_ist.first).slice(0, 2))).size > 1;

  const paxBy = new Map(
    (basket as Row[]).map((r) => [`${r.origin}-${r.destination}`, num(r.pax_cy) as number]),
  );
  const paxTotal = [...paxBy.values()].reduce((a, b) => a + b, 0);
  const paxCovered = [...paxBy.entries()]
    .filter(([p]) => withFares.has(p))
    .reduce((a, [, n]) => a + n, 0);
  const nationalRows = (await sql`
    SELECT v FROM basket_meta WHERE k = 'national_total_pax'
  `) as Row[];
  const nationalTotal = num(nationalRows[0]?.v) ?? 0;

  const bf = (backfill as Row[])[0];
  const s = (summary as Row[])[0];
  const hdr = (runHeader as Row[])[0];

  return {
    summary: {
      observations: num(s.observations),
      rows_considered: num(hdr.n_obs_in),
      rows_selected: num(hdr.n_obs_selected),
      collection_runs: num(s.collection_runs),
      sweeps: num(s.sweeps),
      days: days.length,
      sources: (sources as Row[]).map((r) => r.source),
    },
    backfill: {
      rows: num(bf.n),
      date_range: num(bf.n) ? [isoDate(bf.lo), isoDate(bf.hi)] : null,
      sources: (backfillSrc as Row[]).map((r) => r.source),
      routes: (backfillRoutes as Row[]).map((r) => `${r.origin}-${r.destination}`),
      note:
        "Pre-window historical rows imported from other teams' public " +
        'repos/APIs to cover dates before our own collection started ' +
        '(2026-09-10). Not a live sweep, no collection_run behind it, ' +
        'and excluded from the index (config.INDEX_SOURCE keeps the ' +
        'series on one price source). Kept separate from every count ' +
        'and table above so this page still describes only what we ' +
        'actually ran.',
    },
    days,
    clock: {
      nominal_time_ist: NOMINAL_IST,
      schedule:
        'cron 15 5 * * * (05:15 UTC / 10:45 IST), .github/workflows/collect.yml',
      nominal_note:
        'Every day is labelled with the scheduled slot, the ' +
        'way a price is labelled to a reference period rather ' +
        'than to the minute it was written down. The actual ' +
        'clock time is kept beside it and is never overwritten.',
      actual_ist_observed: days.map((d) => d.actual_ist.first),
      max_abs_drift_minutes: days.length
        ? Math.max(...days.map((d) => Math.abs(num(d.drift_minutes) as number)))
        : 0,
      varies_across_days: varies,
      warning: varies
        ? 'Actual collection hour varies across days, so part of the ' +
          'measured movement is the clock, not the market. These were ' +
          'the manual bootstrap days; the schedule above is what ' +
          'unattended runs follow.'
        : null,
    },
    routes: {
      in_basket: inBasket.length,
      attempted: inBasket.filter((r) => attempted.has(r)).length,
      with_fares: inBasket.filter((r) => withFares.has(r)).length,
      never_attempted: inBasket.filter((r) => !attempted.has(r)).sort(),
      attempted_but_no_fares: inBasket
        .filter((r) => attempted.has(r) && !withFares.has(r))
        .sort(),
      basket_pax_covered_pct: Number(((100 * paxCovered) / paxTotal).toFixed(2)),
      national_pax_covered_pct: Number(((100 * paxCovered) / nationalTotal).toFixed(2)),
    },
    sweep_selection: {
      rule:
        'Per (date, route, lead), the latest genuine sweep that covered ' +
        'it wins. Selection is per cell, not per day: 2026-09-10 is the ' +
        'union of four partial sweeps and has no single complete one.',
      excluded_runs: Object.fromEntries(
        (exclusions as Row[]).map((r) => [String(r.run_id), r.reason]),
      ),
      genuineness_screen:
        "A sweep whose fetches arrive faster than the collector's own " +
        'rate limit cannot be live collection. Nothing is excluded at present.',
    },
  };
}

export async function sweeps(indexSource: string, limit = 50) {
  // Span is computed in SQL: a JS Date holds milliseconds, and these
  // timestamps carry microseconds, so subtracting Dates loses precision that
  // shows up in seconds_per_fetch.
  const rows = (await sql`
    SELECT run_id,
           to_char(MIN(started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           to_char(MIN(started_at) AT TIME ZONE 'UTC', 'HH24:MI:SS') AS started,
           to_char(MAX(started_at) AT TIME ZONE 'UTC', 'HH24:MI:SS') AS ended,
           EXTRACT(EPOCH FROM (MAX(started_at) - MIN(started_at)))::float8 AS span,
           COUNT(*)::int AS fetches, SUM(n_quotes)::int AS quotes,
           COUNT(*) FILTER (WHERE status = 'OK')::int AS ok,
           COUNT(*) FILTER (WHERE status <> 'OK')::int AS failed,
           MIN(source) AS source
      FROM collection_run GROUP BY run_id ORDER BY MIN(started_at) DESC
     LIMIT ${limit}
  `) as Row[];

  const out = rows.map((r) => {
    const span = num(r.span) as number;
    const fetches = num(r.fetches) as number;
    return {
      run_id: r.run_id,
      date: r.day,
      started: r.started,
      ended: r.ended,
      fetches,
      quotes: num(r.quotes) ?? 0,
      ok: num(r.ok) ?? 0,
      failed: num(r.failed) ?? 0,
      span_seconds: Number(span.toFixed(1)),
      seconds_per_fetch: Number((span / Math.max(fetches - 1, 1)).toFixed(2)),
      source: r.source,
      feeds_index: r.source === indexSource,
      kind: r.source === indexSource ? INDEX_SOURCE_NOTE : 'Base fare / tax study',
    };
  });

  return { n_sweeps: out.length, sweeps: out };
}

export async function runLog(limit = 200) {
  const rows = (await sql`
    SELECT run_id, origin, destination, lead_time_days, departure_date,
           source, status, n_quotes, elapsed_ms, error,
           -- .US keeps the microseconds; a JS Date would truncate to
           -- milliseconds and silently shorten every timestamp.
           to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
             AS started_at
      FROM collection_run ORDER BY started_at DESC LIMIT ${limit}
  `) as Row[];
  return {
    n_runs: rows.length,
    runs: rows.map((r) => ({
      run_id: r.run_id,
      route: `${r.origin}-${r.destination}`,
      lead_time_days: num(r.lead_time_days),
      departure_date: isoDate(r.departure_date),
      source: r.source,
      status: r.status,
      n_quotes: num(r.n_quotes),
      elapsed_ms: num(r.elapsed_ms),
      error: r.error,
      started_at: r.started_at,
    })),
  };
}
