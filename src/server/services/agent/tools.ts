import type { Vintage } from '../../envelope';
import { audit, catalogue, headline } from '../index';
import {
  carrierDetail, carrierList, heatmap, routeDetail, routeList, windows,
} from '../drilldown';
import { cpiContext, fareSplit, methodologyFull, tariffs, weightsTree } from '../reference';
import { coverage as collectionCoverage, runLog, sweeps } from '../collection';
import { availability, cleaning, validation } from '../quality';
import { coverage } from '../index';

/**
 * The 18 tools the model can call.
 *
 * Each one is a thin wrapper over the SAME function the corresponding REST
 * endpoint uses. That is the property the Python module documented and it
 * matters more than any wording in the prompt: every number in a model answer
 * came from the code that serves the API, so the assistant cannot quietly
 * disagree with the dashboard beside it.
 */

const INDEX_SOURCE = 'serpapi_google_flights';

export type ToolResult = Record<string, unknown>;
type Handler = (v: Vintage, args: Record<string, any>) => Promise<ToolResult>;

const METRICS = ['pct_change', 'level', 'mean_fare', 'n_offers'];

export const HANDLERS: Record<string, Handler> = {
  get_headline_index: (v) => headline(v),

  list_routes: (v) => routeList(v),

  get_route_detail: async (v, args) => {
    const pair = String(args.pair ?? '').toUpperCase();
    const out = await routeDetail(v, pair);
    if (!out) {
      const basket = await routeList(v);
      return {
        found: false,
        requested: pair,
        reason: `'${pair}' is not one of the routes in the APIx basket.`,
        basket_routes: basket.routes.map((r) => r.pair),
      };
    }
    return { found: true, ...out };
  },

  list_carriers: (v) => carrierList(v),

  get_carrier_detail: async (v, args) => {
    const code = String(args.carrier ?? '');
    const out = await carrierDetail(v, code);
    if (!out) {
      const all = await carrierList(v);
      return {
        found: false,
        requested: code,
        reason: `'${code}' is not a carrier in the APIx data.`,
        carriers: all.carriers.map((c) => c.carrier),
      };
    }
    return { found: true, ...out };
  },

  get_booking_windows: (v) => windows(v),

  get_heatmap: async (v, args) => {
    const metric = String(args.metric ?? 'pct_change');
    if (!METRICS.includes(metric)) {
      return {
        error: `'${metric}' is not a valid metric. Use one of ${METRICS.join(', ')}.`,
      };
    }
    return heatmap(v, metric);
  },

  get_weights: async (v) => ({ ...(await weightsTree(v)), cpi_context: await cpiContext() }),

  get_collection_status: async (v) => ({
    ...(await collectionCoverage(v)),
    ...(await sweeps(INDEX_SOURCE)),
  }),

  get_collection_runs: (_v, args) => {
    // Both bounds, matching the route handler. The model supplies this, and
    // a negative value would reach LIMIT, which Postgres rejects -- the tool
    // would hand the model an error instead of data.
    const raw = Number.parseInt(String(args.limit ?? 20), 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 100);
    return runLog(limit);
  },

  get_validation: async (v) => ({ ...(await validation(v)), audit: await audit(v) }),

  get_tariffs: async (_v, args) => {
    const airline = String(args.airline ?? '').trim().toLowerCase();
    const out = await tariffs();
    const markets = out.markets;
    if (airline) {
      const matched = markets.filter((m) =>
        String(m.airline).toLowerCase().includes(airline),
      );
      return {
        ...out, markets: matched,
        n_markets_returned: matched.length,
        filtered_by_airline: airline,
      };
    }
    // Unfiltered, this is 245 markets of fare ladders -- far more than the
    // model needs, and it crowds out the rest of the context window.
    return {
      ...out,
      markets: markets.slice(0, 15),
      n_markets_returned: 15,
      truncated: true,
      note:
        `Showing 15 of ${markets.length} markets. ` +
        'Call again with an `airline` argument for that carrier\'s markets.',
    };
  },

  get_methodology: async (v) => ({
    methodology: await methodologyFull(v),
    coverage: await coverage(v),
  }),

  get_availability: (v) => availability(v),

  get_cleaning: (v) => cleaning(v),

  get_audit: (v) => audit(v),

  get_fare_split: () => fareSplit(),

  list_series: (v) => catalogue(v),
};
