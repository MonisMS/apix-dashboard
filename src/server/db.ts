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
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Put the pooled Neon connection string in ' +
      '.env.local (local) or the Vercel project settings (deployed).',
  );
}

export const sql = neon(url, { types });

/** Several independent queries in a single HTTP round trip. */
export const tx = sql.transaction.bind(sql);

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
