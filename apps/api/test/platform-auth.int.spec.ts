import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { PLATFORM_ROLE_PERMISSIONS } from '@tahi/types';
import {
  apiErrorSchema,
  mfaVerifiedResponseSchema,
  platformMeResponseSchema,
} from '@tahi/validation';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { SuperAdminExistsError, createSuperAdmin } from '../src/cli/create-super-admin.js';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { hashPassword } from '../src/core/auth/password.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { base32Decode, hotp, stepAt } from '../src/core/auth/totp.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { PlatformModule } from '../src/modules/platform/platform.module.js';
import { Browser } from './browser.js';
import { suffix } from './fixtures.js';

type App = Parameters<typeof request>[0];
const ADMIN = 'admin.tahi.test';
const PASSWORD = 'admin password 123';

describe('Platform admin authentication (integration: real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  const server = (): App => app.getHttpServer() as App;
  const browser = (host = ADMIN) =>
    new Browser(server, host, host === ADMIN ? 'platform/auth/csrf' : 'auth/csrf');
  const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
  const data = (body: unknown) => (body as { data: unknown }).data;

  async function admin(
    role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' = 'PLATFORM_ADMIN',
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  ) {
    const email = `admin-${suffix()}@tahi.test`;
    const a = await prisma.platformUser.create({
      data: { email, name: 'Ops', passwordHash: await hashPassword(PASSWORD), role, status },
    });
    return { ...a, email };
  }

  /** Logs in and completes enrollment; returns the browser, base32 secret and step used. */
  async function enrolled(role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' = 'PLATFORM_ADMIN') {
    const a = await admin(role);
    const b = browser();
    await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
    const { secret } = data((await b.post('platform/auth/mfa/enroll')).body) as { secret: string };
    const step = stepAt(Date.now());
    const res = await b.post('platform/auth/mfa/verify', {
      code: hotp(base32Decode(secret), step),
    });
    expect(res.status).toBe(200);
    const recoveryCodes = mfaVerifiedResponseSchema.parse(data(res.body)).recoveryCodes!;
    return { a, b, secret: base32Decode(secret), step, recoveryCodes };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, PlatformModule],
    })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore())
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('password step', () => {
    it('rejects wrong passwords and unknown admins alike', async () => {
      const a = await admin();
      const wrong = await browser().post('platform/auth/login', {
        email: a.email,
        password: 'nope nope nope',
      });
      const unknown = await browser().post('platform/auth/login', {
        email: `x-${suffix()}@tahi.test`,
        password: PASSWORD,
      });
      expect([wrong.status, unknown.status]).toEqual([401, 401]);
      expect(code(wrong.body)).toBe('INVALID_CREDENTIALS');
    });

    it('gives a 5-minute session that only MFA endpoints accept', async () => {
      const a = await admin();
      const b = browser();
      const res = await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
      expect(data(res.body)).toEqual({ next: 'mfa_enroll' });
      const me = platformMeResponseSchema.parse(data((await b.get('platform/auth/me')).body));
      expect(me.mfa).toEqual({ enrolled: false, verified: false });
      expect(me.permissions).toEqual([]);
      const s = await prisma.session.findFirstOrThrow({
        where: { subjectId: a.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(s.mfaVerifiedAt).toBeNull();
      expect(s.absoluteExpiresAt.getTime() - s.createdAt.getTime()).toBeLessThanOrEqual(5 * 60_000);
    });

    it('rejects disabled admins after the password check', async () => {
      const a = await admin('PLATFORM_ADMIN', 'DISABLED');
      expect(
        code(
          (await browser().post('platform/auth/login', { email: a.email, password: PASSWORD }))
            .body,
        ),
      ).toBe('ACCOUNT_DISABLED');
    });

    it('is served only on the admin host', async () => {
      const a = await admin();
      expect(
        (
          await browser('app.tahi.test').post('platform/auth/login', {
            email: a.email,
            password: PASSWORD,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('TOTP enrollment', () => {
    it('enrolls, issues 10 recovery codes once, and upgrades the session', async () => {
      const a = await admin('SUPER_ADMIN');
      const b = browser();
      await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
      const pre = b.cookies.get('__Host-tahi_admin')!;
      const enroll = data((await b.post('platform/auth/mfa/enroll')).body) as {
        secret: string;
        otpauthUri: string;
      };
      expect(enroll.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      // The secret is stored encrypted, never in plain or base32 form.
      const row = await prisma.platformUser.findUniqueOrThrow({ where: { id: a.id } });
      expect(Buffer.from(row.mfaSecretEnc!).includes(base32Decode(enroll.secret))).toBe(false);
      expect(Buffer.from(row.mfaSecretEnc!).toString('latin1')).not.toContain(enroll.secret);

      expect(code((await b.post('platform/auth/mfa/verify', { code: '000000' })).body)).toBe(
        'INVALID_MFA_CODE',
      );
      const ok = await b.post('platform/auth/mfa/verify', {
        code: hotp(base32Decode(enroll.secret), stepAt(Date.now())),
      });
      const body = mfaVerifiedResponseSchema.parse(data(ok.body));
      expect(body.recoveryCodes).toHaveLength(10);
      expect(body.me.mfa).toEqual({ enrolled: true, verified: true });
      expect(body.me.permissions).toEqual([...PLATFORM_ROLE_PERMISSIONS.SUPER_ADMIN]);

      expect(b.cookies.get('__Host-tahi_admin')).not.toBe(pre);
      const old = browser();
      old.cookies.set('__Host-tahi_admin', pre);
      expect((await old.get('platform/auth/me')).status).toBe(401);

      expect(code((await b.post('platform/auth/mfa/enroll')).body)).toBe('MFA_ALREADY_ENROLLED');
      const stored = await prisma.platformRecoveryCode.findMany({
        where: { platformUserId: a.id },
      });
      expect(stored).toHaveLength(10);
      expect(
        stored.some((c) =>
          Buffer.from(c.codeHash).toString('utf8').includes(body.recoveryCodes![0]!),
        ),
      ).toBe(false);
    });

    it('cannot enroll again from a password-only session once enrolled', async () => {
      const { a } = await enrolled();
      const b = browser();
      expect(
        data((await b.post('platform/auth/login', { email: a.email, password: PASSWORD })).body),
      ).toEqual({
        next: 'mfa_verify',
      });
      expect(code((await b.post('platform/auth/mfa/enroll')).body)).toBe('MFA_ALREADY_ENROLLED');
    });
  });

  describe('later logins', () => {
    it('never accepts the same code twice (replay)', async () => {
      const { a, secret, step } = await enrolled();
      const b = browser();
      await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
      expect(
        code((await b.post('platform/auth/mfa/verify', { code: hotp(secret, step) })).body),
      ).toBe('INVALID_MFA_CODE');
      expect(
        (await b.post('platform/auth/mfa/verify', { code: hotp(secret, step + 1) })).status,
      ).toBe(200);
    });

    it('accepts each recovery code once', async () => {
      const { a, recoveryCodes } = await enrolled();
      const b = browser();
      await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
      const r = await b.post('platform/auth/mfa/recover', {
        code: recoveryCodes[0]!.toUpperCase(),
      });
      expect(r.status).toBe(200);
      expect(mfaVerifiedResponseSchema.parse(data(r.body)).recoveryCodesRemaining).toBe(9);

      const again = browser();
      await again.post('platform/auth/login', { email: a.email, password: PASSWORD });
      expect(
        code((await again.post('platform/auth/mfa/recover', { code: recoveryCodes[0] })).body),
      ).toBe('INVALID_MFA_CODE');
    });

    it('limits code attempts per session', async () => {
      const { a } = await enrolled();
      const b = browser();
      await b.post('platform/auth/login', { email: a.email, password: PASSWORD });
      for (let i = 0; i < 5; i++) await b.post('platform/auth/mfa/verify', { code: '000000' });
      expect(code((await b.post('platform/auth/mfa/verify', { code: '000000' })).body)).toBe(
        'RATE_LIMITED',
      );
    });

    it('logs out', async () => {
      const { b } = await enrolled();
      expect((await b.post('platform/auth/logout')).status).toBe(200);
      expect((await b.get('platform/auth/me')).status).toBe(401);
    });
  });

  describe('Super Admin bootstrap', () => {
    it('refuses once a Super Admin exists', async () => {
      await admin('SUPER_ADMIN');
      await expect(
        createSuperAdmin(prisma, {
          email: `s-${suffix()}@tahi.test`,
          name: 'S',
          password: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(SuperAdminExistsError);
    });

    it('validates input before touching the database', async () => {
      await expect(
        createSuperAdmin(prisma, { email: 'bad', name: 'S', password: PASSWORD }),
      ).rejects.toBeInstanceOf(ZodError);
      await expect(
        createSuperAdmin(prisma, { email: 'a@b.ph', name: 'S', password: 'short' }),
      ).rejects.toBeInstanceOf(ZodError);
    });
  });
});
