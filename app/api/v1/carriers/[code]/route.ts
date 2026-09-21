import { ApiError, handler } from '@/server/envelope';
import { carrierDetail, carrierList } from '@/server/services/drilldown';

export const revalidate = 300;

export const GET = handler(async ({ vintage, params }) => {
  // Next has already decoded the path segment. Decoding again turns a
  // literal '%' into an invalid escape and throws URIError, which the
  // handler renders as a 500 -- instead of the 404 this route defines for
  // an unknown carrier. carrierDetail matches both the exact name and the
  // hyphenated slug, so the decoded value is what it wants.
  const code = params.code ?? '';
  const out = await carrierDetail(vintage, code);
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
