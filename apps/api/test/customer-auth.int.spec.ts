import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { apiErrorSchema, customerMeResponseSchema } from '@tahi/validation';
import type request from 'supertest';
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
import { Browser } from './browser.js';
import { asTenant, createTenant, suffix, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];

class Outbox implements Mailer {
  readonly sent: EmailMessage[] = [];
  send(m: EmailMessage) {
    this.sent.push(m);
    return Promise.resolve();
  }
  last(to: string) {
    const m = [...this.sent].reverse().find((e) => e.to === to);
    if (!m) throw new Error(`no email to ${to}`);
    return {
      code: /code for .+ is (\d{6})/.exec(m.text)![1]!,
      link: /(http\S+\/account\/verify\?token=[A-Za-z0-9_-]{43})/.exec(m.text)![1]!,
      token: /token=([A-Za-z0-9_-]{43})/.exec(m.text)![1]!,
    };
  }
}

describe('Customer sign-in (integration: real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let A: TenantFixture;
  let B: TenantFixture;
  const outbox = new Outbox();
  const server = (): App => app.getHttpServer() as App;
  const shopper = (t: TenantFixture) => new Browser(server, t.hostname, 'customer/auth/csrf');
  const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
  const email = () => `bride-${suffix()}@example.test`;

  async function signIn(t: TenantFixture, addr = email()) {
    const b = shopper(t);
    expect((await b.post('customer/auth/start', { email: addr })).status).toBe(202);
    const res = await b.post('customer/auth/verify', { email: addr, code: outbox.last(addr).code });
    expect(res.status).toBe(200);
    return { b, addr, me: customerMeResponseSchema.parse((res.body as { data: unknown }).data) };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, AuthModule],
    })
      .overrideProvider(MAILER)
      .useValue(outbox)
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore())
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
    A = await createTenant(prisma, {});
    B = await createTenant(prisma, {});
  });

  afterAll(async () => {
    await app?.close();
  });

  it('signs in with the emailed code, creating the account on first use', async () => {
    const { b, addr, me } = await signIn(A);
    expect(me.customer.email).toBe(addr);
    const cookie = b.cookies.get('__Host-tahi_cust');
    expect(cookie).toBeDefined();
    const res = await b.get('customer/auth/me');
    expect(customerMeResponseSchema.parse((res.body as { data: unknown }).data).customer.id).toBe(
      me.customer.id,
    );

    const again = await signIn(A, addr);
    expect(again.me.customer.id).toBe(me.customer.id);
  });

  it('emails a magic link to this atelier’s host, which signs in once', async () => {
    const b = shopper(A);
    const addr = email();
    await b.post('customer/auth/start', { email: addr });
    const { link, token } = outbox.last(addr);
    expect(link.startsWith(`http://${A.hostname}/account/verify?token=`)).toBe(true);
    expect((await b.post('customer/auth/verify', { token })).status).toBe(200);
    expect(code((await shopper(A).post('customer/auth/verify', { token })).body)).toBe(
      'INVALID_CODE',
    );
  });

  it('burns a code after 5 wrong attempts', async () => {
    const b = shopper(A);
    const addr = email();
    await b.post('customer/auth/start', { email: addr });
    const right = outbox.last(addr).code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(
        code((await shopper(A).post('customer/auth/verify', { email: addr, code: wrong })).body),
      ).toBe('INVALID_CODE');
    }
    expect(
      code((await shopper(A).post('customer/auth/verify', { email: addr, code: right })).body),
    ).toBe('INVALID_CODE');
  });

  it('replaces older codes when a new one is requested', async () => {
    const b = shopper(A);
    const addr = email();
    await b.post('customer/auth/start', { email: addr });
    const first = outbox.last(addr);
    await b.post('customer/auth/start', { email: addr });
    expect(code((await b.post('customer/auth/verify', { token: first.token })).body)).toBe(
      'INVALID_CODE',
    );
    expect(
      (await b.post('customer/auth/verify', { email: addr, code: outbox.last(addr).code })).status,
    ).toBe(200);
  });

  describe('tenant isolation', () => {
    it('keeps one person’s accounts at two ateliers separate', async () => {
      const addr = email();
      const atA = await signIn(A, addr);
      const atB = await signIn(B, addr);
      expect(atA.me.customer.id).not.toBe(atB.me.customer.id);

      const crossed = shopper(B);
      crossed.cookies.set('__Host-tahi_cust', atA.b.cookies.get('__Host-tahi_cust')!);
      expect((await crossed.get('customer/auth/me')).status).toBe(401);
    });

    it('does not accept another atelier’s code or link', async () => {
      const addr = email();
      await shopper(A).post('customer/auth/start', { email: addr });
      const otp = outbox.last(addr);
      expect(
        code((await shopper(B).post('customer/auth/verify', { email: addr, code: otp.code })).body),
      ).toBe('INVALID_CODE');
      expect(code((await shopper(B).post('customer/auth/verify', { token: otp.token })).body)).toBe(
        'INVALID_CODE',
      );
      expect((await shopper(A).post('customer/auth/verify', { token: otp.token })).status).toBe(
        200,
      );
    });

    it('is not served on unknown hosts or the dashboard host', async () => {
      expect(
        (
          await new Browser(server, 'nobody.tahi.test', 'customer/auth/csrf').get(
            'customer/auth/csrf',
          )
        ).status,
      ).toBe(404);
      expect((await new Browser(server, 'app.tahi.test').get('customer/auth/csrf')).status).toBe(
        404,
      );
    });
  });

  it('sends nothing to disabled accounts, and still answers 202', async () => {
    const addr = email();
    await asTenant(prisma, A.tenantId, (tx) =>
      tx.customerAccount.create({
        data: {
          tenantId: A.tenantId,
          email: addr,
          status: 'DISABLED',
          emailVerifiedAt: new Date(),
        },
      }),
    );
    expect((await shopper(A).post('customer/auth/start', { email: addr })).status).toBe(202);
    expect(outbox.sent.filter((m) => m.to === addr)).toHaveLength(0);
  });

  it('limits codes per email and atelier', async () => {
    const b = shopper(A);
    const addr = email();
    for (let i = 0; i < 3; i++)
      expect((await b.post('customer/auth/start', { email: addr })).status).toBe(202);
    expect(code((await b.post('customer/auth/start', { email: addr })).body)).toBe('RATE_LIMITED');
  });

  it('logs out', async () => {
    const { b } = await signIn(A);
    expect((await b.post('customer/auth/logout')).status).toBe(200);
    expect((await b.get('customer/auth/me')).status).toBe(401);
  });
});
