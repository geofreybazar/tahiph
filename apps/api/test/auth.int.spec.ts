import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { TENANT_PERMISSIONS } from '@tahi/types';
import { apiErrorSchema, meResponseSchema } from '@tahi/validation';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { MAILER, type EmailMessage, type Mailer } from '../src/core/email/email.types.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { TenantsModule } from '../src/modules/tenants/tenants.module.js';
import { Browser } from './browser.js';
import { suffix } from './fixtures.js';

type App = Parameters<typeof request>[0];
const APP = 'app.tahi.test';
const PASSWORD = 'correct horse battery';

/** Captures queued emails instead of using BullMQ. */
class Outbox implements Mailer {
  readonly sent: EmailMessage[] = [];
  send(m: EmailMessage) {
    this.sent.push(m);
    return Promise.resolve();
  }
  /** The token from the newest email to `to` whose link contains `path`. */
  token(to: string, path: string): string {
    const m = [...this.sent].reverse().find((e) => e.to === to && e.text.includes(path));
    const t = m && new RegExp(`${path}\\?token=([A-Za-z0-9_-]{43})`).exec(m.text)?.[1];
    if (!t) throw new Error(`no ${path} email for ${to}`);
    return t;
  }
  to(addr: string) {
    return this.sent.filter((e) => e.to === addr);
  }
}

