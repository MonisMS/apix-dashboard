import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // There is a stray package-lock.json in the parent directory; without this
  // Turbopack infers the workspace root from it and looks outside the repo.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },

  // Stands in for the old Vite dev proxy while the API still lives in Python.
  // A plain array lands in the `afterFiles` phase, which runs after
  // app/api/**/route.ts — so once the real route handlers exist they win and
  // this quietly stops applying to the paths they cover.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:8000/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
