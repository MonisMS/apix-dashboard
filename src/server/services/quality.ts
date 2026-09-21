import { sql, num, isoDate } from '../db';
import type { Vintage } from '../envelope';
import { headlinePoints } from './index';

/**
 * /cleaning, /availability and /validation.
 *
 * Every number here was computed by the Python engine at publish time and is
 * read back, not recomputed. That is deliberate for each of the three:
 * cleaning's sensitivity re-runs the chaining state machine three times,
 * availability's Welch test needs sample (n-1) variance, and validation is
 * 280 lines of calendar-month alignment. Reimplementing any of them in
 * TypeScript would be a second implementation of the same statistics.
 */

type Row = Record<string, unknown>;

async function prose(v: Vintage, key: string): Promise<Record<string, any>> {
  const rows = (await sql`
    SELECT body FROM vintage_prose
     WHERE index_run_id = ${v.runId} AND key = ${key}
  `) as Row[];
  return (rows[0]?.body as Record<string, any>) ?? {};
}

export async function cleaning(v: Vintage) {
  const [header, dayRows, sensRows, flagRows] = await Promise.all([
    prose(v, 'cleaning.header'),
    sql`SELECT obs_date, n_relatives, n_extreme, n_mad, n_screened, share_screened
          FROM cleaning_day WHERE index_run_id = ${v.runId} ORDER BY obs_date`,
    sql`SELECT regime, final_raw_level, n_screened, n_cells_imputed_final,
               diff_from_unscreened_pct, error
          FROM cleaning_sensitivity WHERE index_run_id = ${v.runId}`,
    // Deterministic order, deliberately NOT the screening pass's emission
    // order. That order came from iterating observations, whose sequence
    // depends on how the store broke ties on collected_at -- SQLite's sort is
    // not stable, so the frozen snapshot's order is arbitrary and not
    // reproducible. The same 35 flags come back either way; this way the list
    // is stable between runs.
    sql`SELECT observation_id, flag, detail FROM observation_flag
         WHERE index_run_id = ${v.runId} ORDER BY observation_id, flag`,
  ]);

  const per_day: Record<string, unknown> = {};
  for (const d of dayRows as Row[]) {
    per_day[isoDate(d.obs_date) as string] = {
      n_relatives: num(d.n_relatives),
      n_extreme: num(d.n_extreme),
      n_mad: num(d.n_mad),
      n_screened: num(d.n_screened),
      share_screened: num(d.share_screened),
    };
  }

  // The three regimes publish in the order the sensitivity study runs them,
  // not alphabetically.
  const ORDER = ['none', 'hard_bound_only', 'hard_bound_and_mad'];
  const sensBy = new Map((sensRows as Row[]).map((r) => [String(r.regime), r]));
  const sensitivity: Record<string, unknown> = {};
  for (const regime of ORDER) {
    const r = sensBy.get(regime);
    if (!r) continue;
    sensitivity[regime] = r.error
      ? { error: r.error }
      : {
          final_raw_level: num(r.final_raw_level),
          n_screened: num(r.n_screened),
          n_cells_imputed_final: num(r.n_cells_imputed_final),
          diff_from_unscreened_pct: num(r.diff_from_unscreened_pct),
        };
  }

  return {
    ...header,
    per_day,
    sensitivity,
    flags: (flagRows as Row[]).map((f) => ({
      observation_id: num(f.observation_id),
      flag: f.flag,
      detail: f.detail,
    })),
  };
}

export async function availability(v: Vintage) {
  const [summary, transitions, bias] = await Promise.all([
    prose(v, 'availability.summary'),
    sql`
      SELECT from_date, to_date, n_prev, n_vanished, n_survived, n_appeared,
             vanish_rate, mean_fare_vanished, mean_fare_survived,
             median_fare_vanished, median_fare_survived, price_differential_pct,
             arithmetic_mean_differential_pct, welch_t, welch_df, significant_5pct
        FROM availability_transition WHERE index_run_id = ${v.runId}
       ORDER BY to_date
    `,
    sql`
      SELECT to_date, weight_share_vanished, excess_move_pct, index_bias_pp
        FROM availability_bias_bound WHERE index_run_id = ${v.runId}
       ORDER BY to_date, excess_move_pct
    `,
  ]);

  // index_bias_pp is published as a map keyed by the excess-movement label.
  const perDay = new Map<string, { weight_share_vanished: number | null; index_bias_pp: Record<string, number | null> }>();
  for (const b of bias as Row[]) {
    const day = isoDate(b.to_date) as string;
    const e = perDay.get(day) ?? {
      weight_share_vanished: num(b.weight_share_vanished),
      index_bias_pp: {},
    };
    e.index_bias_pp[`${(num(b.excess_move_pct) as number).toFixed(1)}%`] =
      num(b.index_bias_pp);
    perDay.set(day, e);
  }

  return {
    disappearance: {
      transitions: (transitions as Row[]).map((t) => ({
        from: isoDate(t.from_date),
        to: isoDate(t.to_date),
        n_prev: num(t.n_prev),
        n_vanished: num(t.n_vanished),
        n_survived: num(t.n_survived),
        n_appeared: num(t.n_appeared),
        vanish_rate: num(t.vanish_rate),
        mean_fare_vanished: num(t.mean_fare_vanished),
        mean_fare_survived: num(t.mean_fare_survived),
        median_fare_vanished: num(t.median_fare_vanished),
        median_fare_survived: num(t.median_fare_survived),
        price_differential_pct: num(t.price_differential_pct),
        arithmetic_mean_differential_pct: num(t.arithmetic_mean_differential_pct),
        test: {
          t: num(t.welch_t),
          df: num(t.welch_df),
          significant_5pct: t.significant_5pct === null ? null : Boolean(t.significant_5pct),
        },
      })),
      ...(summary.disappearance ?? {}),
    },
    bias_bound: {
      per_day: [...perDay.entries()].map(([to, e]) => ({ to, ...e })),
      ...(summary.bias_bound ?? {}),
    },
    observed_availability: summary.observed_availability ?? null,
  };
}

export async function validation(v: Vintage) {
  const [run, mospiRows, mospiMeta, apixMeta, points] = await Promise.all([
    sql`SELECT correlation, correlation_reason, harness, overlap
          FROM validation_run WHERE index_run_id = ${v.runId}`,
    sql`SELECT period, year, month, index_2024_base FROM mospi_point ORDER BY period`,
    prose(v, 'validation.mospi'),
    prose(v, 'validation.apix'),
    headlinePoints(v),
  ]);

  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const r = (run as Row[])[0] ?? {};

  return {
    mospi: {
      ...mospiMeta,
      points: (mospiRows as Row[]).map((m) => ({
        period: m.period,
        year: num(m.year),
        month: num(m.month),
        label: `${MONTHS[num(m.month) as number]} ${num(m.year)}`,
        index: num(m.index_2024_base),
      })),
    },
    apix: { ...apixMeta, points },
    overlap: r.overlap ?? null,
    harness: r.harness ?? null,
    correlation: num(r.correlation),
    correlation_reason: r.correlation_reason ?? null,
  };
}
