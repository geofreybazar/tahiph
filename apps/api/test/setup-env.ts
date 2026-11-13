import { randomBytes } from 'node:crypto';

// Test defaults for env values that are not secrets. Real DATABASE_URL/REDIS_URL for
// integration tests come from the environment (CI services or local setup).
process.env.APP_HOST ??= 'app.tahi.test';
process.env.ADMIN_HOST ??= 'admin.tahi.test';
process.env.API_HOST ??= 'api.tahi.test';
process.env.LOG_LEVEL ??= 'silent';
process.env.STOREFRONT_ROOT_DOMAIN ??= 'tahi.test';
process.env.APP_PUBLIC_URL ??= 'http://app.tahi.test';
process.env.STOREFRONT_URL_TEMPLATE ??= 'http://{host}';
// Test-only key, generated per run.
process.env.ENCRYPTION_KEYS ??= `test:${randomBytes(32).toString('base64')}`;
// Local RustFS (docker-compose.yml); CI sets its own. Not secrets: a throwaway test store.
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'tahi-test';
process.env.S3_ACCESS_KEY_ID ??= 'tahi-test';
process.env.S3_SECRET_ACCESS_KEY ??= 'tahi-test-secret';
