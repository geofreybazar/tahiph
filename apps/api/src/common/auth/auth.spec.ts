import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { PrismaClient } from '../../generated/prisma/client';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { BASE_PRISMA } from '../prisma/base-prisma.token';
import { ScopedPrisma } from '../prisma/prisma-clients';
import { SCOPED_PRISMA } from '../prisma/scoped-prisma.token';
import { RequestContext } from '../request-context/request-context';
import { PlatformRoute, Public, TenantRoute } from './decorators';
import { JWT_KEY_SET } from './jwt-verifier';
import { can, Permission } from './permissions';

@Controller('probe')
class ProbeController {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly context: RequestContext,
  ) {}

  @Public() @Get('public') open() {
    return 'open';
  }
  @Get('authed') authed() {
    return this.context.principal?.userId;
  }
  @TenantRoute() @Get('clients') clients() {
    return this.db.client.findMany();
  }
  @TenantRoute('finance:read') @Get('finance') finance() {
    return this.context.role;
  }
  @PlatformRoute() @Get('platform') platform() {
    return 'platform';
  }
  // No tenant decorator: the scoped client must refuse this, even for a signed-in user.
  @Get('forgot-tenant') forgot() {
    return this.db.client.findMany();
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ISSUER = 'https://test.supabase.co/auth/v1';

describe('authentication and authorization', () => {
  let app: NestExpressApplication;
  let base: PrismaClient;
  let scoped: ScopedPrisma;
  let context: RequestContext;
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  let tenantA: string;
  let tenantB: string;
  let clientA: string;
  let clientB: string;

  const http = () => request(app.getHttpServer());

  const sign = (
    userId: string,
    overrides: { aud?: string; iss?: string; exp?: string; key?: CryptoKey; claims?: object } = {},
  ) =>
    new SignJWT({ email: `${userId}@example.test`, ...overrides.claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(userId)
      .setIssuer(overrides.iss ?? ISSUER)
      .setAudience(overrides.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(overrides.exp ?? '5m')
      .sign(overrides.key ?? privateKey);

  const get = (path: string, token?: string, tenant?: string) => {
    const req = http().get(`/api/v1/probe/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (tenant) req.set('X-Tenant-Id', tenant);
    return req;
  };

  async function member(tenantId: string, role: 'owner' | 'admin' | 'staff') {
    const userId = randomUUID();
    await base.user.create({ data: { id: userId, email: `${userId}@example.test` } });
    await base.tenantMembership.create({ data: { tenantId, userId, role } });
    return userId;
  }

  beforeAll(async () => {
    const keys = await generateKeyPair('ES256', { extractable: true });
    privateKey = keys.privateKey;
    otherKey = (await generateKeyPair('ES256')).privateKey;
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
      .overrideProvider(JWT_KEY_SET)
      .useValue(createLocalJWKSet({ keys: [jwk] }))
      .setLogger(false as never)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, moduleRef.get<Env>(ENV));
    await app.init();
    base = moduleRef.get(BASE_PRISMA);
    scoped = moduleRef.get(SCOPED_PRISMA);
    context = moduleRef.get(RequestContext);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    const unique = randomUUID().slice(0, 8);
    tenantA = (await base.tenant.create({ data: { slug: `a-${unique}`, name: 'A' } })).id;
    tenantB = (await base.tenant.create({ data: { slug: `b-${unique}`, name: 'B' } })).id;
    clientA = (await base.client.create({ data: { tenantId: tenantA, fullName: 'Alma' } })).id;
    clientB = (await base.client.create({ data: { tenantId: tenantB, fullName: 'Bea' } })).id;
  });

  describe('token verification', () => {
    it('leaves public routes open and denies everything else by default', async () => {
      await get('public').expect(200);
      const res = await get('authed').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      await http().get('/api/v1/health').expect(200);
    });

    it('accepts a valid token and creates the user once', async () => {
      const id = randomUUID();
      const res = await get('authed', await sign(id)).expect(200);
      expect(res.body.data).toBe(id);
      await get('authed', await sign(id)).expect(200);
      expect(await base.user.count({ where: { id } })).toBe(1);
    });

    it('keeps the stored email in sync with the token', async () => {
      const id = randomUUID();
      await get('authed', await sign(id)).expect(200);
      await get('authed', await sign(id, { claims: { email: `New-${id}@Example.test` } })).expect(
        200,
      );
      const user = await base.user.findUniqueOrThrow({ where: { id } });
      expect(user.email).toBe(`new-${id}@example.test`);
    });

    it.each([
      ['wrong issuer', { iss: 'https://evil.example/auth/v1' }],
      ['wrong audience', { aud: 'anon' }],
      ['expired', { exp: '-1m' }],
    ])('rejects a token with %s', async (_name, overrides) => {
      await get('authed', await sign(randomUUID(), overrides)).expect(401);
    });

    it('rejects a token signed with another key', async () => {
      await get('authed', await sign(randomUUID(), { key: otherKey })).expect(401);
    });

    it('rejects a tampered token', async () => {
      const token = await sign(randomUUID());
      const [header, , signature] = token.split('.');
      const forged = Buffer.from(
        JSON.stringify({ sub: randomUUID(), aud: 'authenticated', iss: ISSUER, exp: 9999999999 }),
      ).toString('base64url');
      await get('authed', `${header}.${forged}.${signature}`).expect(401);
    });

    it('rejects an unsigned token', async () => {
      const token = new UnsecuredJWT({ email: 'a@example.test' })
        .setSubject(randomUUID())
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setExpirationTime('5m')
        .encode();
      await get('authed', token).expect(401);
    });

    it('rejects an HS256 token, even one keyed with the public key', async () => {
      const token = await new SignJWT({ email: 'a@example.test' })
        .setProtectedHeader({ alg: 'HS256', kid: 'test' })
        .setSubject(randomUUID())
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('public-key-material-used-as-a-secret'));
      await get('authed', token).expect(401);
    });

    it('rejects a token with no email, a non-UUID subject, or no scheme', async () => {
      const noEmail = await sign(randomUUID(), { claims: { email: undefined } });
      await get('authed', noEmail).expect(401);
      await get('authed', await sign('not-a-uuid')).expect(401);
      await http()
        .get('/api/v1/probe/authed')
        .set('Authorization', await sign(randomUUID()))
        .expect(401);
    });

    it('rejects garbage without a 500', async () => {
      await get('authed', 'garbage').expect(401);
    });
  });

  describe('tenant access', () => {
    it('requires the tenant header', async () => {
      const token = await sign(await member(tenantA, 'owner'));
      const res = await get('clients', token).expect(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('returns only the selected tenant for a member', async () => {
      const token = await sign(await member(tenantA, 'staff'));
      const res = await get('clients', token, tenantA).expect(200);
      expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([clientA]);
    });

    it('gives the same answer for another tenant, an unknown tenant and a bad id', async () => {
      const token = await sign(await member(tenantA, 'owner'));
      const answers = await Promise.all(
        [tenantB, randomUUID(), 'not-a-uuid', `${tenantA}' OR 1=1`].map((id) =>
          get('clients', token, id),
        ),
      );
      for (const res of answers) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
        expect(res.body.error.message).toBe(answers[0]!.body.error.message);
      }
    });

    it('lets a user of two tenants see each one separately', async () => {
      const userId = await member(tenantA, 'owner');
      await base.tenantMembership.create({ data: { tenantId: tenantB, userId, role: 'staff' } });
      const token = await sign(userId);
      const a = await get('clients', token, tenantA).expect(200);
      const b = await get('clients', token, tenantB).expect(200);
      expect(a.body.data[0].id).toBe(clientA);
      expect(b.body.data[0].id).toBe(clientB);
    });

    it('takes the role from that tenant, not the other', async () => {
      const userId = await member(tenantA, 'owner');
      await base.tenantMembership.create({ data: { tenantId: tenantB, userId, role: 'staff' } });
      const token = await sign(userId);
      await get('finance', token, tenantA).expect(200);
      await get('finance', token, tenantB).expect(403);
    });

    it('applies removal on the very next request, with the same token', async () => {
      const userId = await member(tenantA, 'owner');
      const token = await sign(userId);
      await get('clients', token, tenantA).expect(200);
      await base.tenantMembership.update({
        where: { tenantId_userId: { tenantId: tenantA, userId } },
        data: { status: 'removed' },
      });
      const res = await get('clients', token, tenantA).expect(403);
      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it.each(['suspended', 'inactive'] as const)('blocks members of a %s tenant', async (status) => {
      const token = await sign(await member(tenantA, 'owner'));
      await get('clients', token, tenantA).expect(200);
      await base.tenant.update({ where: { id: tenantA }, data: { status } });
      const res = await get('clients', token, tenantA).expect(403);
      expect(res.body.error.code).toBe('TENANT_SUSPENDED');
    });

    it('does not reveal a suspension to non-members', async () => {
      const token = await sign(await member(tenantB, 'owner'));
      await base.tenant.update({ where: { id: tenantA }, data: { status: 'suspended' } });
      const res = await get('clients', token, tenantA).expect(403);
      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('never carries a tenant over between concurrent requests', async () => {
      const [ta, tb] = await Promise.all([
        sign(await member(tenantA, 'owner')),
        sign(await member(tenantB, 'owner')),
      ]);
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          i % 2 ? get('clients', ta, tenantA) : get('clients', tb, tenantB),
        ),
      );
      results.forEach((res, i) =>
        expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([i % 2 ? clientA : clientB]),
      );
    });

    it('fails a route that forgot its tenant decorator, ignoring the header', async () => {
      const token = await sign(await member(tenantA, 'owner'));
      const res = await get('forgot-tenant', token, tenantA).expect(500);
      expect(JSON.stringify(res.body)).not.toContain('Alma');
    });
  });

  describe('roles', () => {
    it.each([
      ['owner', 200],
      ['admin', 200],
      ['staff', 403],
    ] as const)('finance as %s returns %i', async (role, status) => {
      const token = await sign(await member(tenantA, role));
      await get('finance', token, tenantA).expect(status);
    });

    it('matches the role matrix', () => {
      const staffDenied: Permission[] = [
        'members:manage',
        'ownership:transfer',
        'finance:read',
        'expenses:manage',
        'payments:void',
        'projects:change-price',
      ];
      for (const permission of staffDenied) {
        expect(can('staff', permission), permission).toBe(false);
        expect(can('owner', permission), permission).toBe(true);
      }
      expect(can('admin', 'ownership:transfer')).toBe(false);
      expect(can('admin', 'finance:read')).toBe(true);
    });
  });

  describe('platform access', () => {
    const makeAdmin = async () => {
      const userId = randomUUID();
      await base.user.create({ data: { id: userId, email: `${userId}@example.test` } });
      await base.platformAdmin.create({ data: { userId } });
      return userId;
    };

    it('refuses a tenant owner', async () => {
      const token = await sign(await member(tenantA, 'owner'), { claims: { aal: 'aal2' } });
      const res = await get('platform', token).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('refuses a role claim in the token', async () => {
      const token = await sign(randomUUID(), {
        claims: { aal: 'aal2', role: 'super_admin', app_metadata: { role: 'super_admin' } },
      });
      await get('platform', token).expect(403);
    });

    it('requires MFA', async () => {
      const res = await get('platform', await sign(await makeAdmin())).expect(403);
      expect(res.body.error.code).toBe('MFA_REQUIRED');
    });

    it('admits an admin with MFA', async () => {
      const token = await sign(await makeAdmin(), { claims: { aal: 'aal2' } });
      await get('platform', token).expect(200);
    });

    it('grants no tenant access', async () => {
      const token = await sign(await makeAdmin(), { claims: { aal: 'aal2' } });
      await get('clients', token, tenantA).expect(403);
    });
  });

  describe('GET /me', () => {
    it('lists only active memberships', async () => {
      const userId = await member(tenantA, 'owner');
      await base.tenantMembership.create({
        data: { tenantId: tenantB, userId, role: 'staff', status: 'removed' },
      });
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${await sign(userId)}`)
        .expect(200);
      expect(res.body.data.isPlatformAdmin).toBe(false);
      expect(res.body.data.memberships).toEqual([
        expect.objectContaining({ id: tenantA, role: 'owner', status: 'active' }),
      ]);
    });
  });

  describe('runInTenant', () => {
    const list = () => scoped.client.findMany({ where: { id: { in: [clientA, clientB] } } });

    it('scopes work with no request, even when the query is returned unawaited', async () => {
      const rows = await context.runInTenant(tenantA, () => list());
      expect(rows.map((r) => r.id)).toEqual([clientA]);
    });

    it('switches cleanly when nested', async () => {
      const [outerBefore, inner, outerAfter] = await context.runInTenant(tenantA, async () => [
        await list(),
        await context.runInTenant(tenantB, () => list()),
        await list(),
      ]);
      expect(outerBefore!.map((r) => r.id)).toEqual([clientA]);
      expect(inner!.map((r) => r.id)).toEqual([clientB]);
      expect(outerAfter!.map((r) => r.id)).toEqual([clientA]);
    });

    it('leaves no context behind', async () => {
      await context.runInTenant(tenantA, () => list());
      await expect((async () => list())()).rejects.toThrow(/no tenant context/);
    });
  });
});
