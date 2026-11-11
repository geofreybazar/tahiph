import type { NextConfig } from 'next';
import path from 'node:path';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Nonce-based CSP is added with authentication in Phase 2 (docs/SECURITY.md).
];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default config;
