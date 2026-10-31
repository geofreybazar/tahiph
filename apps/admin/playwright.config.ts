import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Separate ports, so these run alongside `npm run dev` without touching it.
const API_PORT = 4101;
const ADMIN_PORT = 5174;
const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;
const API_URL = `http://localhost:${API_PORT}/api/v1`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  // The journeys share two tenants. A retry would see its own earlier data, so failures stay failures.
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ADMIN_URL,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT), CORS_ORIGINS: ADMIN_URL, ADMIN_APP_URL: ADMIN_URL },
    },
    {
      command: `npx vite --port ${ADMIN_PORT}`,
      url: ADMIN_URL,
      reuseExistingServer: false,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
