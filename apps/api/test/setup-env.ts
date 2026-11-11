// Test defaults for env values that are not secrets. Real DATABASE_URL/REDIS_URL for
// integration tests come from the environment (CI services or local setup).
process.env.APP_HOST ??= 'app.tahi.test';
process.env.ADMIN_HOST ??= 'admin.tahi.test';
process.env.API_HOST ??= 'api.tahi.test';
process.env.LOG_LEVEL ??= 'silent';
process.env.STOREFRONT_ROOT_DOMAIN ??= 'tahi.test';
process.env.APP_PUBLIC_URL ??= 'http://app.tahi.test';
