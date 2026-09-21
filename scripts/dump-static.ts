/**
 * Freeze the live API into public/data/v1/.
 *
 *   npm run dump:static            # into public/data/v1
 *   npm run dump:static -- --check # exit 1 if the snapshot is older than the vintage
 *
 * This is the emergency fallback the dashboard serves when
 * NEXT_PUBLIC_API_STATIC=1: the database is unreachable, the compute
 * allowance is gone, a deploy went wrong. Flip one env var and the site
 * still renders real numbers.
 *
 * It imports the SAME service functions the route handlers use and wraps
 * them in the SAME envelope, so the snapshot is a frozen copy of the API
 * rather than a second implementation of it. That distinction is the whole
 * point: the previous snapshot was produced by a Python FastAPI test client
 * over SQLite, which meant two programs had to agree about 42 files, and
 * they eventually didn't.
 *
 * It runs as a prebuild step, so the snapshot in any deployment matches the
 * data at build time and is never committed. A stored snapshot is a trap --
 * someone flips to it under pressure and serves last week's index.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Load .env.local for local runs. On Vercel the variables are already in the
// environment and no file exists, which is fine.
for (const file of ['.env.local', '.env.production.local']) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { envelope, loadVintage } = await import('../src/server/envelope');
const idx = await import('../src/server/services/index');
const drill = await import('../src/server/services/drilldown');
const ref = await import('../src/server/services/reference');
const coll = await import('../src/server/services/collection');
const qual = await import('../src/server/services/quality');

const INDEX_SOURCE = 'serpapi_google_flights';
const OUT = path.resolve(process.cwd(), 'public', 'data', 'v1');

type Vintage = Awaited<ReturnType<typeof loadVintage>>;
type Target = { file: string; run: (v: Vintage) => Promise<object> };

/**
 * Filenames mirror staticUrl() in src/api.js: `<path><suffix>.json`, where
 * suffix is '__' + sorted `k=v` pairs joined by '&'. Change one and the
 * dashboard silently 404s in fallback mode.
 */
const TARGETS: Target[] = [
  { file: 'index', run: (v) => idx.headline(v) },
  { file: 'series', run: (v) => idx.catalogue(v) },
  { file: 'audit', run: (v) => idx.audit(v) },
  { file: 'routes', run: (v) => drill.routeList(v) },
  { file: 'carriers', run: (v) => drill.carrierList(v) },
  { file: 'windows', run: (v) => drill.windows(v) },
  { file: 'heatmap', run: (v) => drill.heatmap(v) },
  { file: 'heatmap__metric=pct_change', run: (v) => drill.heatmap(v, 'pct_change') },
  { file: 'heatmap__metric=level', run: (v) => drill.heatmap(v, 'level') },
  { file: 'heatmap__metric=mean_fare', run: (v) => drill.heatmap(v, 'mean_fare') },
  { file: 'heatmap__metric=n_offers', run: (v) => drill.heatmap(v, 'n_offers') },
  { file: 'weights', run: async (v) => ({ ...(await ref.weightsTree(v)), cpi_context: await ref.cpiContext() }) },
  { file: 'methodology', run: async (v) => ({ methodology: await ref.methodologyFull(v), coverage: await idx.coverage(v) }) },
  { file: 'tariffs', run: () => ref.tariffs() },
  { file: 'split', run: async () => ({ split: await ref.fareSplit() }) },
  { file: 'collection', run: async (v) => ({ ...(await coll.coverage(v)), ...(await coll.sweeps(INDEX_SOURCE)) }) },
  { file: 'collection/runs', run: () => coll.runLog(200) },
  { file: 'collection/runs__limit=60', run: () => coll.runLog(60) },
  { file: 'cleaning', run: (v) => qual.cleaning(v) },
  { file: 'availability', run: (v) => qual.availability(v) },
  { file: 'validation', run: async (v) => ({ ...(await qual.validation(v)), audit: await idx.audit(v) }) },
];

