import type { Vintage } from '../../envelope';
import { headline } from '../index';
import { routeList } from '../drilldown';
import { coverage } from '../collection';
import { BUDGET, LOCAL_TOPICS } from './constants';

/**
 * The deterministic answer path: no model, no network.
 *
 * This is the outermost guarantee of the endpoint. Whatever happens to the
 * provider -- no key, a 402, a timeout, a malformed response -- the user gets
 * a real answer built from real data, labelled with the tier that produced
 * it. The `note` always says which, so a canned answer can never pass itself
 * off as a generated one.
 */

export interface LocalAnswer {
  answer: string;
  tier: string;
  model: string | null;
  tools_used: { tool: string; arguments: Record<string, unknown> }[];
  note: string;
}

const rupees = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** A handful of common data-shaped questions, answered from a real query. */
async function directAnswer(
  v: Vintage,
  question: string,
): Promise<[string, LocalAnswer['tools_used']] | null> {
  const q = question.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => q.includes(k));

  if (has('cheapest', 'cheaper', 'lowest fare')) {
    const routes = (await routeList(v)).routes.filter(
      (r) => r.has_data && r.mean_fare_latest != null,
    );
    if (!routes.length) {
      return [
        "No basket route has both fares and a computed level yet, so I can't " +
          'name a cheapest route.',
        [],
      ];
    }
    const r = routes.reduce((a, b) =>
      (a.mean_fare_latest as number) <= (b.mean_fare_latest as number) ? a : b,
    );
    const tail =
      r.pct_change_1p != null
        ? ` (index level ${r.level}, day-on-day change ${signed(r.pct_change_1p)})`
        : ` (index level ${r.level})`;
    return [
      `By latest mean offered fare, **${r.pair}** is currently cheapest at ` +
        `roughly ${rupees(r.mean_fare_latest as number)}${tail}.`,
      [{ tool: 'list_routes', arguments: {} }],
    ];
  }

  // "Why did fares move this week?" -- the dashboard's first suggested
  // question, which previously had no local answer at all and fell through
  // to the generic "I don't have a prepared answer" reply.
  //
  // Note what this deliberately does NOT do: compute a percentage change
  // between two index levels. Arithmetic on levels belongs in
  // backend/apix/index/, so this quotes the published endpoints of the
  // window and the backend's own per-route pct_change_1p instead.
  if (
    has('why did', 'why have', 'what drove', 'fares move', 'fares moved', 'prices move') ||
    (has('this week') && has('move', 'change', 'happen'))
  ) {
    const h = await headline(v);
    const pts = h.points;
    if (pts.length < 2) {
      return [
        `Only ${pts.length} daily point has been published so far, so there is no ` +
          'movement to explain yet. The index needs at least two collection days.',
        [{ tool: 'get_headline_index', arguments: {} }],
      ];
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    const routes = (await routeList(v)).routes.filter((r) => r.pct_change_1p != null);
    const ranked = [...routes].sort(
      (a, b) => (b.pct_change_1p as number) - (a.pct_change_1p as number),
    );
    const up = ranked.filter((r) => (r.pct_change_1p as number) > 0).slice(0, 3);
    const down = ranked.filter((r) => (r.pct_change_1p as number) < 0).slice(-3).reverse();

    const lines = [
      `The headline **APIx.ALL** index is at **${last.level}** (${last.period_end}), ` +
        `against **${first.level}** on ${first.period_end}, the first day of the window.`,
      '',
      'On the latest day, the routes that moved most were:',
    ];
    for (const r of up) lines.push(`- **${r.pair}** ${signed(r.pct_change_1p as number)}`);
    for (const r of down) lines.push(`- **${r.pair}** ${signed(r.pct_change_1p as number)}`);
    if (!up.length && !down.length) lines.push('- no route recorded a day-on-day move');
    lines.push('');
    lines.push(
      'These are offered fares, not transacted fares, and the window is still ' +
        'provisional.',
    );
    return [
      lines.join('\n'),
      [
        { tool: 'get_headline_index', arguments: {} },
        { tool: 'list_routes', arguments: {} },
      ],
    ];
  }

  // "Where does the data come from?" -- likewise a suggested question with
  // no local answer. Answered from the live collection record rather than a
  // canned description, so it cannot drift from what was actually collected.
  if (
    has('where does the data', 'where do the fares', 'data come from', 'data source') ||
    (has('source', 'sources') && has('data', 'fare', 'collect'))
  ) {
    const c = await coverage(v);
    const sum = c.summary;
    const lines = [
      `Fares are collected by our own sweeps and stored in Postgres: ` +
        `**${sum.observations?.toLocaleString('en-IN')} observations** over ` +
        `**${sum.days} collection days**, from ${sum.collection_runs} runs.`,
      '',
      `- Live sources: ${sum.sources.length ? sum.sources.join(', ') : 'none recorded'}`,
    ];
    if (c.backfill?.rows) {
      lines.push(
        `- Backfill: ${c.backfill.rows.toLocaleString('en-IN')} pre-window rows` +
          (c.backfill.sources?.length ? ` from ${c.backfill.sources.join(', ')}` : '') +
          ' -- imported history, not our own sweep, and flagged as such',
      );
    }
    lines.push('');
    lines.push(
      'Every published point carries a `repro_hash` over the exact links and ' +
        'weights behind it. These are offered fares, not transacted fares.',
    );
    return [lines.join('\n'), [{ tool: 'get_collection_status', arguments: {} }]];
  }

  if (has('no data', 'not collected', 'missing route', 'no fares', 'which routes', 'what routes')) {
    const routes = (await routeList(v)).routes;
    const missing = routes.filter((r) => !r.has_data).map((r) => r.pair);
    if (!missing.length) {
      return [
        `Every one of the ${routes.length} basket routes has fares collected -- none are missing.`,
        [{ tool: 'list_routes', arguments: {} }],
      ];
    }
    return [
      `${missing.length} of ${routes.length} basket routes have no fares collected ` +
        `yet: ${missing.join(', ')}. They're in the DGCA basket but carry zero ` +
        `weight until the collector sweeps them.`,
      [{ tool: 'list_routes', arguments: {} }],
    ];
  }

  if (has('headline', 'current index', 'index level', 'how has the index', 'index move')) {
    const h = await headline(v);
    const pts = h.points;
    if (!pts.length) return ['No headline points are published yet.', []];
    const last = pts[pts.length - 1];
    // Headline points carry no pct_change_1p -- only sub-series do. The Python
    // read it with .get(), so this clause never fired there either; the
    // sentence is built without it rather than inventing a day-on-day move.
    return [
      `The headline APIx.ALL index is at **${last.level}** as of ` +
        `${last.period_end}. Reference window: ${h.reference.label ?? 'n/a'}.`,
      [{ tool: 'get_headline_index', arguments: {} }],
    ];
  }

  return null;
}

