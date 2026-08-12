import path from 'node:path';

import type { NextConfig } from 'next';

/**
 * The console never talks to eyego-api from the browser. Every call goes through
 * a server-side route handler or a server component (see lib/api.ts), because
 * the admin bearer token — and, during the switchover, ADMIN_SECRET_KEY — must
 * never reach client JavaScript. A leaked admin credential is total API access.
 *
 * That is also why there are no NEXT_PUBLIC_ variables holding anything secret:
 * anything prefixed NEXT_PUBLIC_ is inlined into the client bundle.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The monorepo root installs React Native / Expo for the two mobile apps.
  // Tracing from the app directory keeps those out of the Vercel bundle.
  outputFileTracingRoot: __dirname,

  /**
   * Yarn v1 hoists `next` and `react` to the monorepo root but keeps `react-dom`
   * inside this workspace, because the two mobile apps do not depend on it. That
   * breaks the build: webpack resolves `react-dom/client` from next's own files,
   * which live in the root node_modules and never walk back down into a
   * workspace. Adding this directory as a fallback resolution root fixes it
   * without requiring a particular hoisting layout — it applies wherever the app
   * is installed, including a Vercel build rooted at apps/admin.
   */
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      ...(config.resolve.modules || ['node_modules']),
      path.join(__dirname, 'node_modules'),
    ];
    return config;
  },

  eslint: {
    // Type errors still fail the build (see typescript below); this only stops
    // a missing eslint config from blocking deploys.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          // The console is internal tooling and must never be indexed.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
