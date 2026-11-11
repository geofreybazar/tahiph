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
import { MeasurementsModule } from '../src/modules/measurements/measurements.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = (res: { body: unknown }) => (res.body as { data: Json }).data;
const list = (res: { body: unknown }) => (res.body as { data: Json[] }).data;

describe('Measurements (integration)', () => {
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
    return { b, membershipId: m.id };
  }

  /** An atelier with an owner, a category with a 2-field template, and a client. */
  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      measurer: ['clients.read', 'measurements.read', 'measurements.write'],
      viewer: ['measurements.read'],
    });
    const owner = await member(t, 'owner');
    const category = data(await owner.b.post('tenant/garment-categories', { name: 'Barong' }));
    const v1 = await owner.b.send(
      'put',
      `tenant/garment-categories/${category.id as string}/template`,
      {
        fields: [
          { key: 'chest', label: 'Chest', section: 'Top', required: true },
          { key: 'waist', label: 'Waist', section: 'Top' },
        ],
      },
    );
    expect(v1.status).toBe(200);
    const client = await asTenant(prisma, t.tenantId, (tx) =>
      tx.client.create({ data: { tenantId: t.tenantId, firstName: 'Ana' } }),
    );
    return { t, owner, categoryId: category.id as string, v1: data(v1), clientId: client.id };
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
        MeasurementsModule,
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

  it('records values against the current template, exactly and in form order', async () => {
    const { owner, categoryId, clientId } = await setup();
    const path = `tenant/clients/${clientId}/measurements`;
    const missing = await owner.b.post(path, { categoryId, values: { waist: '30' } });
    expect([missing.status, code(missing.body)]).toEqual([422, 'VALIDATION_FAILED']);
    const unknown = await owner.b.post(path, { categoryId, values: { chest: '38', hip: '40' } });
    expect(unknown.status).toBe(422);

    const created = await owner.b.post(path, {
      categoryId,
      values: { waist: '30.5', chest: '38.125' },
      measuredFor: 'Wedding, groom',
    });
    expect(created.status).toBe(201);
    expect(data(created)).toMatchObject({
      unit: 'CM',
      measuredFor: 'Wedding, groom',
      templateVersion: 1,
      supersedesId: null,
      supersededById: null,
      values: [
        { key: 'chest', label: 'Chest', section: 'Top', value: '38.125' },
        { key: 'waist', label: 'Waist', section: 'Top', value: '30.5' },
      ],
    });
    const inches = await owner.b.post(path, { categoryId, unit: 'IN', values: { chest: '15' } });
    expect(data(inches).unit).toBe('IN');
    expect(list(await owner.b.get(path))).toHaveLength(2);
  });

  it('versions templates; old records keep the labels they were taken with', async () => {
    const { owner, categoryId, clientId, v1 } = await setup();
    const path = `tenant/clients/${clientId}/measurements`;
    const old = data(await owner.b.post(path, { categoryId, values: { chest: '38' } }));

    const v2 = await owner.b.send('put', `tenant/garment-categories/${categoryId}/template`, {
      fields: [
        { key: 'chest', label: 'Bust', required: true },
        { key: 'hip', label: 'Hip' },
      ],
    });
    expect(data(v2)).toMatchObject({ version: 2 });
    expect(
      data(await owner.b.get(`tenant/garment-categories/${categoryId}/template`)).version,
    ).toBe(2);
    expect(
      list(await owner.b.get('tenant/garment-categories')).find((c) => c.id === categoryId),
    ).toMatchObject({ currentVersion: 2 });

    const reread = data(await owner.b.get(`tenant/measurements/${old.id as string}`));
    expect(reread).toMatchObject({
      templateVersion: 1,
      values: [{ key: 'chest', label: 'Chest' }],
    });
    expect(
      data(await owner.b.get(`tenant/measurement-templates/${v1.id as string}`)),
    ).toMatchObject({
      version: 1,
    });
    const fresh = data(
      await owner.b.post(path, { categoryId, values: { chest: '39', hip: '40' } }),
    );
    expect(fresh).toMatchObject({ templateVersion: 2 });
  });

  it('corrects a record once, within the same client', async () => {
    const { t, owner, categoryId, clientId } = await setup();
    const path = `tenant/clients/${clientId}/measurements`;
    const first = data(await owner.b.post(path, { categoryId, values: { chest: '38' } }));
    const fix = await owner.b.post(path, {
      categoryId,
      values: { chest: '38.5' },
      supersedesId: first.id,
      notes: 'Re-measured',
    });
    expect(data(fix)).toMatchObject({ supersedesId: first.id });
    expect(data(await owner.b.get(`tenant/measurements/${first.id as string}`))).toMatchObject({
      supersededById: data(fix).id,
    });
    const again = await owner.b.post(path, {
      categoryId,
      values: { chest: '39' },
      supersedesId: first.id,
    });
    expect([again.status, code(again.body)]).toEqual([409, 'ALREADY_CORRECTED']);

    const other = await asTenant(prisma, t.tenantId, (tx) =>
      tx.client.create({ data: { tenantId: t.tenantId, firstName: 'Bea' } }),
    );
    const crossClient = await owner.b.post(`tenant/clients/${other.id}/measurements`, {
      categoryId,
      values: { chest: '30' },
      supersedesId: data(fix).id,
    });
    expect(crossClient.status).toBe(404);
  });

  it('the database refuses to change or delete records, values and templates', async () => {
    const { t, owner, categoryId, clientId, v1 } = await setup();
    const rec = data(
      await owner.b.post(`tenant/clients/${clientId}/measurements`, {
        categoryId,
        values: { chest: '38' },
      }),
    );
    const id = rec.id as string;
    type Tx = Parameters<Parameters<typeof asTenant>[2]>[0];
    const attempts: ((tx: Tx) => Promise<unknown>)[] = [
      (tx) => tx.measurementValue.updateMany({ where: { recordId: id }, data: { value: '1' } }),
      (tx) => tx.measurementValue.deleteMany({ where: { recordId: id } }),
      (tx) => tx.measurementRecord.updateMany({ where: { id }, data: { notes: 'edited' } }),
      (tx) => tx.measurementRecord.deleteMany({ where: { id } }),
      (tx) =>
        tx.measurementField.updateMany({
          where: { templateId: v1.id as string },
          data: { label: 'X' },
        }),
    ];
    for (const attempt of attempts) {
      await expect(asTenant(prisma, t.tenantId, attempt)).rejects.toThrow(/append-only/);
    }
    expect(data(await owner.b.get(`tenant/measurements/${id}`))).toMatchObject({
      notes: null,
      values: [{ value: '38' }],
    });
  });

  it('enforces permissions and archived categories', async () => {
    const { t, owner, categoryId, clientId } = await setup();
    const measurer = await member(t, 'measurer');
    const viewer = await member(t, 'viewer');
    const path = `tenant/clients/${clientId}/measurements`;
    expect((await measurer.b.post(path, { categoryId, values: { chest: '38' } })).status).toBe(201);
    expect((await viewer.b.post(path, { categoryId, values: { chest: '38' } })).status).toBe(403);
    expect((await viewer.b.get(path)).status).toBe(200);
    expect(
      (
        await measurer.b.send('put', `tenant/garment-categories/${categoryId}/template`, {
          fields: [{ key: 'chest', label: 'Chest' }],
        })
      ).status,
    ).toBe(403);

    expect((await owner.b.post(`tenant/garment-categories/${categoryId}/archive`)).status).toBe(
      200,
    );
    const archived = await measurer.b.post(path, { categoryId, values: { chest: '38' } });
    expect([archived.status, code(archived.body)]).toEqual([422, 'CATEGORY_ARCHIVED']);
    const empty = data(await owner.b.post('tenant/garment-categories', { name: 'Empty' }));
    expect(
      (await owner.b.get(`tenant/garment-categories/${empty.id as string}/template`)).status,
    ).toBe(404);
    const noTemplate = await owner.b.post(path, { categoryId: empty.id, values: { chest: '1' } });
    expect([noTemplate.status, code(noTemplate.body)]).toEqual([422, 'NO_TEMPLATE']);
  });
});
