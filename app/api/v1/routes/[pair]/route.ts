import { ApiError, handler } from '@/server/envelope';
import { routeDetail, routeList } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage, params }) => {
  const pair = (params.pair ?? '').toUpperCase();
  const out = await routeDetail(vintage, pair);
  if (!out) {
    const basket = await routeList(vintage);
    throw new ApiError(
      'ROUTE_NOT_FOUND',
      `No route '${pair}' in the APIx basket.`,
      404,
      { requested: pair, basket_routes: basket.routes.map((r) => r.pair) },
    );
  }
  return out;
});
