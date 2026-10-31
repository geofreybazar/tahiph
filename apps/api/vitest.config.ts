import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { API_URL } from './test/db-urls';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    globalSetup: ['test/global-db-setup.ts'],
    env: {
      DATABASE_URL: API_URL,
      SUPABASE_JWT_ISSUER: 'https://test.supabase.co/auth/v1',
      SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
      SUPABASE_URL: 'https://test.supabase.co',
      ADMIN_APP_URL: 'https://app.test',
      SUPABASE_SECRET_KEY: 'test-only',
    },
  },
  // Nest's dependency injection needs decorator metadata, which Vite's own transform drops.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
