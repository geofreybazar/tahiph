import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://tahi_app:pw@localhost:5432/tahi',
  REDIS_URL: 'redis://:pw@localhost:6379/0',
  APP_HOST: 'app.tahi.ph',
  ADMIN_HOST: 'admin.tahi.ph',
  API_HOST: 'api.tahi.ph',
  STOREFRONT_ROOT_DOMAIN: 'tahi.ph',
  APP_PUBLIC_URL: 'https://app.tahi.ph/',
  ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString('base64')}`,
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('rejects hosts with a scheme, port or upper case', () => {
    for (const APP_HOST of ['https://app.tahi.ph', 'app.tahi.ph:443', 'App.tahi.ph']) {
      expect(() => loadEnv({ ...valid, APP_HOST })).toThrow(InvalidEnvironmentError);
    }
  });

  it('normalizes the public URL and requires email settings consistently', () => {
    expect(loadEnv(valid).APP_PUBLIC_URL).toBe('https://app.tahi.ph');
    expect(() => loadEnv({ ...valid, EMAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/EMAIL_TRANSPORT/);
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        EMAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'k',
        APP_PUBLIC_URL: 'http://x.ph',
      }),
    ).toThrow(/https/);
  });

  it('validates the encryption key ring without echoing it', () => {
    try {
      loadEnv({ ...valid, ENCRYPTION_KEYS: 'k1:c2hvcnQ=' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('ENCRYPTION_KEYS');
      expect(String(e)).not.toContain('c2hvcnQ=');
    }
  });

  it('coerces numeric strings', () => {
    expect(loadEnv({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('fails fast listing every invalid key without echoing values', () => {
    try {
      loadEnv({ DATABASE_URL: 'mysql://secret-password@db/x', API_PORT: 'abc' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidEnvironmentError);
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('API_PORT');
      expect(message).not.toContain('secret-password');
    }
  });
});
