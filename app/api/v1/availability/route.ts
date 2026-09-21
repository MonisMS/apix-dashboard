import { handler } from '@/server/envelope';
import { availability } from '@/server/services/quality';

export const revalidate = 300;

export const GET = handler(async ({ vintage }) => availability(vintage));
