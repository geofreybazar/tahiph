import { type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { apiErrorSchema, dataEnvelope, healthReportSchema } from '@tahi/validation';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../core/config/config.module.js';
import { ContextModule } from '../../core/context/context.module.js';
import { UNSCOPED_PRISMA } from '../../core/database/database.module.js';
import { configureApp } from '../../core/http/configure-app.js';
import { HttpModule } from '../../core/http/http.module.js';
import { REDIS } from '../../core/redis/redis.module.js';
import { HealthModule } from './health.module.js';

type App = Parameters<typeof request>[0];

/**
 * HTTP-level tests of the full request pipeline (prefix, versioning, envelope, error filter,
 * request ids) with database and Redis replaced by fakes. Real dependencies are covered by
 * test/health.int.spec.ts.
 */
const fakes = { dbUp: true, redisUp: true };

@Module({
  providers: [
    {
      provide: UNSCOPED_PRISMA,
      useValue: {
        $queryRaw: () => (fakes.dbUp ? Promise.resolve([1]) : Promise.reject(new Error('down'))),
      },
    },
    {
      provide: REDIS,
      useValue: {
        status: 'ready',
        ping: () => (fakes.redisUp ? Promise.resolve('PONG') : Promise.reject(new Error('down'))),
      },
    },
  ],
  exports: [UNSCOPED_PRISMA, REDIS],
})
class FakeInfraModule {}

describe('Health endpoints (HTTP pipeline)', () => {
  let app: INestApplication;
  const server = (): App => app.getHttpServer() as App;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        ContextModule,
        HttpModule,
        { module: FakeInfraModule, global: true },
        HealthModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health/live returns the success envelope and a request id', async () => {
    const res = await request(server()).get('/api/health/live').expect(200);
    expect(
      dataEnvelope(z.object({ status: z.literal('ok') }))
        .strict()
        .parse(res.body),
    ).toEqual({
      data: { status: 'ok' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores client-supplied request ids', async () => {
    const res = await request(server())
      .get('/api/health/live')
      .set('X-Request-Id', 'attacker-controlled')
      .expect(200);
    expect(res.headers['x-request-id']).not.toBe('attacker-controlled');
  });

  it('GET /api/health/ready returns 200 when dependencies are up', async () => {
    fakes.dbUp = true;
    fakes.redisUp = true;
    const res = await request(server()).get('/api/health/ready').expect(200);
    const body = dataEnvelope(healthReportSchema).parse(res.body);
    expect(body.data).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('GET /api/health/ready returns 503 with the error envelope when a dependency is down', async () => {
    fakes.dbUp = false;
    const res = await request(server()).get('/api/health/ready').expect(503);
    const { error } = apiErrorSchema.parse(res.body);
    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: [{ path: ['database'], message: 'down' }],
    });
    expect(error.requestId).toBe(res.headers['x-request-id']);
    fakes.dbUp = true;
  });

  it('unknown routes return a 404 error envelope', async () => {
    const res = await request(server()).get('/api/v1/does-not-exist').expect(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('health is not exposed under the versioned prefix', async () => {
    await request(server()).get('/api/v1/health/live').expect(404);
  });
});
