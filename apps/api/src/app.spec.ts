import { Body, Controller, Get, HttpCode, Module, Post, Query } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { paginationQuerySchema } from '@tahi/shared';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env, parseEnv } from './common/config/env';
import { ApiException } from './common/http/api-exception';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { Paginated } from './common/http/paginated';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';

class CreateThingDto extends createZodDto(z.object({ name: z.string().min(1) })) {}
class ListDto extends createZodDto(paginationQuerySchema) {}

@Controller('things')
class ThingsController {
  @Post()
  create(@Body() body: CreateThingDto) {
    return body;
  }

  @Get()
  list(@Query() query: ListDto) {
    return new Paginated([{ id: 1 }], query, 41);
  }

  @Post('empty')
  @HttpCode(204)
  empty() {
    return { ignored: true };
  }

  @Get('conflict')
  conflict() {
    throw new ApiException(409, 'CONFLICT', 'Already voided');
  }

  @Get('boom')
  boom() {
    throw new Error('secret database detail');
  }
}

@Module({
  controllers: [ThingsController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
class ThingsModule {}

const baseEnv = {
  DATABASE_URL: 'postgresql://x',
  SUPABASE_JWT_ISSUER: 'https://test.supabase.co/auth/v1',
  SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only',
};

async function start(moduleClass: unknown, env: Partial<Env> = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [moduleClass as typeof ThingsModule],
  })
    .setLogger(false as never)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, {
    NODE_ENV: 'test',
    PORT: 0,
    CORS_ORIGINS: ['https://app.tahi.ph'],
    TRUST_PROXY_HOPS: 0,
    ...baseEnv,
    ...env,
  });
  await app.init();
  return app;
}

describe('HTTP contract', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await start(ThingsModule);
  });
  afterAll(() => app.close());

  it('wraps a success in the envelope', async () => {
    const res = await http().post('/api/v1/things').send({ name: 'Gown' }).expect(201);
    expect(res.body).toEqual({
      success: true,
      data: { name: 'Gown' },
      timestamp: expect.any(String),
    });
  });

  it('includes meta and timestamp on paginated responses', async () => {
    const res = await http().get('/api/v1/things?page=2&limit=20').expect(200);
    expect(res.body.meta).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
    expect(res.body.timestamp).toEqual(expect.any(String));
  });

  it('sends no body on 204', async () => {
    const res = await http().post('/api/v1/things/empty').expect(204);
    expect(res.text).toBe('');
  });

  it('reports validation failures with field paths', async () => {
    const res = await http().post('/api/v1/things').send({ name: '' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('name');
    expect(res.body.path).toBe('/api/v1/things');
  });

  it('rejects an over-limit page size', async () => {
    const res = await http().get('/api/v1/things?limit=101').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports malformed JSON as a 400, not a 500', async () => {
    const res = await http()
      .post('/api/v1/things')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('uses the code of an ApiException', async () => {
    const res = await http().get('/api/v1/things/conflict').expect(409);
    expect(res.body.error).toEqual({ code: 'CONFLICT', message: 'Already voided', details: [] });
  });

  it('maps an unknown route to the error envelope and drops the query string', async () => {
    const res = await http().get('/api/v1/nope?email=a@b.c').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.path).toBe('/api/v1/nope');
  });

  it('never leaks the details of an unexpected error', async () => {
    const res = await http().get('/api/v1/things/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('allows only the configured origin', async () => {
    const allowed = await http().get('/api/v1/things').set('Origin', 'https://app.tahi.ph');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.tahi.ph');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();

    const designer = await http().get('/api/v1/things').set('Origin', 'https://demo.tahi.ph');
    expect(designer.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight with the allowed tenant header', async () => {
    const res = await http()
      .options('/api/v1/things')
      .set('Origin', 'https://app.tahi.ph')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('X-Tenant-Id');
  });
});

describe('application', () => {
  it('serves health under the version prefix', async () => {
    const app = await start(AppModule);
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data).toEqual({ status: 'ok' });
    await app.close();
  });

  it('serves Swagger outside production only', async () => {
    const dev = await start(AppModule);
    await request(dev.getHttpServer()).get('/api/docs-json').expect(200);
    await dev.close();

    const prod = await start(AppModule, { NODE_ENV: 'production' });
    await request(prod.getHttpServer()).get('/api/docs-json').expect(404);
    await prod.close();
  });
});

describe('parseEnv', () => {
  it('parses a comma-separated origin list', () => {
    const env = parseEnv({
      ...baseEnv,
      CORS_ORIGINS: 'http://localhost:5173, https://app.tahi.ph',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.tahi.ph']);
  });

  it.each(['*', 'https://*.tahi.ph', 'https://app.tahi.ph/', 'app.tahi.ph'])(
    'rejects the CORS origin %s',
    (value) => {
      expect(() => parseEnv({ ...baseEnv, CORS_ORIGINS: value })).toThrow();
    },
  );

  it.each([
    'DATABASE_URL',
    'SUPABASE_JWT_ISSUER',
    'SUPABASE_JWKS_URL',
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
  ])('requires %s', (name) => {
    expect(() => parseEnv({ ...baseEnv, [name]: undefined })).toThrow();
  });

  it('requires CORS origins in production', () => {
    expect(() => parseEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow();
  });
});
