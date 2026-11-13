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
import { TenantJobRunner } from '../src/core/tenancy/tenant-job-runner.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { MeasurementsModule } from '../src/modules/measurements/measurements.module.js';
import { PrivacyModule } from '../src/modules/privacy/privacy.module.js';
import { QuotationExpiryService } from '../src/modules/quotations/quotation-expiry.service.js';
import {
  QuotationsModule,
  QuotationsWorkerModule,
} from '../src/modules/quotations/quotations.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = <T = Json>(res: { body: unknown }) => (res.body as { data: T }).data;
const amount = (m: unknown) => (m as { amount: string }).amount;
const FUTURE = '2040-06-30';

/** Quotations (ADR-033): pricing, snapshots, lifecycle, numbering, expiry and erasure. */
describe('Quotations (integration)', () => {
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

  /**
   * An atelier at 12% VAT (prices include tax) with a ₱18,500 barong offering a required
   * single-choice Fabric group (Piña +2,500, Own fabric −500), a client with measurements,
   * and a quote-priced alteration service.
   */
  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      reader: ['quotations.read'],
    });
    await asTenant(prisma, t.tenantId, (tx) =>
      tx.tenantSettings.update({ where: { tenantId: t.tenantId }, data: { taxRate: '12' } }),
    );
    const b = await member(t, 'owner');
    const barong = data(
      await b.post('tenant/catalog/items', {
        kind: 'PRODUCT',
        name: 'Piña Barong',
        fulfilment: 'MADE_TO_MEASURE',
        pricingMode: 'FIXED',
        basePrice: '18500',
      }),
    );
    const alteration = data(
      await b.post('tenant/catalog/items', {
        kind: 'SERVICE',
        name: 'Alteration',
        pricingMode: 'QUOTE',
      }),
    );
    const fabric = data(
      await b.post('tenant/catalog/option-groups', {
        name: 'Fabric',
        selection: 'SINGLE',
        required: true,
      }),
    );
    const opt = async (name: string, priceDelta: string) => {
      const g = data(
        await b.post(`tenant/catalog/option-groups/${fabric.id as string}/options`, {
          name,
          priceDelta,
        }),
      );
      return (g.options as Json[]).find((o) => o.name === name)!.id as string;
    };
    const pina = await opt('Piña', '2500');
    const own = await opt('Own fabric', '-500');
    await b.send('put', `tenant/catalog/items/${barong.id as string}/option-groups`, {
      groupIds: [fabric.id],
    });
    const client = data(await b.post('tenant/clients', { firstName: 'Ana', lastName: 'Cruz' }));
    const other = data(await b.post('tenant/clients', { firstName: 'Bea' }));
    const category = data(await b.post('tenant/garment-categories', { name: 'Barong' }));
    await b.send('put', `tenant/garment-categories/${category.id as string}/template`, {
      fields: [{ key: 'chest', label: 'Chest', required: true }],
    });
    const record = (clientId: unknown) =>
      b
        .post(`tenant/clients/${clientId as string}/measurements`, {
          categoryId: category.id,
          values: { chest: '96' },
        })
        .then((r) => data(r).id as string);
    return {
      t,
      b,
      reader: await member(t, 'reader'),
      barongId: barong.id as string,
      alterationId: alteration.id as string,
      pina,
      own,
      clientId: client.id as string,
      otherId: other.id as string,
      recordId: await record(client.id),
      otherRecordId: await record(other.id),
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const draft = (s: Setup, extra: Json = {}) =>
    s.b.post('tenant/quotations', {
      clientId: s.clientId,
      validUntil: FUTURE,
      discount: '1000',
      items: [
        {
          catalogItemId: s.barongId,
          quantity: 1,
          optionIds: [s.pina],
          measurementRecordId: s.recordId,
        },
        { name: 'Monogram', unitPrice: '350.50', quantity: 3 },
      ],
      ...extra,
    });

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
        CatalogModule,
        MeasurementsModule,
        QuotationsModule,
        QuotationsWorkerModule,
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

  it('prices lines from the catalogue with options, VAT included, and freezes them', async () => {
    const s = await setup();
    const res = await draft(s);
    expect(res.status).toBe(201);
    const q = data(res);
    expect(q).toMatchObject({
      number: `QUO-${yearIn('Asia/Manila')}-0001`,
      revision: 1,
      status: 'DRAFT',
      client: { id: s.clientId, name: 'Ana Cruz' },
      taxRate: '12.00',
      pricesIncludeTax: true,
    });
    // (18500 + 2500) + 3 × 350.50 = 22051.50; −1000 = 21051.50; VAT = 21051.50 × 12/112.
    expect([q.subtotal, q.discount, q.tax, q.total].map(amount)).toEqual([
      '22051.50',
      '1000.00',
      '2255.52',
      '21051.50',
    ]);
    const [line] = q.items as Json[];
    expect(line).toMatchObject({
      name: 'Piña Barong',
      unitPrice: { amount: '18500.00', currency: 'PHP' },
      lineTotal: { amount: '21000.00', currency: 'PHP' },
      measurementRecordId: s.recordId,
      options: [{ groupName: 'Fabric', optionName: 'Piña', priceDelta: { amount: '2500.00' } }],
    });

    // A later catalogue price change doesn't touch the quotation.
    await s.b.send('patch', `tenant/catalog/items/${s.barongId}`, { basePrice: '25000' });
    const again = data(await s.b.get(`tenant/quotations/${q.id as string}`));
    expect(amount(again.total)).toBe('21051.50');
    expect(data(await draft(s)).number).toBe(`QUO-${yearIn('Asia/Manila')}-0002`);
  });

  it('rejects lines that break the catalogue’s rules', async () => {
    const s = await setup();
    const line = (item: Json) => draft(s, { discount: '0', items: [item] });
    const barong = { catalogItemId: s.barongId, quantity: 1 };

    const noFabric = await line({ ...barong, optionIds: [] });
    expect(noFabric.status).toBe(422);
    const twoFabrics = await line({ ...barong, optionIds: [s.pina, s.own] });
    expect(twoFabrics.status).toBe(422);
    const notOnItem = await line({
      catalogItemId: s.alterationId,
      unitPrice: '500',
      quantity: 1,
      optionIds: [s.pina],
    });
    expect(notOnItem.status).toBe(404);
    expect((await line({ catalogItemId: s.alterationId, quantity: 1 })).status).toBe(422);
    const wrongClient = await line({
      ...barong,
      optionIds: [s.pina],
      measurementRecordId: s.otherRecordId,
    });
    expect(wrongClient.status).toBe(422);
    const bigDiscount = await draft(s, { discount: '999999' });
    expect(bigDiscount.status).toBe(422);
    expect((await line({ name: 'Custom', quantity: 1 })).status).toBe(422); // no price
  });

  it('runs the lifecycle: edit with locking, send, accept; revise after a rejection', async () => {
    const s = await setup();
    const q = data(await draft(s, { validUntil: null }));
    const path = `tenant/quotations/${q.id as string}`;
    const items = [{ name: 'Hemming', unitPrice: '800', quantity: 1 }];

    const edited = await s.b.send('put', path, { version: 1, items, validUntil: null });
    expect(edited.status).toBe(200);
    expect(amount(data(edited).total)).toBe('800.00');
    const stale = await s.b.send('put', path, { version: 1, items });
    expect(stale.status).toBe(409);
    expect(code(stale.body)).toBe('VERSION_CONFLICT');

    expect((await s.b.post(`${path}/send`, {})).status).toBe(422); // no valid-until date
    await s.b.send('put', path, { version: 2, items, validUntil: FUTURE });
    const sent = await s.b.post(`${path}/send`, {});
    expect(data(sent)).toMatchObject({ status: 'SENT' });
    expect(data(sent).sentAt).toBeTruthy();
    expect((await s.b.send('put', path, { version: 4, items })).status).toBe(409);
    expect(data(await s.b.post(`${path}/accept`, {})).status).toBe('ACCEPTED');
    expect(code((await s.b.post(`${path}/reject`, {})).body)).toBe('INVALID_QUOTATION_STATUS');
    expect((await s.b.post(`${path}/revise`, {})).status).toBe(409); // accepted is final

    const second = data(await draft(s));
    const p2 = `tenant/quotations/${second.id as string}`;
    await s.b.post(`${p2}/send`, {});
    await s.b.post(`${p2}/reject`, {});
    const rev = await s.b.post(`${p2}/revise`, {});
    expect(rev.status).toBe(201);
    expect(data(rev)).toMatchObject({
      number: second.number,
      revision: 2,
      supersedesId: second.id,
      status: 'DRAFT',
      validUntil: null,
      total: second.total,
    });
    expect((data(rev).items as Json[]).length).toBe(2);
    expect(data(await s.b.get(p2)).status).toBe('SUPERSEDED');
    expect((await s.b.post(`${p2}/revise`, {})).status).toBe(409);

    const list = data<Json[]>(await s.reader.get(`tenant/quotations?clientId=${s.clientId}`));
    expect(list.map((x) => x.status).sort()).toEqual(['ACCEPTED', 'DRAFT', 'SUPERSEDED']);
    expect(
      (await s.reader.post('tenant/quotations', { clientId: s.clientId, items: [] })).status,
    ).toBe(403);
  });

  it('expires sent quotations past their date, and refuses to accept them', async () => {
    const s = await setup();
    const q = data(await draft(s));
    const path = `tenant/quotations/${q.id as string}`;
    await s.b.post(`${path}/send`, {});
    await asTenant(prisma, s.t.tenantId, (tx) =>
      tx.quotation.update({
        where: { id: q.id as string },
        data: { validUntil: new Date('2020-01-31') },
      }),
    );
    const accept = await s.b.post(`${path}/accept`, {});
    expect(code(accept.body)).toBe('QUOTATION_EXPIRED');

    const expired = await app
      .get(TenantJobRunner)
      .run(s.t.tenantId, () => app.get(QuotationExpiryService).expireDue());
    expect(expired).toBe(1);
    expect(data(await s.b.get(path)).status).toBe('EXPIRED');
    expect(data(await s.b.post(`${path}/revise`, {})).revision).toBe(2);
  });

  it('allocates distinct numbers under concurrency', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => draft(s, { items: [], discount: '0' })),
    );
    const numbers = results.map((r) => data(r).number as string).sort();
    const year = yearIn('Asia/Manila');
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `QUO-${year}-000${i + 1}`));
  });

  it('erasure waits for sent quotations, then clears notes and measurement links', async () => {
    const s = await setup();
    const sent = data(await draft(s, { notes: 'Prefers ivory' }));
    const keep = data(await draft(s));
    await s.b.post(`tenant/quotations/${sent.id as string}/send`, {});
    const erase = (id: string) =>
      s.b.post(`tenant/clients/${id}/erase`, { reason: 'DATA_SUBJECT_REQUEST' });

    const blocked = await erase(s.clientId);
    expect(code(blocked.body)).toBe('CLIENT_HAS_OPEN_QUOTATIONS');
    await s.b.post(`tenant/quotations/${sent.id as string}/reject`, {});
    expect((await erase(s.clientId)).status).toBe(204);

    const after = data(await s.b.get(`tenant/quotations/${sent.id as string}`));
    expect(after.notes).toBeNull();
    expect((after.items as Json[])[0]!.measurementRecordId).toBeNull();
    expect(amount(after.total)).toBe('21051.50'); // prices are kept
    // The erased client's draft is frozen.
    const put = await s.b.send('put', `tenant/quotations/${keep.id as string}`, {
      version: 1,
      items: [],
    });
    expect(put.status).toBe(404);
  });
});
