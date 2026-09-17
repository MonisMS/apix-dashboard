import { useQuery } from '@tanstack/react-query';

/**
 * One place that talks to the API, so error-envelope unwrapping and the base
 * URL live in a single file. In dev the Vite proxy forwards /api to uvicorn.
 */
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

// In static mode the dashboard reads files instead of calling a service. The
// index engine is Python, so a live deployment would need a Python host; on a
// free tier that host sleeps, and a cold start in front of judges is a poor
// trade for a series that changes once a day. The FastAPI service is unchanged
// and still runs locally -- it is what generates these files.
const STATIC = import.meta.env.VITE_API_STATIC === '1';

/** Mirror of the naming scheme in api/dump_static.py. */
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
          `regenerate it with: python3 -m api.dump_static`
        : timedOut
          ? `The APIx API at ${BASE} did not respond within 8 seconds. If it is ` +
            `hosted on a free tier it may be asleep — reload in a few seconds.`
          : `Cannot reach the APIx API at ${BASE}. Start it locally with: ` +
            `uvicorn api.main:app --port 8000`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new Error(err ? `${err.code}: ${err.message}` : `HTTP ${res.status}`);
  }
  return body;
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
