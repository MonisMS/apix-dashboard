import { handler } from '@/server/envelope';
import { runLog } from '@/server/services/collection';

// Reads ?limit=, so it must stay dynamic.
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ searchParams }) => {
  const raw = Number.parseInt(searchParams.get('limit') ?? '200', 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 200, 1), 1000);
  return runLog(limit);
});
