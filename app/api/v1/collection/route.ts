import { handler } from '@/server/envelope';
import { coverage, sweeps } from '@/server/services/collection';

export const revalidate = 300;

/** Frozen product spec: the index is pinned to one price source. */
const INDEX_SOURCE = 'serpapi_google_flights';

export const GET = handler(async ({ vintage }) => ({
  ...(await coverage(vintage)),
  ...(await sweeps(INDEX_SOURCE)),
}));
