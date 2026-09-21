import { useMutation, useQuery } from '@tanstack/react-query';

/**
 * One place that talks to the API, so error-envelope unwrapping and the base
 * URL live in a single file. The API is app/api/v1/* in this same Next.js
 * app, so requests are same-origin and CORS never comes up.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

// Static mode reads the frozen snapshot in public/data/v1 instead of calling
// the API. It is an emergency fallback for one situation -- the database is
// unreachable -- not the normal path.
//
// It used to be the default, back when the index engine was Python and a live
// deployment needed a second host that slept on a free tier. That stopped
// being true once the engine moved to precomputing into Postgres and the API
// became route handlers in this same app.
const STATIC = process.env.NEXT_PUBLIC_API_STATIC === '1';

/** Mirror of the naming scheme in scripts/dump-static.ts. */
function staticUrl(path, params) {
  const suffix = params
    ? '__' +
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&')
    : '';
  return `${BASE}${path}${suffix}.json`;
}

export async function get(path, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const url = STATIC ? staticUrl(path, params) : `${BASE}${path}${qs}`;
  let res;
  try {
    // A timeout, not just a catch. Without one, a host that is asleep or a
    // domain that does not resolve leaves fetch pending indefinitely, the query
    // never leaves its loading state, and the user stares at blank skeletons
    // with no error. That is the worst thing that can happen on a demo screen.
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    // A network failure is the demo-day failure mode: the API is not running.
    // Say so precisely rather than surfacing "Failed to fetch".
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new Error(
      STATIC
        ? `Could not load ${url}. The static data snapshot may be missing — ` +
          `regenerate it with: npm run dump:static`
        : timedOut
          ? `The APIx API at ${BASE} did not respond within 8 seconds. If it is ` +
            `hosted on a free tier it may be asleep — reload in a few seconds.`
          : `Cannot reach the APIx API at ${BASE}. It is served by this same ` +
            `app -- check the server is running and DATABASE_URL is set.`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new Error(err ? `${err.code}: ${err.message}` : `HTTP ${res.status}`);
  }
  return body;
}

/** POST helper for AskAI -- same error-envelope unwrapping as `get`, longer
 * timeout since a tool-calling LLM round trip is slower than a DB read. */
export async function post(path, body) {
  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new Error(
      timedOut
        ? `AskAI did not respond within 30 seconds. The AI provider may be slow right now.`
        : `Cannot reach the APIx API at ${BASE}. It is served by this same ` +
          `app -- check the server is running and DATABASE_URL is set.`,
    );
  }
  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    const err = responseBody?.error;
    throw new Error(err ? err.message : `HTTP ${res.status}`);
  }
  return responseBody;
}

/** AskAI: {question, history} -> {answer, tools_used, model, ...envelope}. */
export function useAsk() {
  return useMutation({
    mutationFn: ({ question, history }) => post('/ask', { question, history }),
  });
}

/** Small wrapper so every page gets the same caching and retry behaviour. */
function useApi(key, path, params, options = {}) {
  return useQuery({
    queryKey: [key, params ?? null],
    queryFn: () => get(path, params),
    staleTime: 60_000,
    retry: 1,
    ...options,
  });
}

export const useIndex = () => useApi('index', '/index');
export const useSeries = () => useApi('series', '/series');
export const useRoutes = () => useApi('routes', '/routes');
export const useRoute = (pair) =>
  useApi(`route:${pair}`, `/routes/${pair}`, undefined, { enabled: !!pair });
export const useCarriers = () => useApi('carriers', '/carriers');
export const useCarrier = (code) =>
  useApi(`carrier:${code}`, `/carriers/${code}`, undefined, { enabled: !!code });
export const useWindows = () => useApi('windows', '/windows');
export const useHeatmap = (metric) => useApi('heatmap', '/heatmap', { metric });
export const useWeights = () => useApi('weights', '/weights');
export const useCollection = () => useApi('collection', '/collection');
export const useRunLog = () => useApi('runs', '/collection/runs', { limit: 60 });
export const useValidation = () => useApi('validation', '/validation');
export const useTariffs = () => useApi('tariffs', '/tariffs');
export const useSplit = () => useApi('split', '/split');
export const useMethodology = () => useApi('methodology', '/methodology');
export const useAudit = () => useApi('audit', '/audit');
export const useCleaning = () => useApi('cleaning', '/cleaning');
export const useAvailability = () => useApi('availability', '/availability');
export const useHealth = () => useApi('health', '/health');
