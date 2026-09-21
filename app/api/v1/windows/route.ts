import { handler } from '@/server/envelope';
import { windows } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => windows(vintage));
