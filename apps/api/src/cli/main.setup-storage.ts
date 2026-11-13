/**
 * Create and configure the local/CI uploads bucket (RustFS). Idempotent.
 *
 *   npm run setup-storage -w @tahi/api      (reads apps/api/.env when present)
 *
 * Requires S3_* and APP_PUBLIC_URL (the dashboard origin allowed to PUT uploads).
 */
import { envSchema } from '../core/config/env.js';
import { setupStorage } from './setup-storage.js';

const parsed = envSchema
  .pick({
    S3_ENDPOINT: true,
    S3_REGION: true,
    S3_BUCKET: true,
    S3_ACCESS_KEY_ID: true,
    S3_SECRET_ACCESS_KEY: true,
    APP_PUBLIC_URL: true,
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error(
    `Invalid storage settings: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
  );
  process.exit(2);
}

setupStorage(parsed.data, [parsed.data.APP_PUBLIC_URL])
  .then(() => process.stdout.write(`Bucket ${parsed.data.S3_BUCKET} is ready.\n`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
