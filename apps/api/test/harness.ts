import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWT_KEY_SET } from '../src/common/auth/jwt-verifier';
import { Env } from '../src/common/config/env';
import { ENV } from '../src/common/config/env.token';
import { BASE_PRISMA } from '../src/common/prisma/base-prisma.token';
import { PrismaClient, TenantRole } from '../src/generated/prisma/client';

type Override = [token: unknown, value: unknown];

/** Boots the real application with real Postgres and a test signing key. */
export async function createTestApp(overrides: Override[] = []) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWT_KEY_SET)
    .useValue(createLocalJWKSet({ keys: [jwk] }));
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token as never).useValue(value);
  }
  const moduleRef = await builder.setLogger(false as never).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, moduleRef.get<Env>(ENV));
  await app.init();
  const base = moduleRef.get<PrismaClient>(BASE_PRISMA);

  const token = (userId: string, claims: object = {}) =>
    new SignJWT({ email: `${userId}@example.test`, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(userId)
      .setIssuer('https://test.supabase.co/auth/v1')
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(privateKey);

  async function createTenant(status: 'active' | 'suspended' = 'active') {
    const slug = `t-${randomUUID().slice(0, 12)}`;
    return (await base.tenant.create({ data: { slug, name: slug, status } })).id;
  }

  async function createUser(email?: string) {
    const id = randomUUID();
    await base.user.create({ data: { id, email: email ?? `${id}@example.test` } });
    return id;
  }

  async function createMember(tenantId: string, role: TenantRole) {
    const userId = await createUser();
    const { id } = await base.tenantMembership.create({ data: { tenantId, userId, role } });
    return { userId, membershipId: id };
  }

  /** A request as this user, in this tenant if one is given. */
  async function as(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    user: string,
    options: {
      tenant?: string;
      body?: object;
      claims?: object;
      headers?: Record<string, string>;
    } = {},
  ) {
    const server = request(app.getHttpServer());
    let req = server[method](`/api/v1${path}`).set(
      'Authorization',
      `Bearer ${await token(user, options.claims)}`,
    );
    if (options.tenant) req = req.set('X-Tenant-Id', options.tenant);
    if (options.headers) req = req.set(options.headers);
    return options.body ? req.send(options.body) : req;
  }

  return { app, base, as, token, createTenant, createUser, createMember };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
