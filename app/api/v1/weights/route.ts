import { handler } from '@/server/envelope';
import { cpiContext, weightsTree } from '@/server/services/reference';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => ({
  ...(await weightsTree(vintage)),
  cpi_context: await cpiContext(),
}));
