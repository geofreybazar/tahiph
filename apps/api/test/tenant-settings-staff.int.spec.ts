import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { TENANT_PERMISSIONS, type TenantPermission } from '@tahi/types';
import { apiErrorSchema } from '@tahi/validation';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { SessionService } from '../src/core/auth/session.service.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { MAILER } from '../src/core/email/email.types.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { TenantsModule } from '../src/modules/tenants/tenants.module.js';
import { Browser } from './browser.js';
import {
  addMember,
  asTenant,
  createTenant,
  createUser,
  suffix,
  type TenantFixture,
} from './fixtures.js';

type App = Parameters<typeof request>[0];
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = (res: { body: unknown }) => (res.body as { data: Record<string, unknown> }).data;
const list = (res: { body: unknown }) => (res.body as { data: Record<string, unknown>[] }).data;

describe('Atelier settings and staff management (integration)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let sessions: SessionService;
  const server = (): App => app.getHttpServer() as App;

  /** A signed-in browser for a new user with the given role in the tenant. */
  async function member(t: TenantFixture, roleKey: string) {
    const user = await createUser(prisma);
    const m = await addMember(prisma, t, user.id, roleKey);
    const s = await sessions.create({
      realm: 'TENANT',
      subjectId: user.id,
      tenantId: t.tenantId,
      activeMembershipId: m.id,
    });
    const b = new Browser(server, 'app.tahi.test');
    b.cookies.set('__Host-tahi_app', s.token);
    return { b, user, membershipId: m.id };
  }

  async function atelier(extra: Record<string, TenantPermission[]> = {}) {
    return createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      staff: ['clients.read'],
      designer: ['clients.read', 'measurements.read'],
      manager: ['staff.read', 'staff.manage'],
      ...extra,
    });
  }

  async function auditActions(t: TenantFixture): Promise<string[]> {
    return asTenant(prisma, t.tenantId, async (tx) =>
      (await tx.tenantAuditLog.findMany({ select: { action: true } })).map((a) => a.action),
    );
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, AuthModule, TenantsModule],
    })
      .overrideProvider(MAILER)
      .useValue({ send: () => Promise.resolve() })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore())
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('profile and settings', () => {
    it('lets any active member read, but only tenant.settings write', async () => {
      const t = await atelier();
      const { b } = await member(t, 'staff');
      for (const path of ['tenant/profile', 'tenant/settings', 'tenant/operating-hours']) {
        expect((await b.get(path)).status).toBe(200);
      }
      expect((await b.get('tenant/holidays')).body).toEqual({ data: [] });
      const put = await b.send('put', 'tenant/profile', { displayName: 'Nope' });
      expect([put.status, code(put.body)]).toEqual([403, 'FORBIDDEN']);
      expect((await b.send('patch', 'tenant/settings', { vatRegistered: true })).status).toBe(403);
    });

    it('requires an active atelier', async () => {
      const user = await createUser(prisma);
      const s = await sessions.create({ realm: 'TENANT', subjectId: user.id });
      const b = new Browser(server, 'app.tahi.test');
      b.cookies.set('__Host-tahi_app', s.token);
      const res = await b.get('tenant/settings');
      expect([res.status, code(res.body)]).toEqual([403, 'NO_ACTIVE_TENANT']);
    });

    it('replaces the profile and patches settings', async () => {
      const t = await atelier();
      const { b } = await member(t, 'owner');
      const put = await b.send('put', 'tenant/profile', {
        displayName: 'Maria Couture',
        tin: '123-456-789-000',
        city: 'Makati',
        email: 'Hello@Maria.test',
      });
      expect(put.status).toBe(200);
      expect(data(put)).toMatchObject({
        displayName: 'Maria Couture',
        tin: '123-456-789-000',
        city: 'Makati',
        email: 'hello@maria.test',
        legalName: null,
      });
      // PUT replaces: omitted fields are cleared.
      const again = await b.send('put', 'tenant/profile', { displayName: 'Maria' });
      expect(data(again)).toMatchObject({ displayName: 'Maria', city: null, tin: null });

      const patch = await b.send('patch', 'tenant/settings', {
        vatRegistered: true,
        taxRate: '12',
        measurementUnit: 'IN',
      });
      expect(patch.status).toBe(200);
      expect(data(patch)).toMatchObject({
        vatRegistered: true,
        taxRate: '12.00',
        measurementUnit: 'IN',
        timezone: 'Asia/Manila',
        pricesIncludeTax: true,
      });
      const bad = await b.send('patch', 'tenant/settings', { timezone: 'Nowhere/City' });
      expect([bad.status, code(bad.body)]).toEqual([422, 'VALIDATION_FAILED']);
      expect(await auditActions(t)).toEqual(
        expect.arrayContaining(['business_profile.updated', 'settings.updated']),
      );
    });

    it('replaces the weekly hours and rejects overlaps', async () => {
      const t = await atelier();
      const { b } = await member(t, 'owner');
      const week = {
        ranges: [
          { dayOfWeek: 1, opens: '13:00', closes: '18:00' },
          { dayOfWeek: 1, opens: '09:00', closes: '12:00' },
          { dayOfWeek: 6, opens: '10:00', closes: '24:00' },
        ],
      };
      const put = await b.send('put', 'tenant/operating-hours', week);
      expect(put.status).toBe(200);
      expect(data(put).ranges).toEqual([
        { dayOfWeek: 1, opens: '09:00', closes: '12:00' },
        { dayOfWeek: 1, opens: '13:00', closes: '18:00' },
        { dayOfWeek: 6, opens: '10:00', closes: '24:00' },
      ]);
      const overlap = await b.send('put', 'tenant/operating-hours', {
        ranges: [
          { dayOfWeek: 2, opens: '09:00', closes: '12:00' },
          { dayOfWeek: 2, opens: '11:00', closes: '13:00' },
        ],
      });
      expect(overlap.status).toBe(422);
      expect(data(await b.get('tenant/operating-hours')).ranges).toHaveLength(3);
      await b.send('put', 'tenant/operating-hours', { ranges: [] });
      expect(data(await b.get('tenant/operating-hours')).ranges).toEqual([]);
    });

    it('creates, lists and deletes holidays', async () => {
      const t = await atelier();
      const { b } = await member(t, 'owner');
      const created = await b.post('tenant/holidays', { date: '2030-06-12', name: 'Independence' });
      expect(created.status).toBe(201);
      expect(data(created)).toMatchObject({ date: '2030-06-12', name: 'Independence' });
      const dup = await b.post('tenant/holidays', { date: '2030-06-12', name: 'Again' });
      expect([dup.status, code(dup.body)]).toEqual([409, 'HOLIDAY_EXISTS']);
      await b.post('tenant/holidays', { date: '2030-01-01', name: 'New Year' });
      expect(list(await b.get('tenant/holidays')).map((h) => h.date)).toEqual([
        '2030-01-01',
        '2030-06-12',
      ]);

      const id = data(created).id as string;
      expect((await b.send('delete', `tenant/holidays/${id}`)).status).toBe(204);
      expect((await b.send('delete', `tenant/holidays/${id}`)).status).toBe(404);
    });
  });

  describe('staff', () => {
    it('lists members with their roles; needs staff.read', async () => {
      const t = await atelier();
      const owner = await member(t, 'owner');
      const staff = await member(t, 'staff');
      const res = await owner.b.get('tenant/staff');
      expect(res.status).toBe(200);
      expect(list(res)).toEqual([
        expect.objectContaining({
          membershipId: owner.membershipId,
          email: owner.user.email,
          role: { id: t.roles.owner, key: 'owner', name: 'owner' },
          status: 'ACTIVE',
        }),
        expect.objectContaining({ membershipId: staff.membershipId }),
      ]);
      expect((await staff.b.get('tenant/staff')).status).toBe(403);
    });

    it('changes roles, protecting the owner and the caller', async () => {
      const t = await atelier();
      const owner = await member(t, 'owner');
      const manager = await member(t, 'manager');
      const staff = await member(t, 'staff');

      const changed = await manager.b.send('patch', `tenant/staff/${staff.membershipId}`, {
        roleId: t.roles.designer,
      });
      expect(changed.status).toBe(200);
      expect(data(changed).role).toMatchObject({ id: t.roles.designer, key: 'designer' });

      const toOwner = await manager.b.send('patch', `tenant/staff/${staff.membershipId}`, {
        roleId: t.roles.owner,
      });
      expect([toOwner.status, code(toOwner.body)]).toEqual([422, 'ROLE_NOT_ASSIGNABLE']);
      const ownerChange = await manager.b.send('patch', `tenant/staff/${owner.membershipId}`, {
        status: 'DISABLED',
      });
      expect([ownerChange.status, code(ownerChange.body)]).toEqual([403, 'OWNER_PROTECTED']);
      const self = await manager.b.send('patch', `tenant/staff/${manager.membershipId}`, {
        roleId: t.roles.owner,
      });
      expect([self.status, code(self.body)]).toEqual([403, 'CANNOT_CHANGE_SELF']);
      expect(await auditActions(t)).toContain('membership.updated');
    });

    it('disabling a member ends their sessions; re-enabling restores access', async () => {
      const t = await atelier();
      const owner = await member(t, 'owner');
      const staff = await member(t, 'staff');
      expect((await staff.b.get('tenant/settings')).status).toBe(200);

      const off = await owner.b.send('patch', `tenant/staff/${staff.membershipId}`, {
        status: 'DISABLED',
      });
      expect([off.status, data(off).status]).toEqual([200, 'DISABLED']);
      expect((await staff.b.get('tenant/settings')).status).toBe(401);

      const on = await owner.b.send('patch', `tenant/staff/${staff.membershipId}`, {
        status: 'ACTIVE',
      });
      expect(data(on).status).toBe('ACTIVE');
      // The old session stays revoked; a new sign-in works.
      expect((await staff.b.get('tenant/settings')).status).toBe(401);
      const s = await sessions.create({
        realm: 'TENANT',
        subjectId: staff.user.id,
        tenantId: t.tenantId,
        activeMembershipId: staff.membershipId,
      });
      staff.b.cookies.set('__Host-tahi_app', s.token);
      expect((await staff.b.get('tenant/settings')).status).toBe(200);
    });
  });

  describe('invitations', () => {
    it('lists pending invitations and revokes them', async () => {
      const t = await atelier();
      const owner = await member(t, 'owner');
      const email = `inv-${suffix()}@example.test`;
      expect(
        (await owner.b.post('tenant/invitations', { email, roleId: t.roles.staff })).status,
      ).toBe(201);
      const pending = (
        list(await owner.b.get('tenant/invitations')) as { id: string; email: string }[]
      ).find((i) => i.email === email);
      expect(pending).toMatchObject({ roleId: t.roles.staff });

      expect((await owner.b.send('delete', `tenant/invitations/${pending!.id}`)).status).toBe(204);
      expect(data(await owner.b.get('tenant/invitations'))).toEqual([]);
      expect((await owner.b.send('delete', `tenant/invitations/${pending!.id}`)).status).toBe(404);
      expect(await auditActions(t)).toContain('membership.invitation_revoked');

      const staff = await member(t, 'staff');
      expect((await staff.b.get('tenant/invitations')).status).toBe(403);
    });
  });
});
