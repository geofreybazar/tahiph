import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // The CLI migrates as tahi_migrator over a non-transaction-pooled connection.
  // Empty is fine for `prisma generate`, which needs no database.
  datasource: { url: process.env.DIRECT_URL ?? '' },
});
