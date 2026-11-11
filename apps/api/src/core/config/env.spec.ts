import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://tahi_app:pw@localhost:5432/tahi',
  REDIS_URL: 'redis://:pw@localhost:6379/0',
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 3000, LOG_LEVEL: 'info' });
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
