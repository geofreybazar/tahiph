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
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = (res: { body: unknown }) => (res.body as { data: Json }).data;

describe('Catalogue (integration)', () => {
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

  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      reader: ['catalog.read'],
    });
    return { t, b: await member(t, 'owner'), reader: await member(t, 'reader') };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, AuthModule, CatalogModule],
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

  it('creates fixed and quote-priced items, with money as strings', async () => {
    const { b } = await setup();
    const category = data(await b.post('tenant/catalog/categories', { name: 'Barong' }));
    const fixed = await b.post('tenant/catalog/items', {
      kind: 'PRODUCT',
      name: 'Piña Barong',
      fulfilment: 'MADE_TO_MEASURE',
      pricingMode: 'FIXED',
      basePrice: '18500',
      categoryId: category.id,
    });
    expect(fixed.status).toBe(201);
    expect(data(fixed)).toMatchObject({
      basePrice: { amount: '18500.00', currency: 'PHP' },
      category: { id: category.id, name: 'Barong' },
      optionGroups: [],
      archivedAt: null,
    });
    const quote = await b.post('tenant/catalog/items', {
      kind: 'SERVICE',
      name: 'Bridal consultation',
      pricingMode: 'QUOTE',
    });
    expect(data(quote)).toMatchObject({ basePrice: null, fulfilment: null });

    const missing = await b.post('tenant/catalog/items', {
      kind: 'SERVICE',
      name: 'Hemming',
      pricingMode: 'FIXED',
    });
    expect([missing.status, code(missing.body)]).toEqual([422, 'VALIDATION_FAILED']);
    // PATCH re-checks the merged record: switching to FIXED needs a price.
    const toFixed = await b.send('patch', `tenant/catalog/items/${data(quote).id as string}`, {
      pricingMode: 'FIXED',
    });
    expect(toFixed.status).toBe(422);
  });

  it('backs the pricing rules with database checks', async () => {
    const { t } = await setup();
    await expect(
      asTenant(prisma, t.tenantId, (tx) =>
        tx.catalogItem.create({
          data: { tenantId: t.tenantId, kind: 'SERVICE', name: 'X', pricingMode: 'FIXED' },
        }),
      ),
    ).rejects.toThrow(/catalog_item_price_check/);
    await expect(
      asTenant(prisma, t.tenantId, (tx) =>
        tx.catalogItem.create({
          data: {
            tenantId: t.tenantId,
            kind: 'SERVICE',
            name: 'X',
            pricingMode: 'QUOTE',
            fulfilment: 'READY_TO_WEAR',
          },
        }),
      ),
    ).rejects.toThrow(/catalog_item_fulfilment_check/);
  });

  it('shares option groups between items, ordered, with negative price changes', async () => {
    const { b } = await setup();
    const fabric = data(
      await b.post('tenant/catalog/option-groups', {
        name: 'Fabric',
        selection: 'SINGLE',
        required: true,
      }),
    );
    const embroidery = data(
      await b.post('tenant/catalog/option-groups', { name: 'Embroidery', selection: 'MULTIPLE' }),
    );
    const groupPath = `tenant/catalog/option-groups/${fabric.id as string}`;
    await b.post(`${groupPath}/options`, { name: 'Jusi', priceDelta: '1500', sortOrder: 2 });
    await b.post(`${groupPath}/options`, { name: 'Piña', priceDelta: '4500.50', sortOrder: 1 });
    const own = await b.post(`${groupPath}/options`, { name: 'Own fabric', priceDelta: '-2000' });
    expect(
      (data(own).options as { name: string; priceDelta: { amount: string } }[]).map((o) => [
        o.name,
        o.priceDelta.amount,
      ]),
    ).toEqual([
      ['Own fabric', '-2000.00'],
      ['Piña', '4500.50'],
      ['Jusi', '1500.00'],
    ]);

    const barong = data(
      await b.post('tenant/catalog/items', {
        kind: 'PRODUCT',
        name: 'Barong',
        pricingMode: 'QUOTE',
      }),
    );
    const suit = data(
      await b.post('tenant/catalog/items', { kind: 'PRODUCT', name: 'Suit', pricingMode: 'QUOTE' }),
    );
    const setBarong = await b.send(
      'put',
      `tenant/catalog/items/${barong.id as string}/option-groups`,
      {
        groupIds: [embroidery.id, fabric.id],
      },
    );
    expect((data(setBarong).optionGroups as Json[]).map((g) => g.name)).toEqual([
      'Embroidery',
      'Fabric',
    ]);
    await b.send('put', `tenant/catalog/items/${suit.id as string}/option-groups`, {
      groupIds: [fabric.id],
    });

    // One price change shows on both items.
    const jusi = (data(own).options as Json[]).find((o) => o.name === 'Jusi')!;
    await b.send('patch', `${groupPath}/options/${jusi.id as string}`, { priceDelta: '1800' });
    for (const id of [barong.id, suit.id]) {
      const item = data(await b.get(`tenant/catalog/items/${id as string}`));
      const groups = item.optionGroups as {
        name: string;
        options: { name: string; priceDelta: { amount: string } }[];
      }[];
      const opt = groups.find((g) => g.name === 'Fabric')!.options.find((o) => o.name === 'Jusi')!;
      expect(opt.priceDelta.amount).toBe('1800.00');
    }

    // An option id under another group is not found.
    const wrong = await b.send(
      'patch',
      `tenant/catalog/option-groups/${embroidery.id as string}/options/${jusi.id as string}`,
      { name: 'X' },
    );
    expect(wrong.status).toBe(404);
  });

  it('keeps archived groups on items but refuses to attach them anew', async () => {
    const { b } = await setup();
    const g = data(
      await b.post('tenant/catalog/option-groups', { name: 'Lining', selection: 'SINGLE' }),
    );
    const item = data(
      await b.post('tenant/catalog/items', { kind: 'PRODUCT', name: 'Gown', pricingMode: 'QUOTE' }),
    );
    const other = data(
      await b.post('tenant/catalog/items', {
        kind: 'PRODUCT',
        name: 'Dress',
        pricingMode: 'QUOTE',
      }),
    );
    await b.send('put', `tenant/catalog/items/${item.id as string}/option-groups`, {
      groupIds: [g.id],
    });
    await b.post(`tenant/catalog/option-groups/${g.id as string}/archive`);

    const keep = await b.send('put', `tenant/catalog/items/${item.id as string}/option-groups`, {
      groupIds: [g.id],
    });
    expect(keep.status).toBe(200);
    const attach = await b.send('put', `tenant/catalog/items/${other.id as string}/option-groups`, {
      groupIds: [g.id],
    });
    expect([attach.status, code(attach.body)]).toEqual([422, 'OPTION_GROUP_ARCHIVED']);

    const cat = data(await b.post('tenant/catalog/categories', { name: 'Old' }));
    await b.post(`tenant/catalog/categories/${cat.id as string}/archive`);
    const assign = await b.send('patch', `tenant/catalog/items/${other.id as string}`, {
      categoryId: cat.id,
    });
    expect([assign.status, code(assign.body)]).toEqual([422, 'CATEGORY_ARCHIVED']);
  });

  it('searches, filters and pages items; read-only roles cannot write', async () => {
    const { b, reader } = await setup();
    for (const name of ['Barong Tagalog', 'Filipiniana', 'Barong Jusi']) {
      await b.post('tenant/catalog/items', { kind: 'PRODUCT', name, pricingMode: 'QUOTE' });
    }
    await b.post('tenant/catalog/items', {
      kind: 'SERVICE',
      name: 'Hemming',
      pricingMode: 'FIXED',
      basePrice: '250',
    });
    const names = (res: { body: unknown }) =>
      (res.body as { data: Json[] }).data.map((i) => i.name);
    expect(names(await reader.get('tenant/catalog/items?q=barong'))).toEqual([
      'Barong Jusi',
      'Barong Tagalog',
    ]);
    expect(names(await reader.get('tenant/catalog/items?kind=SERVICE'))).toEqual(['Hemming']);
    const page = (await reader.get('tenant/catalog/items?limit=3')).body as {
      data: Json[];
      meta: { hasMore: boolean; nextCursor: string };
    };
    expect(page.meta.hasMore).toBe(true);
    const next = (
      await reader.get(
        `tenant/catalog/items?limit=3&cursor=${encodeURIComponent(page.meta.nextCursor)}`,
      )
    ).body as { data: Json[] };
    expect(next.data.map((i) => i.name)).toEqual(['Barong Tagalog']);

    expect((await reader.post('tenant/catalog/categories', { name: 'X' })).status).toBe(403);
  });
});
