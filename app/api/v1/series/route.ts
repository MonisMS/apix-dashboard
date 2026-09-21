import { handler } from '@/server/envelope';
import { catalogue } from '@/server/services/index';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => catalogue(vintage));
