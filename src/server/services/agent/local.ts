import type { Vintage } from '../../envelope';
import { headline } from '../index';
import { routeList } from '../drilldown';
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