export async function answerLocally(v: Vintage, question: string): Promise<LocalAnswer> {
  const lowered = question.toLowerCase();

  const direct = await directAnswer(v, question);
  if (direct) {
    const [answer, tools_used] = direct;
    return {
      answer, tier: BUDGET.TIER_LOCAL, model: null, tools_used,
      note: 'Answered directly from live data, without a language model.',
    };
  }

  for (const topic of LOCAL_TOPICS) {
    if (topic.keywords.some((k) => lowered.includes(k))) {
      return {
        answer: topic.answer, tier: BUDGET.TIER_LOCAL, model: null, tools_used: [],
        note:
          'Answered from the local methodology knowledge base, without ' +
          'a language model.',
      };
    }
  }

  const h = await headline(v);
  const last = h.points.length ? h.points[h.points.length - 1] : null;
  const summary = last
    ? `Headline index: **${last.level}** as of ${last.period_end}.\n`
    : 'No headline points are published yet.\n';

  return {
    answer:
      "I don't have a prepared answer for that, and no language model is available " +
      "right now, so I won't speculate.\n\n" + summary +
      '\nI can explain: the Jevons/Young formulas, booking-window stratification, ' +
      'route and carrier weights, the MoSPI validation status, data collection ' +
      'coverage, cleaning/imputation, the base-fare/tax split, or published ' +
      'tariffs -- or ask which route or carrier you want the numbers for.',
    tier: BUDGET.TIER_LOCAL,
    model: null,
    tools_used: [{ tool: 'get_headline_index', arguments: {} }],
    note: 'Answered from the local knowledge base, without a language model.',
  };
}
