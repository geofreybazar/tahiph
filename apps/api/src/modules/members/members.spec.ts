import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';
import { AuthAdminService } from '../../common/auth/auth-admin.service';

const authAdmin = {
  isEmailConfirmed: vi.fn(async () => true),
  sendInvite: vi.fn(async () => true),
};

describe('members and invitations', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: { userId: string; membershipId: string };

  const tokenFrom = (acceptUrl: string) => new URL(acceptUrl).searchParams.get('token')!;

  async function invite(email: string, role = 'staff', by = owner.userId, inTenant = tenant) {
    const res = await t.as('post', '/invitations', by, {
      tenant: inTenant,
      body: { email, role },
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  beforeAll(async () => {
    t = await createTestApp([[AuthAdminService, authAdmin]]);
  });
  afterAll(() => t.app.close());

  beforeEach(async () => {
    authAdmin.isEmailConfirmed.mockResolvedValue(true);
    authAdmin.sendInvite.mockResolvedValue(true);
    tenant = await t.createTenant();
    other = await t.createTenant();
    owner = await t.createMember(tenant, 'owner');
  });

  describe('inviting', () => {
    it('stores only a hash of the token', async () => {
      const data = await invite(`${randomUUID()}@example.test`);
      const row = await t.base.tenantInvitation.findUniqueOrThrow({ where: { id: data.id } });
      expect(row.tokenHash).not.toContain(tokenFrom(data.acceptUrl));
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('still works when no email could be sent, and says so', async () => {
      authAdmin.sendInvite.mockResolvedValue(false);
      const data = await invite(`${randomUUID()}@example.test`);
      expect(data.emailSent).toBe(false);
      expect(data.acceptUrl).toContain('/accept-invite?token=');
    });

    it('normalizes the email', async () => {
      const id = randomUUID();
      const data = await invite(`Mixed-${id}@Example.TEST`);
      expect(data.email).toBe(`mixed-${id}@example.test`);
    });

    it('refuses a second open invitation, but allows one after expiry', async () => {
      const email = `${randomUUID()}@example.test`;
      const first = await invite(email);
      const again = await t.as('post', '/invitations', owner.userId, {
        tenant,
        body: { email, role: 'staff' },
      });
      expect(again.status).toBe(409);

      await t.base.tenantInvitation.update({
        where: { id: first.id },
        data: { expiresAt: new Date('2020-01-01') },
      });
      await invite(email);
    });

    it('refuses someone who is already a member', async () => {
      const staff = await t.createMember(tenant, 'staff');
      const res = await t.as('post', '/invitations', owner.userId, {
        tenant,
        body: { email: `${staff.userId}@example.test`, role: 'staff' },
      });
      expect(res.status).toBe(409);
    });

    it('refuses an owner invitation through validation', async () => {
      const res = await t.as('post', '/invitations', owner.userId, {
        tenant,
        body: { email: 'a@example.test', role: 'owner' },
      });
      expect(res.status).toBe(400);
    });

    it('lets an admin invite staff but not admins', async () => {
      const admin = await t.createMember(tenant, 'admin');
      await invite(`${randomUUID()}@example.test`, 'staff', admin.userId);
      const res = await t.as('post', '/invitations', admin.userId, {
        tenant,
        body: { email: 'b@example.test', role: 'admin' },
      });
      expect(res.status).toBe(403);
    });

    it('refuses staff', async () => {
      const staff = await t.createMember(tenant, 'staff');
      const res = await t.as('post', '/invitations', staff.userId, {
        tenant,
        body: { email: 'c@example.test', role: 'staff' },
      });
      expect(res.status).toBe(403);
    });

    it('never lists tokens, and revoking stops the invitation working', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email);
      const list = await t.as('get', '/invitations', owner.userId, { tenant });
      expect(JSON.stringify(list.body)).not.toContain('token');
      expect(JSON.stringify(list.body)).not.toContain('Hash');

      const revoke = await t.as('delete', `/invitations/${data.id}`, owner.userId, { tenant });
      expect(revoke.status).toBe(204);

      const user = await t.createUser(email);
      const accept = await t.as('post', '/invitations/accept', user, {
        body: { token: tokenFrom(data.acceptUrl) },
        claims: { email },
      });
      expect(accept.status).toBe(404);
    });

    it("cannot see or revoke another tenant's invitation", async () => {
      const data = await invite(`${randomUUID()}@example.test`);
      const outsider = await t.createMember(other, 'owner');
      const list = await t.as('get', '/invitations', outsider.userId, { tenant: other });
      expect(list.body.data).toEqual([]);
      const revoke = await t.as('delete', `/invitations/${data.id}`, outsider.userId, {
        tenant: other,
      });
      expect(revoke.status).toBe(404);
    });
  });

  describe('accepting', () => {
    const accept = (user: string, email: string, token: string) =>
      t.as('post', '/invitations/accept', user, { body: { token }, claims: { email } });

    it('creates the membership with the invited role, once', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email, 'admin');
      const user = await t.createUser(email);
      const token = tokenFrom(data.acceptUrl);

      const res = await accept(user, email, token);
      expect(res.status).toBe(200);
      const membership = await t.base.tenantMembership.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId: tenant, userId: user } },
      });
      expect(membership.role).toBe('admin');

      expect((await accept(user, email, token)).status).toBe(404);
    });

    it('refuses a different signed-in email', async () => {
      const data = await invite(`${randomUUID()}@example.test`);
      const user = await t.createUser();
      const res = await accept(user, `${user}@example.test`, tokenFrom(data.acceptUrl));
      expect(res.status).toBe(403);
      expect(await t.base.tenantMembership.count({ where: { userId: user } })).toBe(0);
    });

    it('refuses an unconfirmed email', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email);
      const user = await t.createUser(email);
      authAdmin.isEmailConfirmed.mockResolvedValue(false);
      expect((await accept(user, email, tokenFrom(data.acceptUrl))).status).toBe(403);
    });

    it('refuses an expired invitation and a made-up token', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email);
      await t.base.tenantInvitation.update({
        where: { id: data.id },
        data: { expiresAt: new Date('2020-01-01') },
      });
      const user = await t.createUser(email);
      expect((await accept(user, email, tokenFrom(data.acceptUrl))).status).toBe(404);
      expect((await accept(user, email, 'made-up')).status).toBe(404);
    });

    it('refuses for a suspended tenant', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email);
      await t.base.tenant.update({ where: { id: tenant }, data: { status: 'suspended' } });
      const user = await t.createUser(email);
      const res = await accept(user, email, tokenFrom(data.acceptUrl));
      expect(res.body.error.code).toBe('TENANT_SUSPENDED');
    });

    it('lets a removed member come back with the new role', async () => {
      const staff = await t.createMember(tenant, 'admin');
      const email = `${staff.userId}@example.test`;
      await t.as('delete', `/members/${staff.membershipId}`, owner.userId, { tenant });
      const data = await invite(email, 'staff');
      expect((await accept(staff.userId, email, tokenFrom(data.acceptUrl))).status).toBe(200);
      const row = await t.base.tenantMembership.findUniqueOrThrow({
        where: { id: staff.membershipId },
      });
      expect(row).toMatchObject({ status: 'active', role: 'staff' });
    });

    it('lets only one of two simultaneous accepts succeed', async () => {
      const email = `${randomUUID()}@example.test`;
      const data = await invite(email);
      const user = await t.createUser(email);
      const token = tokenFrom(data.acceptUrl);
      const results = await Promise.all([accept(user, email, token), accept(user, email, token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(await t.base.tenantMembership.count({ where: { userId: user } })).toBe(1);
    });
  });

  describe('managing members', () => {
    it('lists members with their email, for managers only', async () => {
      const staff = await t.createMember(tenant, 'staff');
      const res = await t.as('get', '/members', owner.userId, { tenant });
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].email).toBe(`${owner.userId}@example.test`);
      expect((await t.as('get', '/members', staff.userId, { tenant })).status).toBe(403);
    });

    it('applies the role rules', async () => {
      const admin = await t.createMember(tenant, 'admin');
      const staff = await t.createMember(tenant, 'staff');
      const patch = (by: string, id: string, role: string) =>
        t.as('patch', `/members/${id}`, by, { tenant, body: { role } });

      expect((await patch(admin.userId, staff.membershipId, 'admin')).status).toBe(403);
      expect((await patch(admin.userId, owner.membershipId, 'staff')).status).toBe(403);
      expect((await patch(owner.userId, owner.membershipId, 'staff')).status).toBe(403);
      expect((await patch(owner.userId, staff.membershipId, 'admin')).status).toBe(200);
      expect((await patch(admin.userId, staff.membershipId, 'staff')).status).toBe(403);
      expect((await patch(owner.userId, staff.membershipId, 'owner')).status).toBe(400);
    });

    it('removal cuts access on the next request and is audited', async () => {
      const staff = await t.createMember(tenant, 'staff');
      expect((await t.as('get', '/tenant', staff.userId, { tenant })).status).toBe(200);
      const res = await t.as('delete', `/members/${staff.membershipId}`, owner.userId, { tenant });
      expect(res.status).toBe(204);
      expect((await t.as('get', '/tenant', staff.userId, { tenant })).status).toBe(403);

      const log = await t.base.auditLog.findFirst({
        where: { tenantId: tenant, action: 'member.removed', entityId: staff.membershipId },
      });
      expect(log?.actorUserId).toBe(owner.userId);
    });

    it('never removes the owner', async () => {
      const admin = await t.createMember(tenant, 'admin');
      const path = `/members/${owner.membershipId}`;
      expect((await t.as('delete', path, admin.userId, { tenant })).status).toBe(403);
      expect((await t.as('delete', path, owner.userId, { tenant })).status).toBe(403);
    });

    it("returns 404 for another tenant's member", async () => {
      const outsider = await t.createMember(other, 'owner');
      const staff = await t.createMember(tenant, 'staff');
      const path = `/members/${staff.membershipId}`;
      const patch = await t.as('patch', path, outsider.userId, {
        tenant: other,
        body: { role: 'admin' },
      });
      expect(patch.status).toBe(404);
      expect((await t.as('delete', path, outsider.userId, { tenant: other })).status).toBe(404);
    });
  });

  describe('transferring ownership', () => {
    const transfer = (by: string, membershipId: string, inTenant = tenant) =>
      t.as('post', '/members/transfer-ownership', by, {
        tenant: inTenant,
        body: { membershipId },
      });

    it('swaps owner and admin atomically', async () => {
      const staff = await t.createMember(tenant, 'staff');
      expect((await transfer(owner.userId, staff.membershipId)).status).toBe(204);
      const rows = await t.base.tenantMembership.findMany({ where: { tenantId: tenant } });
      expect(rows.find((r) => r.id === owner.membershipId)?.role).toBe('admin');
      expect(rows.find((r) => r.id === staff.membershipId)?.role).toBe('owner');
    });

    it('is owner only', async () => {
      const admin = await t.createMember(tenant, 'admin');
      expect((await transfer(admin.userId, admin.membershipId)).status).toBe(403);
    });

    it('cannot target another tenant, leaving the owner unchanged', async () => {
      const outsider = await t.createMember(other, 'staff');
      expect((await transfer(owner.userId, outsider.membershipId)).status).toBe(404);
      const row = await t.base.tenantMembership.findUniqueOrThrow({
        where: { id: owner.membershipId },
      });
      expect(row.role).toBe('owner');
    });

    it('refuses transferring to yourself', async () => {
      expect((await transfer(owner.userId, owner.membershipId)).status).toBe(409);
    });
  });

  describe('tenant settings', () => {
    it('lets managers rename and staff read', async () => {
      const staff = await t.createMember(tenant, 'staff');
      expect((await t.as('get', '/tenant', staff.userId, { tenant })).body.data.id).toBe(tenant);
      const body = { name: 'New name' };
      expect((await t.as('patch', '/tenant', staff.userId, { tenant, body })).status).toBe(403);
      const res = await t.as('patch', '/tenant', owner.userId, { tenant, body });
      expect(res.body.data.name).toBe('New name');
    });
  });
});

