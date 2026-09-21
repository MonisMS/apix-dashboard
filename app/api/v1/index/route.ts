import { handler } from '@/server/envelope';
import { headline } from '@/server/services/index';

export const revalidate = 300; // the series changes once a day

export const GET = handler(async ({ vintage, searchParams }) => ({
  ...(await headline(vintage)),
  // ?refresh= is accepted for compatibility with the FastAPI service but can
  // no longer do anything: only the Python publisher can recompute a vintage.
  ...(searchParams.has('refresh') ? { refresh_ignored: true } : {}),
}));
