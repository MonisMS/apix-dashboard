import { handler } from '@/server/envelope';
import { audit } from '@/server/services/index';
import { validation } from '@/server/services/quality';

export const revalidate = 300;

// The endpoint appends the transitivity audit to the validation payload.
export const GET = handler(async ({ vintage }) => ({
  ...(await validation(vintage)),
  audit: await audit(vintage),
}));