describe('platform', () => {
  let t: TestApp;
  let admin: string;
  const mfa = { aal: 'aal2' };

  beforeAll(async () => {
    t = await createTestApp([[AuthAdminService, authAdmin]]);
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    admin = await t.createUser();
    await t.base.platformAdmin.create({ data: { userId: admin } });
  });

  const newTenant = () => ({
    name: 'New Atelier',
    slug: `n-${randomUUID().slice(0, 10)}`,
    ownerEmail: `${randomUUID()}@example.test`,
  });

  it('refuses non-admins and admins without MFA, on every route', async () => {
    const tenant = await t.createTenant();
    const { userId } = await t.createMember(tenant, 'owner');
    expect((await t.as('get', '/platform/tenants', userId, { claims: mfa })).status).toBe(403);
    const noMfa = await t.as('get', '/platform/tenants', admin);
    expect(noMfa.body.error.code).toBe('MFA_REQUIRED');
    const suspend = await t.as('post', `/platform/tenants/${tenant}/suspend`, userId, {
      claims: mfa,
    });
    expect(suspend.status).toBe(403);
    expect((await t.base.tenant.findUniqueOrThrow({ where: { id: tenant } })).status).toBe(
      'active',
    );
  });

  it('onboards a tenant whose invited owner can then sign in as owner', async () => {
    const body = newTenant();
    const res = await t.as('post', '/platform/tenants', admin, { body, claims: mfa });
    expect(res.status).toBe(201);
    const { tenant, invitation } = res.body.data;
    expect(invitation.role).toBe('owner');

    const owner = await t.createUser(body.ownerEmail);
    const accept = await t.as('post', '/invitations/accept', owner, {
      body: { token: new URL(invitation.acceptUrl).searchParams.get('token') },
      claims: { email: body.ownerEmail },
    });
    expect(accept.status).toBe(200);
    const me = await t.as('get', '/me', owner, { claims: { email: body.ownerEmail } });
    expect(me.body.data.memberships[0]).toMatchObject({ id: tenant.id, role: 'owner' });

    const log = await t.base.auditLog.findFirst({
      where: { tenantId: tenant.id, action: 'tenant.created' },
    });
    expect(log?.actorUserId).toBe(admin);
  });

  it('refuses a taken slug and a reserved slug', async () => {
    const body = newTenant();
    await t.as('post', '/platform/tenants', admin, { body, claims: mfa });
    const taken = await t.as('post', '/platform/tenants', admin, {
      body: { ...newTenant(), slug: body.slug },
      claims: mfa,
    });
    expect(taken.status).toBe(409);
    const reserved = await t.as('post', '/platform/tenants', admin, {
      body: { ...newTenant(), slug: 'api' },
      claims: mfa,
    });
    expect(reserved.status).toBe(400);
  });

  it('suspension blocks members at once, activation restores them, both audited', async () => {
    const tenant = await t.createTenant();
    const { userId } = await t.createMember(tenant, 'owner');
    expect((await t.as('get', '/tenant', userId, { tenant })).status).toBe(200);

    await t.as('post', `/platform/tenants/${tenant}/suspend`, admin, { claims: mfa });
    const blocked = await t.as('get', '/tenant', userId, { tenant });
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

    await t.as('post', `/platform/tenants/${tenant}/activate`, admin, { claims: mfa });
    expect((await t.as('get', '/tenant', userId, { tenant })).status).toBe(200);

    const actions = await t.base.auditLog.findMany({
      where: { tenantId: tenant },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(['tenant.activated', 'tenant.suspended']);
  });

  it('paginates and shows member counts', async () => {
    const tenant = await t.createTenant();
    await t.createMember(tenant, 'owner');
    const list = await t.as('get', '/platform/tenants?limit=1', admin, { claims: mfa });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.limit).toBe(1);
    const detail = await t.as('get', `/platform/tenants/${tenant}`, admin, { claims: mfa });
    expect(detail.body.data.memberCount).toBe(1);
    const missing = await t.as('get', `/platform/tenants/${randomUUID()}`, admin, { claims: mfa });
    expect(missing.status).toBe(404);
  });
});