function write(file: string, body: unknown): number {
  const dest = path.join(OUT, `${file}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = JSON.stringify(body, null, 1);
  fs.writeFileSync(dest, text);
  return Buffer.byteLength(text);
}

async function main() {
  const check = process.argv.includes('--check');
  const v = await loadVintage();

  if (check) {
    const manifest = path.join(OUT, '_manifest.json');
    if (!fs.existsSync(manifest)) {
      console.error('  no snapshot found -- run: npm run dump:static');
      return 1;
    }
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const stale = m.run_uid !== v.runUid;
    console.log(`  snapshot vintage : ${m.run_uid}`);
    console.log(`  database vintage : ${v.runUid}`);
    console.log(stale ? '  STALE' : '  current');
    return stale ? 1 : 0;
  }

  // Rebuild from scratch: a file left behind by a previous basket would be
  // served forever otherwise.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const files: string[] = [];
  let bytes = 0;

  for (const t of TARGETS) {
    const payload = await t.run(v);
    bytes += write(t.file, envelope(v, payload));
    files.push(`${t.file}.json`);
  }

  // The per-route and per-carrier families are discovered from the data, not
  // hardcoded, so a basket change is picked up without editing this file.
  const routes = (await drill.routeList(v)).routes.filter((r) => r.has_data);
  for (const r of routes) {
    const detail = await drill.routeDetail(v, r.pair as string);
    if (!detail) continue;
    bytes += write(`routes/${r.pair}`, envelope(v, detail));
    files.push(`routes/${r.pair}.json`);
  }

  const carriers = (await drill.carrierList(v)).carriers;
  for (const c of carriers) {
    const detail = await drill.carrierDetail(v, c.carrier as string);
    if (!detail) continue;
    bytes += write(`carriers/${c.carrier}`, envelope(v, detail));
    files.push(`carriers/${c.carrier}.json`);
  }

  // /health has to exist -- the API page requests it, and a missing file is a
  // 404 in fallback mode. But it must not answer "ok": this file is served
  // exactly when the database cannot be reached, so a frozen "ok" would be a
  // lie. It reports what it actually is.
  bytes += write('health', {
    status: 'snapshot',
    api_version: '1.0.0',
    served_at: null,
    database: {
      backend: 'neon-postgres',
      reachable: null,
      note:
        'This is a frozen snapshot served because NEXT_PUBLIC_API_STATIC=1. ' +
        'It cannot report live database health -- the live endpoint at ' +
        '/api/v1/health does that.',
    },
    vintage: {
      run_uid: v.runUid,
      n_collection_days: v.nCollectionDays,
      status: 'PUBLISHED',
    },
  });
  files.push('health.json');

  const manifest = {
    generated_at: new Date().toISOString().slice(0, 19),
    run_uid: v.runUid,
    n_files: files.length,
    bytes,
    files: files.sort(),
    note:
      'Frozen copy of the live API, generated from the published vintage by ' +
      'scripts/dump-static.ts during the build. Served only when ' +
      'NEXT_PUBLIC_API_STATIC=1. Do not edit or commit by hand.',
  };
  write('_manifest', manifest);

  console.log(`  wrote ${files.length + 1} files (${(bytes / 1024).toFixed(0)} KB) from vintage ${v.runUid}`);
  return 0;
}

// An incomplete dump is a failure, not a warning: a half-written fallback is
// worse than none, because the pages that are missing fail only when used.
//
// --tolerant is the one exception, and it exists for a specific trap. The
// snapshot is generated from the database it is a fallback FOR. If the build
// hard-failed whenever Neon was unreachable, then during an outage you could
// not deploy at all -- including the deploy that would flip the site over to
// the fallback. The prebuild step therefore warns and continues; every other
// caller stays strict.
const tolerant = process.argv.includes('--tolerant');

main()
  .then((code) => process.exit(tolerant && code !== 0 ? 0 : code))
  .catch((e) => {
    const msg = e?.message ?? String(e);
    if (tolerant) {
      console.warn(`  WARNING: snapshot not regenerated (${msg}).`);
      console.warn('  The build continues, but this deployment carries no');
      console.warn('  static fallback. Fix the database before relying on it.');
      process.exit(0);
    }
    console.error('  dump failed:', msg);
    process.exit(1);
  });
