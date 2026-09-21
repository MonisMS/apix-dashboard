import { handler } from '@/server/envelope';
import { routeList } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => routeList(vintage));
