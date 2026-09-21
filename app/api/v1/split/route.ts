import { handler } from '@/server/envelope';
import { fareSplit } from '@/server/services/reference';

export const revalidate = 300;

export const GET = handler(async () => ({ split: await fareSplit() }));
