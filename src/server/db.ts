import { neon, types as pgTypes } from '@neondatabase/serverless';

// Postgres OIDs. DATE values are parsed by default into a JS Date at LOCAL
// midnight, so .toISOString() shifts them a day backwards anywhere east of
// UTC -- in IST every obs_date came out one day early. A calendar date has no
// timezone, so it is kept as the 'YYYY-MM-DD' text Postgres already sent.
const DATE_OID = 1082;
const DATE_ARRAY_OID = 1182;

const types = {
  getTypeParser(oid: number, format?: unknown) {
    if (oid === DATE_OID) return (v: string) => v;
    if (oid === DATE_ARRAY_OID) {
      return (v: string) =>
        v === '{}' ? [] : v.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/"/g, ''));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pgTypes as any).getTypeParser(oid, format);
  },
};

/**
 * Neon over HTTP rather than a TCP pool.
 *
 * Every endpoint here is read-only and most run one to five independent
 * SELECTs. HTTP query mode has no connection handshake at all, which is the
 * right shape for a serverless function that lives for a few tens of
 * milliseconds; a pg.Pool would pay TCP + TLS + auth on every cold invocation
 * and could not reuse the pool across them anyway.
 *
 * DATABASE_URL must be the POOLED (-pooler) Neon host. The non-pooled endpoint
 * is for the Python publisher, which needs session-scoped advisory locks.
 */
/**
 * Created on first query, not at module load.
 *
 * Throwing at import time means the route function never starts, so a missing
 * DATABASE_URL surfaces as an opaque platform 500 with nothing in the body --
 * which is the least useful moment and the least useful message. Deferring it
 * lets the error travel through the normal handler path and come back as a
 * readable JSON envelope.
 */
let client: ReturnType<typeof neon> | null = null;

function connection(): ReturnType<typeof neon> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new DatabaseNotConfigured(
      'DATABASE_URL is not set. Put the pooled Neon connection string in ' +
        '.env.local locally, or in the Vercel project settings for a ' +
        'deployment -- for Preview as well as Production, since the build ' +
        'reads it too.',
    );
  }
  client = neon(url, { types });
  return client;
}

/** Recognised by the route wrapper, which turns it into a 503. */
export class DatabaseNotConfigured extends Error {}

export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connection() as any)(strings, ...values)) as ReturnType<typeof neon>;

/**
 * Postgres int8/numeric arrive as JavaScript strings, which serialise into
 * JSON as `"20"` and break every downstream comparison. Handlers cast with
 * ::int in SQL; this is the backstop for anything that slips through.
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A YYYY-MM-DD string. With the DATE parser above, `date` columns already
 * arrive as text; the Date branch is a backstop for timestamp columns, and it
 * uses local components rather than toISOString() for the same reason.
 */
export function isoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
