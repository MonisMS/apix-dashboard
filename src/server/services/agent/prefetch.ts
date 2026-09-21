/**
 * Question -> tool routing, resolved before the model is ever called.
 *
 * Why this exists. A tool-calling answer costs two model calls: one that
 * decides which tool to use, and one that writes the answer from the result.
 * On OpenRouter's free tier that is two of fifty daily requests per account,
 * and the deciding call is most of the latency for a question whose tool is
 * obvious to anyone reading it -- "which route is cheapest" was never going
 * to need anything but list_routes.
 *
 * So for recognised question shapes the tool is run up front, in parallel,
 * and its result is handed to the model with the question. The model then
 * answers in ONE call: roughly half the wall clock and half the quota. Tools
 * stay available, so an unanticipated question still works the old way, and
 * a recognised question that needs something extra can still ask for it.
 *
 * Every tool here takes no arguments, which is what makes running it blind
 * safe: there is no parameter to guess wrong. get_route_detail needs a pair,
 * so it is matched only from an explicit IATA pair in the question.
 */

/** At most this many tools are prefetched, to bound the added latency. */
const MAX_PREFETCH = 3;

interface Rule {
  test: RegExp;
  tools: string[];
}

/**
 * Ordered: the first two matching rules win. Deliberately mapped to the
 * dashboard's own suggested questions first, since those are the ones most
 * likely to be asked and the ones that must never disappoint.
 */
const RULES: Rule[] = [
  // "Why did fares move this week?" -- needs the series AND the per-route
  // moves, because "why" is answered by naming which routes did the moving.
  {
    test: /\b(why|what).{0,30}\b(move|moved|change|changed|rise|rose|fall|fell|drop|up|down)\b|\bthis week\b|\btrend\b/i,
    tools: ['get_headline_index', 'list_routes'],
  },
  { test: /\bcarrier|\bairline|\bindigo\b|\bvistara\b|\bspicejet\b|\bair india\b/i, tools: ['list_carriers'] },
  { test: /\bcheapest|most expensive|priciest|lowest fare|highest fare|compare.{0,20}routes?\b/i, tools: ['list_routes'] },
  { test: /\bheadline\b|\bindex level\b|\bcurrent index\b|\bhow (is|has) the index\b|\btoday'?s level\b/i, tools: ['get_headline_index'] },
  // "walk me through how the index is calculated" reaches past methodology
  // into weights and coverage; giving it only the formulas is what let it
  // invent a reference window length and a claim about MoSPI publishing.
  {
    test: /\bend to end\b|\bworkflow\b|\bstart to (end|finish)\b|\bwhole process\b|\bstep by step\b|how do (you|we) (calculate|compute|build)/i,
    tools: ['get_methodology', 'get_weights', 'get_headline_index'],
  },
  { test: /\bjevons\b|\byoung\b|\bformula|\bmethodolog|how (is|are) the index (built|computed|calculated)/i, tools: ['get_methodology'] },
  { test: /\bbooking window|\blead time|\badvance (purchase|booking)|\bt\+\d+/i, tools: ['get_booking_windows'] },
  { test: /\bweight|\bbasket\b|\bexpenditure share/i, tools: ['get_weights'] },
  { test: /\bmospi\b|\bvalidat|\bofficial\b|\bcompare.{0,20}(against|with|to)\b/i, tools: ['get_validation'] },
  { test: /\bwhere.{0,25}data.{0,15}(come|from)|\bdata source|\bhow .{0,15}collect|\bcoverage\b|\bfresh|\bscrape/i, tools: ['get_collection_status'] },
  { test: /\bimput|\bclean|\boutlier|\bmissing (price|fare)/i, tools: ['get_cleaning'] },
  { test: /\btax\b|\bbase fare\b|\bsplit\b/i, tools: ['get_fare_split'] },
  { test: /\btariff|\brule 135\b|\bpublished fare/i, tools: ['get_tariffs'] },
];

/** A route pair written out, e.g. "DEL-BOM" or "del to bom". */
const PAIR = /\b([A-Z]{3})\s*(?:-|–|to)\s*([A-Z]{3})\b/i;

export interface Prefetch {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Which tools to run before the first model call. Empty means "let the model
 * decide", which is the correct answer for anything not recognised here.
 */
export function prefetchFor(question: string): Prefetch[] {
  const out: Prefetch[] = [];

  const pair = question.match(PAIR);
  if (pair) {
    out.push({
      tool: 'get_route_detail',
      args: { pair: `${pair[1].toUpperCase()}-${pair[2].toUpperCase()}` },
    });
  }

  for (const rule of RULES) {
    if (out.length >= MAX_PREFETCH) break;
    if (!rule.test.test(question)) continue;
    for (const tool of rule.tools) {
      if (out.length >= MAX_PREFETCH) break;
      if (!out.some((p) => p.tool === tool)) out.push({ tool, args: {} });
    }
  }

  return out;
}
