import { handler } from '@/server/envelope';
import { coverage } from '@/server/services/index';
import { methodologyFull } from '@/server/services/reference';

export const revalidate = 300;

// Wrapped, not spread: the FastAPI endpoint returned
// {methodology: ..., coverage: ...} under the envelope.
export const GET = handler(async ({ vintage }) => ({
  methodology: await methodologyFull(vintage),
  coverage: await coverage(vintage),
}));
