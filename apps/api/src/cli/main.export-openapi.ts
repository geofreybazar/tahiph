/**
 * Writes the OpenAPI document (ADR-023):
 *   node dist/cli/main.export-openapi.js openapi.json
 * Compiles the real AppModule without listening or connecting to anything.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../app.module.js';
import { openApiDocumentOf } from '../core/http/openapi.factory.js';

async function main(): Promise<void> {
  const out = process.argv[2] ?? 'openapi.json';
  // Env values are only read, not used to connect; placeholders keep the export self-contained.
  process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@127.0.0.1:1/openapi';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
  process.env.APP_HOST ??= 'app.tahi.ph';
  process.env.ADMIN_HOST ??= 'admin.tahi.ph';
  process.env.API_HOST ??= 'api.tahi.ph';
  process.env.STOREFRONT_ROOT_DOMAIN ??= 'tahi.ph';
  process.env.APP_PUBLIC_URL ??= 'https://app.tahi.ph';
  process.env.ENCRYPTION_KEYS ??= `export:${Buffer.alloc(32).toString('base64')}`;
  process.env.LOG_LEVEL ??= 'silent';
  process.env.S3_ENDPOINT ??= 'http://127.0.0.1:1';
  process.env.S3_BUCKET ??= 'openapi';
  process.env.S3_ACCESS_KEY_ID ??= 'openapi';
  process.env.S3_SECRET_ACCESS_KEY ??= 'openapi';
  const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
  writeFileSync(
    out,
    `${JSON.stringify(openApiDocumentOf(ref, process.env.npm_package_version ?? '0.0.0'), null, 2)}\n`,
  );
  await ref.close();
  process.stdout.write(`Wrote ${out}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
