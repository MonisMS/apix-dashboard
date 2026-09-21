import { handler } from '@/server/envelope';
import { audit } from '@/server/services/index';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => audit(vintage));
