import { sql, num } from '@/server/db';
import { API_VERSION, nowIst } from '@/server/envelope';

// Liveness: never cached, and it must answer even when no vintage exists.
export const dynamic = 'force-dynamic';

/** Bump alongside apix/store/migrations/. */
const EXPECTED_PG_SCHEMA = 3;

export async function GET() {
  try {
    const [obsRows, schemaRows, runRows, writeRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n, MAX(collected_at) AS last FROM fare_observation`,
      sql`SELECT MAX(version)::int AS v FROM pg_schema_version`,
      sql`
        SELECT run_uid, computed_at, status, n_collection_days
          FROM index_run WHERE status = 'PUBLISHED'
      `,
      // The FastAPI service enforced "the API never writes" with a read-only
      // SQLite handle. That guarantee has to be re-stated here, so report
      // whether the role this process connects as can actually write.
      sql`
        SELECT has_table_privilege(current_user, 'fare_observation', 'INSERT') AS can_write,
               current_user AS role
      `,
    ]);

    const obs = (obsRows as Record<string, unknown>[])[0];
    const schema = num((schemaRows as Record<string, unknown>[])[0]?.v);
    const run = (runRows as Record<string, unknown>[])[0] ?? null;
    const perm = (writeRows as Record<string, unknown>[])[0];

    const ok = schema === EXPECTED_PG_SCHEMA && run !== null;

    return Response.json({
      status: ok ? 'ok' : 'degraded',
      api_version: API_VERSION,
      served_at: nowIst(),
      database: {
        backend: 'neon-postgres',
        schema_version: schema,
        expected_schema_version: EXPECTED_PG_SCHEMA,
        observations: num(obs.n),
        last_collected_at: obs.last,
        role: perm.role,
        api_can_write: Boolean(perm.can_write),
      },
      // Replaces the old in-process `cache` block. There is no cache to report:
      // the index is precomputed by the pipeline, not built per request.
      vintage: run
        ? {
            run_uid: run.run_uid,
            computed_at: run.computed_at,
            status: run.status,
            n_collection_days: num(run.n_collection_days),
          }
        : null,
    });
  } catch (e) {
    return Response.json(
      {
        status: 'degraded',
        api_version: API_VERSION,
        served_at: nowIst(),
        error: { code: 'DATABASE_UNREACHABLE', message: (e as Error).message },
      },
      { status: 503 },
    );
  }
}