describe('Staff authentication (integration: real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  const outbox = new Outbox();
  const server = (): App => app.getHttpServer() as App;
  const browser = () => new Browser(server, APP);
  const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
  const me = (body: unknown) => meResponseSchema.parse((body as { data: unknown }).data);
  const email = () => `staff-${suffix()}@example.test`;

  /** Registers, verifies and returns a signed-in browser. */
  async function signedIn(addr = email(), name = 'Maria') {
    const b = browser();
    expect((await b.post('auth/register', { email: addr, password: PASSWORD, name })).status).toBe(
      202,
    );
    const res = await b.post('auth/verify-email', { token: outbox.token(addr, '/verify-email') });
    expect(res.status).toBe(200);
    return { b, addr };
  }

  async function withAtelier(slug = `a-${suffix()}`) {
    const s = await signedIn();
    const res = await s.b.post('onboarding/tenant', { businessName: 'Maria Couture', slug });
    expect(res.status).toBe(201);
    const data = (res.body as { data: { atelier: { id: string }; membershipId: string } }).data;
    return { ...s, slug, tenantId: data.atelier.id, membershipId: data.membershipId };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, AuthModule, TenantsModule],
    })
      .overrideProvider(MAILER)
      .useValue(outbox)
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore()) // rate-limit keys are unique per test (emails, browser IPs)
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('CSRF', () => {
    it('rejects login without Origin or token', async () => {
      const raw = () =>
        request(server())
          .post('/api/v1/auth/login')
          .set('Host', APP)
          .send({ email: 'a@b.ph', password: 'x' });
      expect(code((await raw()).body)).toBe('CSRF_ORIGIN_MISMATCH');
      expect(code((await raw().set('Origin', `http://${APP}`)).body)).toBe('CSRF_TOKEN_INVALID');
    });

    it('issues a CSRF cookie readable by the page', async () => {
      const res = await request(server()).get('/api/v1/auth/csrf').set('Host', APP).expect(200);
      const c = Browser.setCookies(res).find((x) => x.startsWith('__Host-tahi_csrf='))!;
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/SameSite=Strict/);
      expect(c).not.toMatch(/HttpOnly/);
    });
  });

  describe('registration and email verification', () => {
    it('registers, blocks login until verified, then signs in through the link', async () => {
      const b = browser();
      const addr = email();
      expect(
        (
          await b.post('auth/register', {
            email: addr.toUpperCase(),
            password: PASSWORD,
            name: 'Ana',
          })
        ).status,
      ).toBe(202);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
      expect(user.status).toBe('PENDING_VERIFICATION');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);

      expect(code((await b.post('auth/login', { email: addr, password: PASSWORD })).body)).toBe(
        'EMAIL_NOT_VERIFIED',
      );

      const token = outbox.token(addr, '/verify-email');
      const res = await b.post('auth/verify-email', { token });
      expect(res.status).toBe(200);
      const session = Browser.setCookies(res).find((c) => c.startsWith('__Host-tahi_app='))!;
      expect(session).toMatch(/HttpOnly/);
      expect(session).toMatch(/Secure/);
      expect(session).toMatch(/SameSite=Lax/);
      expect(session).toMatch(/Path=\//);
      expect(session).not.toMatch(/Domain=/i);
      expect(me(res.body)).toMatchObject({
        user: { email: addr, name: 'Ana' },
        activeMembershipId: null,
        memberships: [],
      });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      expect(code((await browser().post('auth/verify-email', { token })).body)).toBe(
        'INVALID_TOKEN',
      );
    });

    it('does not reveal existing accounts (always 202) and emails the owner instead', async () => {
      const { addr } = await signedIn();
      const before = await prisma.user.count({ where: { email: addr } });
      expect(
        (await browser().post('auth/register', { email: addr, password: PASSWORD, name: 'X' }))
          .status,
      ).toBe(202);
      expect(await prisma.user.count({ where: { email: addr } })).toBe(before);
      expect(outbox.to(addr).at(-1)?.subject).toBe('You already have a TAHI.ph account');
    });

    it('validates input and rejects unknown keys', async () => {
      const b = browser();
      expect(
        code((await b.post('auth/register', { email: 'bad', password: PASSWORD, name: 'X' })).body),
      ).toBe('VALIDATION_FAILED');
      expect(
        code(
          (await b.post('auth/register', { email: email(), password: 'short', name: 'X' })).body,
        ),
      ).toBe('VALIDATION_FAILED');
      expect(
        (
          await b.post('auth/register', {
            email: email(),
            password: PASSWORD,
            name: 'X',
            role: 'admin',
          })
        ).status,
      ).toBe(422);
    });

    it('limits verification emails per address', async () => {
      const b = browser();
      const addr = email();
      await b.post('auth/register', { email: addr, password: PASSWORD, name: 'X' });
      await b.post('auth/resend-verification', { email: addr });
      await b.post('auth/resend-verification', { email: addr });
      expect(code((await b.post('auth/resend-verification', { email: addr })).body)).toBe(
        'RATE_LIMITED',
      );
    });
  });

  describe('login and logout', () => {
    it('signs in, rotates the session, and signs out', async () => {
      const { b, addr } = await signedIn();
      const first = b.cookies.get('__Host-tahi_app')!;
      const res = await b.post('auth/login', { email: addr, password: PASSWORD });
      expect(res.status).toBe(200);
      const second = b.cookies.get('__Host-tahi_app')!;
      expect(second).not.toBe(first);

      const old = browser();
      old.cookies.set('__Host-tahi_app', first);
      expect((await old.get('auth/me')).status).toBe(401);

      expect((await b.get('auth/me')).status).toBe(200);
      expect((await b.post('auth/logout')).status).toBe(200);
      expect(b.cookies.has('__Host-tahi_app')).toBe(false);
      const reuse = browser();
      reuse.cookies.set('__Host-tahi_app', second);
      expect((await reuse.get('auth/me')).status).toBe(401);
    });

    it('returns the same error for unknown emails and wrong passwords', async () => {
      const { addr } = await signedIn();
      const b = browser();
      const wrong = await b.post('auth/login', { email: addr, password: 'wrong password!' });
      const unknown = await b.post('auth/login', { email: email(), password: PASSWORD });
      expect([wrong.status, unknown.status]).toEqual([401, 401]);
      expect(code(wrong.body)).toBe('INVALID_CREDENTIALS');
      expect(apiErrorSchema.parse(unknown.body).error.message).toBe(
        apiErrorSchema.parse(wrong.body).error.message,
      );
    });

    it('backs off an account after 5 failures, even with the right password', async () => {
      const { addr } = await signedIn();
      for (let i = 0; i < 5; i++) {
        expect(
          (await browser().post('auth/login', { email: addr, password: 'wrong password!' })).status,
        ).toBe(401);
      }
      expect(
        code((await browser().post('auth/login', { email: addr, password: PASSWORD })).body),
      ).toBe('RATE_LIMITED');
    });

    it('limits login attempts per IP', async () => {
      const b = browser();
      for (let i = 0; i < 20; i++) await b.post('auth/login', { email: email(), password: 'x' });
      expect(code((await b.post('auth/login', { email: email(), password: 'x' })).body)).toBe(
        'RATE_LIMITED',
      );
    });

    it('writes audit entries without secrets', async () => {
      const { addr } = await signedIn();
      await browser().post('auth/login', { email: addr, password: 'wrong password!' });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
      const actions = (await prisma.auditLog.findMany({ where: { actorId: user.id } })).map(
        (a) => a.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['user.registered', 'user.email_verified', 'auth.login_failed']),
      );
    });
  });

  describe('atelier onboarding', () => {
    it('creates the atelier with system roles and an owner membership, and switches into it', async () => {
      const a = await withAtelier();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: a.tenantId },
        include: { domains: true },
      });
      expect(tenant.status).toBe('TRIAL');
      expect(tenant.domains.map((d) => [d.hostname, d.verifiedAt !== null])).toEqual([
        [`${a.slug}.tahi.test`, true],
      ]);

      const res = await a.b.get('auth/me');
      const profile = me(res.body);
      expect(profile.activeMembershipId).toBe(a.membershipId);
      expect(profile.permissions).toEqual([...TENANT_PERMISSIONS].sort());
      expect(profile.memberships).toEqual([
        expect.objectContaining({ status: 'ACTIVE', role: { key: 'owner', name: 'Owner' } }),
      ]);
      const roleKeys = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
        return (await tx.role.findMany({ select: { key: true } })).map((r) => r.key).sort();
      });
      expect(roleKeys).toEqual(['admin', 'designer', 'owner', 'staff', 'tailor']);
    });

    it('rejects taken and reserved slugs', async () => {
      const a = await withAtelier();
      const other = await signedIn();
      const dup = await other.b.post('onboarding/tenant', { businessName: 'Copy', slug: a.slug });
      expect([dup.status, code(dup.body)]).toEqual([409, 'SLUG_TAKEN']);
      expect(
        (await other.b.post('onboarding/tenant', { businessName: 'X', slug: 'admin' })).status,
      ).toBe(422);
    });

    it('requires a session', async () => {
      expect(
        (await browser().post('onboarding/tenant', { businessName: 'X', slug: `a-${suffix()}` }))
          .status,
      ).toBe(401);
    });
  });

  describe('invitations', () => {
    async function roleId(tenantId: string, key: string) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return (await tx.role.findFirstOrThrow({ where: { key } })).id;
      });
    }

    it('invites a new person, who creates an account and joins with the invited role', async () => {
      const owner = await withAtelier();
      const invitee = email();
      const designer = await roleId(owner.tenantId, 'designer');
      const res = await owner.b.post('tenant/invitations', { email: invitee, roleId: designer });
      expect(res.status).toBe(201);
      const token = outbox.token(invitee, '/accept-invitation');

      const b = browser();
      expect(code((await b.post('auth/accept-invitation', { token })).body)).toBe(
        'ACCOUNT_DETAILS_REQUIRED',
      );
      const joined = await b.post('auth/accept-invitation', {
        token,
        name: 'Rosa',
        password: PASSWORD,
      });
      expect(joined.status).toBe(200);
      const profile = me(joined.body);
      expect(profile.memberships).toEqual([
        expect.objectContaining({ role: { key: 'designer', name: 'Designer' } }),
      ]);
      expect(profile.permissions).toContain('clients.write');
      expect(profile.permissions).not.toContain('staff.manage');

      expect(
        code(
          (await browser().post('auth/accept-invitation', { token, name: 'X', password: PASSWORD }))
            .body,
        ),
      ).toBe('INVALID_TOKEN');
      // The invitee cannot invite (no staff.manage).
      expect(
        (await b.post('tenant/invitations', { email: email(), roleId: designer })).status,
      ).toBe(403);
    });

    it('requires an existing account to be signed in as the invited email', async () => {
      const owner = await withAtelier();
      const existing = await signedIn();
      await owner.b.post('tenant/invitations', {
        email: existing.addr,
        roleId: await roleId(owner.tenantId, 'staff'),
      });
      const token = outbox.token(existing.addr, '/accept-invitation');

      expect((await browser().post('auth/accept-invitation', { token })).status).toBe(401);
      const stranger = await signedIn();
      expect((await stranger.b.post('auth/accept-invitation', { token })).status).toBe(401);
      expect((await existing.b.post('auth/accept-invitation', { token })).status).toBe(200);
      expect(me((await existing.b.get('auth/me')).body).activeMembershipId).not.toBeNull();

      await owner.b
        .post('tenant/invitations', {
          email: existing.addr,
          roleId: await roleId(owner.tenantId, 'staff'),
        })
        .then((r) => {
          expect([r.status, code(r.body)]).toEqual([409, 'ALREADY_MEMBER']);
        });
    });

    it('rejects another atelier’s role ids and the owner role', async () => {
      const owner = await withAtelier();
      const other = await withAtelier();
      const foreign = await owner.b.post('tenant/invitations', {
        email: email(),
        roleId: await roleId(other.tenantId, 'staff'),
      });
      expect(foreign.status).toBe(404);
      const own = await owner.b.post('tenant/invitations', {
        email: email(),
        roleId: await roleId(owner.tenantId, 'owner'),
      });
      expect(code(own.body)).toBe('ROLE_NOT_ASSIGNABLE');
    });
  });

  describe('switching ateliers', () => {
    it('requires a choice with several ateliers, and only accepts the user’s own memberships', async () => {
      const a = await withAtelier();
      await a.b.post('onboarding/tenant', { businessName: 'Second', slug: `b-${suffix()}` });
      const second = me((await a.b.get('auth/me')).body);
      expect(second.memberships).toHaveLength(2);

      const fresh = browser();
      const login = await fresh.post('auth/login', { email: a.addr, password: PASSWORD });
      expect(me(login.body).activeMembershipId).toBeNull();
      expect((await fresh.get('auth/me')).status).toBe(200);

      const switched = await fresh.post('auth/switch-tenant', { membershipId: a.membershipId });
      expect(me(switched.body).activeMembershipId).toBe(a.membershipId);

      const other = await withAtelier();
      expect(
        (await fresh.post('auth/switch-tenant', { membershipId: other.membershipId })).status,
      ).toBe(404);
    });
  });

  describe('password reset', () => {
    it('resets the password, revokes every session and notifies the user', async () => {
      const { b, addr } = await signedIn();
      const other = browser();
      await other.post('auth/login', { email: addr, password: PASSWORD });

      expect((await browser().post('auth/forgot-password', { email: addr })).status).toBe(202);
      const stale = outbox.token(addr, '/reset-password');
      expect((await browser().post('auth/forgot-password', { email: addr })).status).toBe(202);
      const token = outbox.token(addr, '/reset-password');
      expect(
        code(
          (
            await browser().post('auth/reset-password', {
              token: stale,
              password: 'a new password!',
            })
          ).body,
        ),
      ).toBe('INVALID_TOKEN');

      expect(
        (await browser().post('auth/reset-password', { token, password: 'a new password!' }))
          .status,
      ).toBe(200);
      expect((await b.get('auth/me')).status).toBe(401);
      expect((await other.get('auth/me')).status).toBe(401);
      expect(outbox.to(addr).at(-1)?.subject).toBe('Your password was changed');

      expect((await browser().post('auth/login', { email: addr, password: PASSWORD })).status).toBe(
        401,
      );
      expect(
        (await browser().post('auth/login', { email: addr, password: 'a new password!' })).status,
      ).toBe(200);
      expect(
        code(
          (await browser().post('auth/reset-password', { token, password: 'another one!!' })).body,
        ),
      ).toBe('INVALID_TOKEN');
    });

    it('answers 202 for unknown emails without sending anything', async () => {
      const addr = email();
      expect((await browser().post('auth/forgot-password', { email: addr })).status).toBe(202);
      expect(outbox.to(addr)).toHaveLength(0);
    });
  });
});
