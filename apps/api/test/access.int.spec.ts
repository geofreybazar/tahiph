import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient, SessionRealm, TenantDatabase } from '@tahi/database';
import { apiErrorSchema } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { SESSION_COOKIES } from '../src/core/auth/cookies.js';
import { CSRF_COOKIE } from '../src/core/auth/csrf.js';
import {
  AllowMfaPending,
  Authenticated,
  Public,
  Realm,
  RequirePermission,
} from '../src/core/auth/decorators.js';
import { SessionService } from '../src/core/auth/session.service.js';
import type { RequestContext } from '../src/core/context/request-context.js';
import { CoreModule } from '../src/core/core.module.js';
import { TENANT_DB, UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { NotFoundError } from '../src/core/http/domain-error.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];

// --- Probe routes, one per realm --------------------------------------------------------

@Controller('tenant/probe')
@Realm('tenant')
class TenantProbe {
  constructor(
    private readonly cls: ClsService<RequestContext>,
    @Inject(TENANT_DB) private readonly tdb: TenantDatabase,
  ) {}

  @Get('me')
  @Authenticated()
  me() {
    return {
      userId: this.cls.get('userId') ?? null,
      tenantId: this.cls.get('tenantId') ?? null,
      membershipId: this.cls.get('membershipId') ?? null,
    };
  }

  @Get('roles')
  @RequirePermission('roles.manage')
  async roles() {
    return (await this.tdb.db().role.findMany({ select: { id: true, tenantId: true } })).map(
      (r) => r,
    );
  }

  @Get('roles/:id')
  @RequirePermission('roles.manage')
  async role(@Param('id') id: string) {
    const role = await this.tdb.db().role.findFirst({ where: { id }, select: { id: true } });
    if (!role) throw new NotFoundError();
    return role;
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  async createRole() {
    return this.tdb.withTenantTx(async () => {
      const role = await this.tdb.db().role.create({
        data: { key: `r-${randomUUID()}`, name: 'Created' } as never,
        select: { id: true, tenantId: true },
      });
      return role;
    });
  }
}

@Controller('platform/probe')
@Realm('platform')
class PlatformProbe {
  @Get('tenants')
  @RequirePermission('platform.tenants.read')
  tenants() {
    return { ok: true };
  }

  @Get('admins')
  @RequirePermission('platform.admins.manage')
  admins() {
    return { ok: true };
  }

  @Get('mfa')
  @Authenticated()
  @AllowMfaPending()
  mfa() {
    return { ok: true };
  }
}

@Controller('public/probe')
@Realm('public')
@Public()
class PublicProbe {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  @Get()
  get() {
    return { tenantId: this.cls.get('tenantId') };
  }
}

@Controller('customer/probe')
@Realm('customer')
@Authenticated()
class CustomerProbe {
  @Get()
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [TenantProbe, PlatformProbe, PublicProbe, CustomerProbe] })
class ProbeModule {}

// --- Tests ---------------------------------------------------------------------------------

const APP = 'app.tahi.test';
const CSRF = 'c'.repeat(43);
const ADMIN = 'admin.tahi.test';

describe('Access guard (integration: real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let sessions: SessionService;
  let A: TenantFixture;
  let B: TenantFixture;
  const server = (): App => app.getHttpServer() as App;

  const cookie = (realm: SessionRealm, token: string) => `${SESSION_COOKIES[realm]}=${token}`;
  const get = (host: string, path: string, c?: string) => {
    const r = request(server()).get(`/api/v1/${path}`).set('Host', host);
    return c ? r.set('Cookie', c) : r;
  };
  const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

  /** A staff user with an active membership in `tenant`, and a session pointing at it. */
  async function staffSession(
    tenant: TenantFixture,
    roleKey: string,
    overrides: { status?: 'ACTIVE' | 'DISABLED' } = {},
  ) {
    const user = await createUser(prisma);
    const m = await addMember(prisma, tenant, user.id, roleKey, overrides.status);
    const s = await sessions.create({
      realm: 'TENANT',
      subjectId: user.id,
      tenantId: tenant.tenantId,
      activeMembershipId: m.id,
    });
    return { user, membership: m, ...s, cookie: cookie('TENANT', s.token) };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, ProbeModule],
    }).compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
    sessions = app.get(SessionService);
    A = await createTenant(prisma, {
      owner: ['roles.manage', 'staff.read'],
      tailor: ['production.read_assigned'],
    });
    B = await createTenant(prisma, { owner: ['roles.manage'] });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('host and realm', () => {
    it('serves tenant routes only on the app host (404 elsewhere)', async () => {
      const s = await staffSession(A, 'owner');
      await get(APP, 'tenant/probe/me', s.cookie).expect(200);
      expect(errorCode((await get(ADMIN, 'tenant/probe/me', s.cookie).expect(404)).body)).toBe(
        'NOT_FOUND',
      );
      await get(A.hostname, 'tenant/probe/me', s.cookie).expect(404);
    });

    it('ignores X-Forwarded-Host', async () => {
      const s = await staffSession(A, 'owner');
      await get(ADMIN, 'tenant/probe/me', s.cookie).set('X-Forwarded-Host', APP).expect(404);
    });
  });

  describe('staff sessions', () => {
    it('requires a valid session cookie', async () => {
      expect(errorCode((await get(APP, 'tenant/probe/me').expect(401)).body)).toBe(
        'UNAUTHENTICATED',
      );
      await get(APP, 'tenant/probe/me', cookie('TENANT', 'x'.repeat(43))).expect(401);
      await get(APP, 'tenant/probe/me', cookie('TENANT', 'not a token')).expect(401);
    });

    it('rejects a session of another realm, even with the right cookie name', async () => {
      const admin = await prisma.platformUser.create({
        data: {
          email: `a-${randomUUID()}@example.test`,
          name: 'A',
          passwordHash: 'x',
          role: 'SUPER_ADMIN',
        },
      });
      const s = await sessions.create({
        realm: 'PLATFORM',
        subjectId: admin.id,
        mfaVerified: true,
      });
      await get(APP, 'tenant/probe/me', cookie('TENANT', s.token)).expect(401);
    });

    it('rejects revoked and expired sessions', async () => {
      const s = await staffSession(A, 'owner');
      await sessions.revoke(s.id);
      await get(APP, 'tenant/probe/me', s.cookie).expect(401);

      const e = await staffSession(A, 'owner');
      await prisma.session.update({
        where: { id: e.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await get(APP, 'tenant/probe/me', e.cookie).expect(401);

      const abs = await staffSession(A, 'owner');
      await prisma.session.update({
        where: { id: abs.id },
        data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      await get(APP, 'tenant/probe/me', abs.cookie).expect(401);
    });

    it('rejects sessions of users who are no longer active', async () => {
      const s = await staffSession(A, 'owner');
      await prisma.user.update({ where: { id: s.user.id }, data: { status: 'DISABLED' } });
      await get(APP, 'tenant/probe/me', s.cookie).expect(401);
    });

    it('slides the idle expiry on use, capped by the absolute expiry', async () => {
      const s = await staffSession(A, 'owner');
      const old = new Date(Date.now() - 10 * 60_000);
      await prisma.session.update({
        where: { id: s.id },
        data: { lastSeenAt: old, expiresAt: new Date(Date.now() + 60_000) },
      });
      await get(APP, 'tenant/probe/me', s.cookie).expect(200);
      const after = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
      expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
      expect(after.expiresAt.getTime()).toBeLessThanOrEqual(after.absoluteExpiresAt.getTime());
    });
  });

  describe('tenant context and permissions', () => {
    it('derives the tenant from the session’s active membership', async () => {
      const s = await staffSession(A, 'owner');
      const res = await get(APP, 'tenant/probe/me', s.cookie).expect(200);
      expect(res.body).toEqual({
        data: { userId: s.user.id, tenantId: A.tenantId, membershipId: s.membership.id },
      });
    });

    it('lists only the active tenant’s rows', async () => {
      const s = await staffSession(A, 'owner');
      const res = await get(APP, 'tenant/probe/roles', s.cookie).expect(200);
      const rows = (res.body as { data: { tenantId: string }[] }).data;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === A.tenantId)).toBe(true);
    });

    it('returns 404 for another tenant’s id (cross-tenant)', async () => {
      const s = await staffSession(A, 'owner');
      await get(APP, `tenant/probe/roles/${A.roles.owner}`, s.cookie).expect(200);
      expect(
        errorCode(
          (await get(APP, `tenant/probe/roles/${B.roles.owner}`, s.cookie).expect(404)).body,
        ),
      ).toBe('NOT_FOUND');
    });

    it('rejects state-changing requests without Origin and CSRF token', async () => {
      const s = await staffSession(A, 'owner');
      const post = () =>
        request(server())
          .post('/api/v1/tenant/probe/roles')
          .set('Host', APP)
          .set('Cookie', s.cookie);
      expect(errorCode((await post().expect(403)).body)).toBe('CSRF_ORIGIN_MISMATCH');
      expect(errorCode((await post().set('Origin', `http://${APP}`).expect(403)).body)).toBe(
        'CSRF_TOKEN_INVALID',
      );
    });

    it('writes inside withTenantTx land in the active tenant only', async () => {
      const s = await staffSession(A, 'owner');
      const res = await request(server())
        .post('/api/v1/tenant/probe/roles')
        .set('Host', APP)
        .set('Origin', `http://${APP}`)
        .set('X-CSRF-Token', CSRF)
        .set('Cookie', `${s.cookie}; ${CSRF_COOKIE}=${CSRF}`)
        .expect(201);
      const created = (res.body as { data: { id: string; tenantId: string } }).data;
      expect(created.tenantId).toBe(A.tenantId);
      const sb = await staffSession(B, 'owner');
      await get(APP, `tenant/probe/roles/${created.id}`, sb.cookie).expect(404);
    });

    it('returns 403 when the role lacks the permission', async () => {
      const s = await staffSession(A, 'tailor');
      expect(errorCode((await get(APP, 'tenant/probe/roles', s.cookie).expect(403)).body)).toBe(
        'FORBIDDEN',
      );
    });

    it('drops the tenant context when the membership is not active', async () => {
      const s = await staffSession(A, 'owner', { status: 'DISABLED' });
      const me = await get(APP, 'tenant/probe/me', s.cookie).expect(200);
      expect((me.body as { data: { tenantId: string | null } }).data.tenantId).toBeNull();
      expect(errorCode((await get(APP, 'tenant/probe/roles', s.cookie).expect(403)).body)).toBe(
        'NO_ACTIVE_TENANT',
      );
    });

    it('drops the tenant context when the tenant is suspended', async () => {
      const C = await createTenant(prisma, { owner: ['roles.manage'] });
      const s = await staffSession(C, 'owner');
      await get(APP, 'tenant/probe/roles', s.cookie).expect(200);
      await prisma.tenant.update({ where: { id: C.tenantId }, data: { status: 'SUSPENDED' } });
      expect(errorCode((await get(APP, 'tenant/probe/roles', s.cookie).expect(403)).body)).toBe(
        'NO_ACTIVE_TENANT',
      );
    });

    it('never trusts a session whose tenant and membership disagree', async () => {
      // A membership of tenant A paired with tenant B: RLS hides the membership under B.
      const s = await staffSession(A, 'owner');
      await prisma.session.update({ where: { id: s.id }, data: { tenantId: B.tenantId } });
      expect(errorCode((await get(APP, 'tenant/probe/roles', s.cookie).expect(403)).body)).toBe(
        'NO_ACTIVE_TENANT',
      );
    });

    it('never trusts a membership that belongs to another user', async () => {
      const s = await staffSession(A, 'owner');
      const other = await staffSession(A, 'owner');
      await prisma.session.update({
        where: { id: s.id },
        data: { activeMembershipId: other.membership.id },
      });
      expect(errorCode((await get(APP, 'tenant/probe/roles', s.cookie).expect(403)).body)).toBe(
        'NO_ACTIVE_TENANT',
      );
    });
  });

  describe('platform realm', () => {
    async function adminSession(role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN', mfaVerified: boolean) {
      const admin = await prisma.platformUser.create({
        data: { email: `a-${randomUUID()}@example.test`, name: 'A', passwordHash: 'x', role },
      });
      const s = await sessions.create({ realm: 'PLATFORM', subjectId: admin.id, mfaVerified });
      return { admin, cookie: cookie('PLATFORM', s.token) };
    }

    it('requires the MFA step except on MFA endpoints', async () => {
      const s = await adminSession('SUPER_ADMIN', false);
      await get(ADMIN, 'platform/probe/tenants', s.cookie).expect(401);
      await get(ADMIN, 'platform/probe/mfa', s.cookie).expect(200);
    });

    it('applies platform role permissions', async () => {
      const pa = await adminSession('PLATFORM_ADMIN', true);
      await get(ADMIN, 'platform/probe/tenants', pa.cookie).expect(200);
      await get(ADMIN, 'platform/probe/admins', pa.cookie).expect(403);
      const sa = await adminSession('SUPER_ADMIN', true);
      await get(ADMIN, 'platform/probe/admins', sa.cookie).expect(200);
    });

    it('rejects disabled admins and the app host', async () => {
      const s = await adminSession('SUPER_ADMIN', true);
      await get(APP, 'platform/probe/tenants', s.cookie).expect(404);
      await prisma.platformUser.update({ where: { id: s.admin.id }, data: { status: 'DISABLED' } });
      await get(ADMIN, 'platform/probe/tenants', s.cookie).expect(401);
    });
  });

  describe('storefront (public and customer realms)', () => {
    it('resolves the tenant from the Host, never from the client', async () => {
      const res = await get(A.hostname, 'public/probe').query({ tenantId: B.tenantId }).expect(200);
      expect(res.body).toEqual({ data: { tenantId: A.tenantId } });
    });

    it('returns 404 for unknown, unverified or offline hosts', async () => {
      await get('nobody.tahi.test', 'public/probe').expect(404);
      const unverified = await createTenant(prisma, {}, { verified: false });
      await get(unverified.hostname, 'public/probe').expect(404);
      const suspended = await createTenant(prisma, {}, { status: 'SUSPENDED' });
      await get(suspended.hostname, 'public/probe').expect(404);
      await get(APP, 'public/probe').expect(404);
    });

    async function customer(t: TenantFixture, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
      return asTenant(prisma, t.tenantId, (tx) =>
        tx.customerAccount.create({
          data: {
            tenantId: t.tenantId,
            email: `c-${randomUUID()}@example.test`,
            status,
            emailVerifiedAt: new Date(),
          },
        }),
      );
    }

    it('binds customer sessions to one tenant’s hosts', async () => {
      const c = await customer(A);
      const s = await sessions.create({ realm: 'CUSTOMER', subjectId: c.id, tenantId: A.tenantId });
      await get(A.hostname, 'customer/probe', cookie('CUSTOMER', s.token)).expect(200);
      await get(B.hostname, 'customer/probe', cookie('CUSTOMER', s.token)).expect(401);
      await get(A.hostname, 'customer/probe').expect(401);
    });

    it('rejects sessions of disabled accounts and accounts of another tenant', async () => {
      const disabled = await customer(A, 'DISABLED');
      const s1 = await sessions.create({
        realm: 'CUSTOMER',
        subjectId: disabled.id,
        tenantId: A.tenantId,
      });
      await get(A.hostname, 'customer/probe', cookie('CUSTOMER', s1.token)).expect(401);
      // A session claiming tenant A for B's account: the account is invisible under A (RLS).
      const foreign = await customer(B);
      const s2 = await sessions.create({
        realm: 'CUSTOMER',
        subjectId: foreign.id,
        tenantId: A.tenantId,
      });
      await get(A.hostname, 'customer/probe', cookie('CUSTOMER', s2.token)).expect(401);
    });
  });

  it('tenant fixtures are isolated from each other (sanity)', async () => {
    const count = await asTenant(prisma, B.tenantId, (tx) =>
      tx.role.count({ where: { tenantId: A.tenantId } }),
    );
    expect(count).toBe(0);
  });
});
