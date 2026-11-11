import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { dataEnvelope, healthReportSchema } from '@tahi/validation';
import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/core/http/configure-app.js';

type App = Parameters<typeof request>[0];

/**
 * Integration: boots the real AppModule against real PostgreSQL and Redis.
 * Requires DATABASE_URL and REDIS_URL (provided by CI services or docker-compose.yml).
 */
describe('Health (integration: real PostgreSQL + Redis)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
      throw new Error('Integration tests require DATABASE_URL and REDIS_URL');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports database and redis as up', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/health/ready')
      .expect(200);
    expect(dataEnvelope(healthReportSchema).parse(res.body).data).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });
});
