import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // There is a stray package-lock.json in the parent directory; without this
  // Turbopack infers the workspace root from it and looks outside the repo.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },

  // The dev proxy to the old Python API at :8000 has been removed. Its
  // comment claimed that real route handlers in app/api/** would win over an
  // afterFiles rewrite, and for static segments they did -- but DYNAMIC ones
  // did not. /api/v1/carriers resolved locally while
  // /api/v1/carriers/IndiGo and /api/v1/routes/DEL-BOM were proxied to a
  // FastAPI service that no longer runs, so both returned 500 in development
  // (production was unaffected, because the rewrite was dev-only). The API is
  // app/api/v1/** now; there is nothing left to proxy to.
};

export default nextConfig;
