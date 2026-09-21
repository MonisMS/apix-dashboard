import { handler } from '@/server/envelope';
import { carrierList } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => carrierList(vintage));
