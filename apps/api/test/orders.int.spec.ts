import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { TENANT_PERMISSIONS } from '@tahi/types';
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
import { yearIn } from '../src/core/numbering/counter.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { MeasurementsModule } from '../src/modules/measurements/measurements.module.js';
import { OrdersModule } from '../src/modules/orders/orders.module.js';
import { PrivacyModule } from '../src/modules/privacy/privacy.module.js';
import { QuotationsModule } from '../src/modules/quotations/quotations.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = <T = Json>(res: { body: unknown }) => (res.body as { data: T }).data;
const amount = (m: unknown) => (m as { amount: string }).amount;
const statuses = (o: Json) =>
  (o.history as Json[]).map((h) => `${String(h.fromStatus)}→${String(h.toStatus)}`);

/** Orders (ADR-034): conversion, direct sales, snapshots, the status flow and erasure. */
describe('Orders (integration)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let sessions: SessionService;
  const server = (): App => app.getHttpServer() as App;

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
    return b;
  }

  /** An atelier (12% VAT inside prices), a client with measurements, and a sent quotation. */
  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      clerk: ['orders.read', 'orders.write', 'clients.read'],
    });
    await asTenant(prisma, t.tenantId, (tx) =>
      tx.tenantSettings.update({ where: { tenantId: t.tenantId }, data: { taxRate: '12' } }),
    );
    const b = await member(t, 'owner');
    const client = data(await b.post('tenant/clients', { firstName: 'Ana', lastName: 'Cruz' }));
    const clientId = client.id as string;
    const category = data(await b.post('tenant/garment-categories', { name: 'Gown' }));
    await b.send('put', `tenant/garment-categories/${category.id as string}/template`, {
      fields: [{ key: 'bust', label: 'Bust', required: true }],
    });
    const measure = (bust: string, supersedesId?: string) =>
      b
        .post(`tenant/clients/${clientId}/measurements`, {
          categoryId: category.id,
          values: { bust },
          ...(supersedesId ? { supersedesId } : {}),
        })
        .then((r) => data(r).id as string);
    const recordId = await measure('86');
    const quotation = async () => {
      const q = data(
        await b.post('tenant/quotations', {
          clientId,
          validUntil: '2040-01-31',
          discount: '500',
          notes: 'Ivory silk',
          items: [
            {
              name: 'Wedding gown',
              unitPrice: '45000',
              quantity: 1,
              measurementRecordId: recordId,
            },
            { name: 'Veil', unitPrice: '3500', quantity: 1 },
          ],
        }),
      );
      await b.post(`tenant/quotations/${q.id as string}/send`, {});
      return q;
    };
    return { t, b, clerk: await member(t, 'clerk'), clientId, recordId, measure, quotation };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [
        CoreModule,
        HttpModule,
        AuthCoreModule,
        AuditModule,
        AuthModule,
        ClientsModule,
        MeasurementsModule,
        QuotationsModule,
        OrdersModule,
        PrivacyModule,
      ],
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

  it('converts an accepted quotation once, with prices as quoted and measurements frozen', async () => {
    const s = await setup();
    const q = await s.quotation();
    const convert = () =>
      s.b.post('tenant/orders/from-quotation', { quotationId: q.id, promisedDate: '2040-03-01' });

    expect(code((await convert()).body)).toBe('QUOTATION_NOT_ACCEPTED'); // still SENT
    await s.b.post(`tenant/quotations/${q.id as string}/accept`, {});

    // Concurrent repeats all get the same order.
    const results = await Promise.all([convert(), convert(), convert()]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = new Set(results.map((r) => data(r).id));
    expect(ids.size).toBe(1);
    const o = data(results[0]);
    expect(o).toMatchObject({
      number: `ORD-${yearIn('Asia/Manila')}-0001`,
      quotationId: q.id,
      status: 'CONFIRMED',
      promisedDate: '2040-03-01',
      notes: 'Ivory silk',
    });
    expect([o.subtotal, o.discount, o.tax, o.total].map(amount)).toEqual(
      [q.subtotal, q.discount, q.tax, q.total].map(amount),
    );
    expect(statuses(o)).toEqual(['null→CONFIRMED']);
    const [gown] = o.items as Json[];
    expect(gown).toMatchObject({
      name: 'Wedding gown',
      measurementRecordId: s.recordId,
      measurementSnapshot: {
        recordId: s.recordId,
        category: 'Gown',
        unit: 'CM',
        values: [{ key: 'bust', label: 'Bust', value: '86' }],
      },
    });
    expect(data(await s.b.get(`tenant/quotations/${q.id as string}`)).status).toBe('CONVERTED');
    expect(data(await convert()).id).toBe(o.id);

    // A newer measurement revision doesn't change what the order was cut from.
    await s.measure('88', s.recordId);
    const later = data(await s.b.get(`tenant/orders/${o.id as string}`));
    const snap = (later.items as Json[])[0]!.measurementSnapshot as { values: Json[] };
    expect(snap.values[0]).toMatchObject({ value: '86' });
  });

  it('sells directly, edits lines only while confirmed, and moves forward only', async () => {
    const s = await setup();
    const res = await s.clerk.post('tenant/orders', {
      clientId: s.clientId,
      items: [{ name: 'Barong (ready-to-wear)', unitPrice: '5600', quantity: 1 }],
    });
    expect(res.status).toBe(201);
    const o = data(res);
    expect([o.total, o.tax].map(amount)).toEqual(['5600.00', '600.00']); // 5600 × 12/112
    const path = `tenant/orders/${o.id as string}`;

    const items = [{ name: 'Barong (ready-to-wear)', unitPrice: '5600', quantity: 2 }];
    const edited = await s.clerk.send('put', path, { version: 1, items, discount: '200' });
    expect(amount(data(edited).total)).toBe('11000.00');
    expect(code((await s.clerk.send('put', path, { version: 1, notes: 'x' })).body)).toBe(
      'VERSION_CONFLICT',
    );

    expect(data(await s.clerk.post(`${path}/status`, { status: 'IN_PRODUCTION' })).status).toBe(
      'IN_PRODUCTION',
    );
    const late = await s.clerk.send('put', path, { version: 3, items });
    expect(code(late.body)).toBe('INVALID_ORDER_STATUS');
    expect(
      data(await s.clerk.send('put', path, { version: 3, promisedDate: '2040-05-01' }))
        .promisedDate,
    ).toBe('2040-05-01');
    expect(code((await s.clerk.post(`${path}/status`, { status: 'IN_PRODUCTION' })).body)).toBe(
      'INVALID_ORDER_STATUS',
    );
    const released = data(await s.clerk.post(`${path}/status`, { status: 'RELEASED' }));
    expect(statuses(released)).toEqual([
      'null→CONFIRMED',
      'CONFIRMED→IN_PRODUCTION',
      'IN_PRODUCTION→RELEASED',
    ]);
    expect(code((await s.b.post(`${path}/cancel`, { reason: 'late' })).body)).toBe(
      'INVALID_ORDER_STATUS',
    );

    // Cancelling needs orders.cancel.
    const other = data(await s.clerk.post('tenant/orders', { clientId: s.clientId, items }));
    const cancelPath = `tenant/orders/${other.id as string}/cancel`;
    expect((await s.clerk.post(cancelPath, { reason: 'Changed mind' })).status).toBe(403);
    const cancelled = data(await s.b.post(cancelPath, { reason: 'Changed mind' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Changed mind' });

    // The timeline is append-only, even for the app's own role.
    const tamper = asTenant(prisma, s.t.tenantId, (tx) =>
      tx.orderStatusHistory.deleteMany({ where: { orderId: o.id as string } }),
    );
    await expect(tamper).rejects.toThrow(/append-only/);
  });

  it('erasure waits for open orders, then drops measurement snapshots but keeps prices', async () => {
    const s = await setup();
    const q = await s.quotation();
    await s.b.post(`tenant/quotations/${q.id as string}/accept`, {});
    const o = data(await s.b.post('tenant/orders/from-quotation', { quotationId: q.id }));
    const erase = () =>
      s.b.post(`tenant/clients/${s.clientId}/erase`, { reason: 'DATA_SUBJECT_REQUEST' });

    expect(code((await erase()).body)).toBe('CLIENT_HAS_OPEN_ORDERS');
    const exp = data(await s.b.get(`tenant/clients/${s.clientId}/export`));
    expect((exp.orders as Json[]).map((x) => x.id)).toEqual([o.id]);

    await s.b.post(`tenant/orders/${o.id as string}/cancel`, { reason: 'Ana Cruz moved abroad' });
    expect((await erase()).status).toBe(204);
    const after = data(await s.b.get(`tenant/orders/${o.id as string}`));
    expect(after).toMatchObject({
      notes: null,
      cancelReason: 'Erased',
      client: { name: 'Erased client' },
    });
    expect((after.items as Json[])[0]).toMatchObject({
      measurementRecordId: null,
      measurementSnapshot: null,
    });
    expect(amount(after.total)).toBe(amount(o.total));
  });
});
