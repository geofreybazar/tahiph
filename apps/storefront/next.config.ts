import type { NextConfig } from 'next';
import path from 'node:path';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Storefront pages are tenant-specific: caches must key on Host (docs/TECHNICAL_RISKS.md R6).
  { key: 'Vary', value: 'Host' },
];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default config;
