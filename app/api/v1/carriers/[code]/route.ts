import { ApiError, handler } from '@/server/envelope';
import { carrierDetail, carrierList } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage, params }) => {
  const code = params.code ?? '';
  const out = await carrierDetail(vintage, decodeURIComponent(code));
  if (!out) {
    const all = await carrierList(vintage);
    throw new ApiError(
      'CARRIER_NOT_FOUND',
      `No carrier '${code}' in the APIx data.`,
      404,
      { requested: code, carriers: all.carriers.map((c) => c.carrier) },
    );
  }
  return out;
});
