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
import { AppointmentsModule } from '../src/modules/appointments/appointments.module.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = (res: { body: unknown }) => (res.body as { data: Json }).data;

const MONDAY = '2031-06-02';
/** A Manila wall-clock time on MONDAY as an ISO instant. */
const at = (hhmm: string, date = MONDAY) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();

describe('Appointments (integration)', () => {
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
    await b.get('auth/csrf');
    return { b, membershipId: m.id };
  }

  /** Owner, two staff, a client and a 60-minute fitting type with a 15-minute buffer. */
  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      staff: ['clients.read'],
      reader: ['appointments.read'],
    });
    const owner = await member(t, 'owner');
    const tailor = await member(t, 'staff');
    const designer = await member(t, 'staff');
    const client = await asTenant(prisma, t.tenantId, (tx) =>
      tx.client.create({ data: { tenantId: t.tenantId, firstName: 'Ana', lastName: 'Cruz' } }),
    );
    const type = data(
      await owner.b.post('tenant/appointment-types', {
        name: 'Fitting',
        kind: 'FITTING',
        durationMinutes: 60,
        bufferMinutes: 15,
        color: '#AA3366',
      }),
    );
    const book = (staffMembershipId: string, startsAt: string) =>
      owner.b.post('tenant/appointments', {
        clientId: client.id,
        typeId: type.id,
        staffMembershipId,
        startsAt,
      });
    return { t, owner, tailor, designer, clientId: client.id, typeId: type.id as string, book };
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
        AppointmentsModule,
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

  it('books, and rejects overlaps including the buffer', async () => {
    const { tailor, designer, book } = await setup();
    const first = await book(tailor.membershipId, at('10:00'));
    expect(first.status).toBe(201);
    expect(data(first)).toMatchObject({
      status: 'CONFIRMED',
      source: 'DASHBOARD',
      startsAt: '2031-06-02T02:00:00.000Z',
      endsAt: '2031-06-02T03:00:00.000Z',
      blockedUntil: '2031-06-02T03:15:00.000Z',
      client: { name: 'Ana Cruz' },
      type: { kind: 'FITTING', color: '#aa3366' },
    });
    for (const time of ['10:30', '11:00', '09:15']) {
      const clash = await book(tailor.membershipId, at(time));
      expect([time, clash.status, code(clash.body)]).toEqual([time, 409, 'APPOINTMENT_CONFLICT']);
    }
    expect((await book(tailor.membershipId, at('11:15'))).status).toBe(201);
    expect((await book(designer.membershipId, at('10:00'))).status).toBe(201);
    // Outside opening hours is allowed from the dashboard (ADR-028).
    expect((await book(tailor.membershipId, at('22:00'))).status).toBe(201);
  });

  it('lets exactly one of many concurrent bookings of the same slot succeed', async () => {
    const { tailor, book } = await setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => book(tailor.membershipId, at('14:00'))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);
  });

  it('cancelling frees the slot; closed appointments cannot change', async () => {
    const { tailor, owner, book } = await setup();
    const id = data(await book(tailor.membershipId, at('10:00'))).id as string;
    const cancelled = await owner.b.post(`tenant/appointments/${id}/cancel`, { reason: 'Sick' });
    expect(data(cancelled)).toMatchObject({ status: 'CANCELLED', cancelReason: 'Sick' });
    expect((await book(tailor.membershipId, at('10:00'))).status).toBe(201);
    const again = await owner.b.post(`tenant/appointments/${id}/complete`);
    expect([again.status, code(again.body)]).toEqual([422, 'APPOINTMENT_CLOSED']);
    const moved = await owner.b.post(`tenant/appointments/${id}/reschedule`, {
      startsAt: at('16:00'),
    });
    expect(moved.status).toBe(422);
  });

  it('reschedules in place, keeping length and buffer, and never into a clash', async () => {
    const { t, tailor, designer, owner, book } = await setup();
    const a = data(await book(tailor.membershipId, at('10:00'))).id as string;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.tenantId}, true)`;
      await tx.appointment.update({ where: { id: a }, data: { reminderSentAt: new Date() } });
    });
    await book(tailor.membershipId, at('13:00'));
    const clash = await owner.b.post(`tenant/appointments/${a}/reschedule`, {
      startsAt: at('12:30'),
    });
    expect([clash.status, code(clash.body)]).toEqual([409, 'APPOINTMENT_CONFLICT']);
    const moved = await owner.b.post(`tenant/appointments/${a}/reschedule`, {
      startsAt: at('15:00'),
      staffMembershipId: designer.membershipId,
    });
    expect(data(moved)).toMatchObject({
      startsAt: '2031-06-02T07:00:00.000Z',
      endsAt: '2031-06-02T08:00:00.000Z',
      blockedUntil: '2031-06-02T08:15:00.000Z',
      staff: { membershipId: designer.membershipId },
    });
    // The new time gets its own reminder (ADR-029).
    const after = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.tenantId}, true)`;
      return tx.appointment.findUniqueOrThrow({
        where: { id: a },
        select: { reminderSentAt: true },
      });
    });
    expect(after.reminderSentAt).toBeNull();
    // The old time is free again for the tailor.
    expect((await book(tailor.membershipId, at('10:00'))).status).toBe(201);
  });

  it('offers slots inside opening hours and availability, minus bookings and holidays', async () => {
    const { tailor, owner, typeId, book } = await setup();
    await owner.b.send('put', 'tenant/operating-hours', {
      ranges: [{ dayOfWeek: 1, opens: '09:00', closes: '12:00' }],
    });
    const slots = async () => {
      const res = await owner.b.get(
        `tenant/appointments/slots?typeId=${typeId}&date=${MONDAY}&staffMembershipId=${tailor.membershipId}`,
      );
      const body = res.body as { data: { timezone: string; staff: { startsAt: string[] }[] } };
      expect(body.data.timezone).toBe('Asia/Manila');
      return body.data.staff[0]!.startsAt;
    };
    // 60 min + 15 min buffer; a booking at 11:00 blocks 11:00–12:15.
    await book(tailor.membershipId, at('11:00'));
    expect(await slots()).toEqual([at('09:00'), at('09:15'), at('09:30'), at('09:45')]);

    await owner.b.send('put', `tenant/staff/${tailor.membershipId}/availability`, {
      ranges: [{ dayOfWeek: 1, opens: '09:00', closes: '10:00' }],
    });
    expect(await slots()).toEqual([at('09:00')]);

    await owner.b.post('tenant/holidays', { date: MONDAY, name: 'Closed' });
    expect(await slots()).toEqual([]);
  });

  it('lists the calendar and enforces permissions', async () => {
    const { t, tailor, clientId, book } = await setup();
    await book(tailor.membershipId, at('10:00'));
    await book(tailor.membershipId, at('10:00', '2031-06-03'));
    const reader = await member(t, 'reader');
    const res = await reader.b.get(
      `tenant/appointments?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&clientId=${clientId}`,
    );
    expect((res.body as { data: Json[] }).data).toHaveLength(1);
    expect(
      (
        await reader.b.post('tenant/appointments', {
          clientId,
          typeId: '0190c0de-0000-7000-8000-000000000001',
          staffMembershipId: tailor.membershipId,
          startsAt: at('12:00'),
        })
      ).status,
    ).toBe(403);
  });
});
