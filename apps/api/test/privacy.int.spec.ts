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
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { MeasurementsModule } from '../src/modules/measurements/measurements.module.js';
import { PrivacyModule } from '../src/modules/privacy/privacy.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = <T = Json>(res: { body: unknown }) => (res.body as { data: T }).data;
const ERASE = { reason: 'DATA_SUBJECT_REQUEST' };

/** Data-subject export and erasure (RA 10173, ADR-032). */
describe('Client privacy (integration)', () => {
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

  /** An atelier and a client with two measurement revisions, a note, a call and appointments. */
  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      manager: TENANT_PERMISSIONS.filter((p) => p !== 'clients.privacy'),
    });
    const owner = await member(t, 'owner');
    const manager = await member(t, 'manager');
    const category = data(await owner.b.post('tenant/garment-categories', { name: 'Barong' }));
    await owner.b.send('put', `tenant/garment-categories/${category.id as string}/template`, {
      fields: [{ key: 'chest', label: 'Chest', required: true }],
    });
    const newClient = async (firstName: string) => {
      const c = data(
        await owner.b.post('tenant/clients', {
          firstName,
          lastName: 'Reyes',
          email: `${firstName.toLowerCase()}@example.test`,
          phone: '0917 555 0000',
          city: 'Makati',
          tags: ['vip'],
        }),
      );
      const id = c.id as string;
      const path = `tenant/clients/${id}/measurements`;
      const v1 = data(
        await owner.b.post(path, { categoryId: category.id, values: { chest: '38' } }),
      );
      await owner.b.post(path, {
        categoryId: category.id,
        values: { chest: '38.5' },
        supersedesId: v1.id,
      });
      await owner.b.post(`tenant/clients/${id}/notes`, { body: 'Allergic to wool' });
      await owner.b.post(`tenant/clients/${id}/communications`, {
        channel: 'CALL',
        direction: 'INBOUND',
        summary: 'Asked about her wedding gown',
      });
      return id;
    };
    const clientId = await newClient('Ana');
    const otherId = await newClient('Bea');
    const book = (startsAt: Date, status: 'CONFIRMED' | 'COMPLETED') =>
      asTenant(prisma, t.tenantId, async (tx) => {
        const type = await tx.appointmentType.create({
          data: { tenantId: t.tenantId, name: 'Fitting', kind: 'FITTING', durationMinutes: 30 },
        });
        const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
        const a = await tx.appointment.create({
          data: {
            tenantId: t.tenantId,
            clientId,
            typeId: type.id,
            staffMembershipId: owner.membershipId,
            startsAt,
            endsAt,
            blockedUntil: endsAt,
            status,
            notes: 'Bring the lace sample',
          },
        });
        return a.id;
      });
    const pastId = await book(new Date('2025-02-01T02:00:00Z'), 'COMPLETED');
    return { t, owner, manager, clientId, otherId, book, pastId };
  }

  const measurementCount = (t: TenantFixture, clientId: string) =>
    asTenant(prisma, t.tenantId, (tx) => tx.measurementRecord.count({ where: { clientId } }));
  const audits = (t: TenantFixture, action: string) =>
    asTenant(prisma, t.tenantId, (tx) =>
      tx.tenantAuditLog.findMany({ where: { action }, select: { targetId: true, metadata: true } }),
    );

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

  it('exports everything held about a client, to holders of clients.privacy only', async () => {
    const { t, owner, manager, clientId } = await setup();
    const res = await owner.b.get(`tenant/clients/${clientId}/export`);
    expect(res.status).toBe(200);
    const exp = data(res);
    expect(exp.client).toMatchObject({ id: clientId, firstName: 'Ana', email: 'ana@example.test' });
    expect(exp.measurements).toHaveLength(2);
    expect((exp.notes as Json[])[0]).toMatchObject({ body: 'Allergic to wool' });
    expect((exp.communications as Json[])[0]).toMatchObject({ channel: 'CALL' });
    expect((exp.appointments as Json[])[0]).toMatchObject({ notes: 'Bring the lace sample' });
    expect(await audits(t, 'client.exported')).toEqual([{ targetId: clientId, metadata: null }]);

    expect((await manager.b.get(`tenant/clients/${clientId}/export`)).status).toBe(403);
    expect((await manager.b.post(`tenant/clients/${clientId}/erase`, ERASE)).status).toBe(403);
  });

  it('erases a client: PII cleared, notes and measurements gone, history kept', async () => {
    const { t, owner, clientId, otherId, pastId } = await setup();
    const res = await owner.b.post(`tenant/clients/${clientId}/erase`, ERASE);
    expect(res.status).toBe(204);

    const row = await asTenant(prisma, t.tenantId, (tx) =>
      tx.client.findFirst({ where: { id: clientId } }),
    );
    expect(row).toMatchObject({
      firstName: 'Erased client',
      lastName: null,
      email: null,
      phone: null,
      city: null,
      tags: [],
    });
    expect(row!.erasedAt).toBeInstanceOf(Date);
    expect(row!.archivedAt).toBeInstanceOf(Date);
    expect(await measurementCount(t, clientId)).toBe(0);
    const left = await asTenant(prisma, t.tenantId, async (tx) => ({
      notes: await tx.clientNote.count({ where: { clientId } }),
      calls: await tx.communication.count({ where: { clientId } }),
      appointment: await tx.appointment.findFirst({ where: { id: pastId } }),
    }));
    expect(left).toMatchObject({ notes: 0, calls: 0, appointment: { notes: null } });
    expect(await audits(t, 'client.erased')).toEqual([
      { targetId: clientId, metadata: { reason: 'DATA_SUBJECT_REQUEST' } },
    ]);

    // The erased client is gone from the API; nothing new can be attached to it.
    expect((await owner.b.get(`tenant/clients/${clientId}`)).status).toBe(404);
    const list = data<Json[]>(await owner.b.get('tenant/clients?status=all'));
    expect(list.map((c) => c.id)).not.toContain(clientId);
    expect((await owner.b.get(`tenant/clients/${clientId}/export`)).status).toBe(404);
    expect((await owner.b.post(`tenant/clients/${clientId}/erase`, ERASE)).status).toBe(404);
    expect((await owner.b.get(`tenant/clients/${clientId}/measurements`)).status).toBe(404);

    // Another client of the same atelier is untouched.
    expect(await measurementCount(t, otherId)).toBe(2);
    expect(data(await owner.b.get(`tenant/clients/${otherId}`)).email).toBe('bea@example.test');
  });

  it('refuses while the client has upcoming appointments, and changes nothing', async () => {
    const { t, owner, clientId, book } = await setup();
    await book(new Date(Date.now() + 7 * 24 * 3600_000), 'CONFIRMED');
    const res = await owner.b.post(`tenant/clients/${clientId}/erase`, ERASE);
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('CLIENT_HAS_UPCOMING_APPOINTMENTS');
    expect(await measurementCount(t, clientId)).toBe(2);
    expect(data(await owner.b.get(`tenant/clients/${clientId}`)).firstName).toBe('Ana');
    expect(await audits(t, 'client.erased')).toEqual([]);
  });

  it('keeps measurements immutable for the app role outside erasure', async () => {
    const { t, clientId } = await setup();
    const del = asTenant(prisma, t.tenantId, (tx) =>
      tx.measurementRecord.deleteMany({ where: { clientId } }),
    );
    await expect(del).rejects.toThrow(/append-only/);
    // Setting the erasure marker by hand doesn't help: only the function's owner may delete.
    const forged = asTenant(prisma, t.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.erasing_client', ${clientId}, true)`;
      return tx.measurementRecord.deleteMany({ where: { clientId } });
    });
    await expect(forged).rejects.toThrow(/append-only/);
    const update = asTenant(prisma, t.tenantId, (tx) =>
      tx.measurementRecord.updateMany({ where: { clientId }, data: { notes: 'changed' } }),
    );
    await expect(update).rejects.toThrow(/append-only/);
    // Without a tenant context the function refuses.
    await expect(
      prisma.$queryRaw`SELECT erase_client_measurements(${clientId}::uuid)`,
    ).rejects.toThrow(/tenant context/);
    expect(await measurementCount(t, clientId)).toBe(2);
  });
});
