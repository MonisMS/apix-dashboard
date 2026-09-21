import { handler } from '@/server/envelope';
import { cleaning } from '@/server/services/quality';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => cleaning(vintage));
