import { handler } from '@/server/envelope';
import { heatmap } from '@/server/services/drilldown';

// Reads ?metric=, so it must stay dynamic; force-static would make
// searchParams come back empty and silently pin it to one metric.
export const dynamic = 'force-dynamic';

export const GET = handler(async ({ vintage, searchParams }) =>
  heatmap(vintage, searchParams.get('metric') ?? 'pct_change'),
);
