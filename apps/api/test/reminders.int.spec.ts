import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { MAILER, type EmailMessage } from '../src/core/email/email.types.js';
import { TenantJobRunner } from '../src/core/tenancy/tenant-job-runner.js';
import { RemindersWorkerModule } from '../src/modules/appointments/reminders.module.js';
import { RemindersService } from '../src/modules/appointments/reminders.service.js';
import {
  addMember,
  asTenant,
  createTenant,
  createUser,
  suffix,
  type TenantFixture,
} from './fixtures.js';

/**
 * A fixed "now" far in the future, so the real worker's sweeps (worker.int.spec.ts runs one)
 * never consider these appointments due.
 */
const NOW = new Date('2035-03-01T00:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

describe('Appointment reminders (integration)', () => {
  let ref: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: DatabaseClient;
  let runner: TenantJobRunner;
  let reminders: RemindersService;
  const outbox: EmailMessage[] = [];

  /** A tenant with one staff member and a booking factory. */
  async function atelier(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const t = await createTenant(prisma, { staff: ['clients.read'] }, { status });
    const staff = await addMember(prisma, t, (await createUser(prisma)).id, 'staff');
    const ids = await asTenant(prisma, t.tenantId, async (tx) => {
      const type = await tx.appointmentType.create({
        data: { tenantId: t.tenantId, name: 'Fitting', kind: 'FITTING', durationMinutes: 30 },
      });
      await tx.businessProfile.update({
        where: { tenantId: t.tenantId },
        data: { displayName: 'Maria Couture', city: 'Makati', phone: '0917 000 0000' },
      });
      return { typeId: type.id };
    });
    const book = (
      startsAt: Date,
      opts: { email?: string | null; status?: 'CONFIRMED' | 'CANCELLED' } = {},
    ) =>
      asTenant(prisma, t.tenantId, async (tx) => {
        const client = await tx.client.create({
          data: {
            tenantId: t.tenantId,
            firstName: 'Ana',
            email: opts.email === undefined ? `ana-${suffix()}@example.test` : opts.email,
          },
        });
        const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
        const a = await tx.appointment.create({
          data: {
            tenantId: t.tenantId,
            clientId: client.id,
            typeId: ids.typeId,
            staffMembershipId: staff.id,
            startsAt,
            endsAt,
            blockedUntil: endsAt,
            status: opts.status ?? 'CONFIRMED',
          },
        });
        return { id: a.id, email: client.email };
      });
    return { t, book };
  }

  const send = (t: TenantFixture) => runner.run(t.tenantId, () => reminders.sendDue(NOW));
  const sentTo = (email: string | null) => outbox.filter((m) => m.to === email);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    ref = await Test.createTestingModule({
      imports: [CoreModule, AuditModule, RemindersWorkerModule],
    })
      .overrideProvider(MAILER)
      .useValue({
        send: (m: EmailMessage) => {
          outbox.push(m);
          return Promise.resolve();
        },
      })
      .compile();
    prisma = ref.get(UNSCOPED_PRISMA);
    runner = ref.get(TenantJobRunner);
    reminders = ref.get(RemindersService);
  });

  afterAll(async () => {
    await ref?.close();
  });

  it('reminds once for active appointments 1–24 hours away with a client email', async () => {
    const { t, book } = await atelier();
    const due = await book(hours(3));
    const tooSoon = await book(hours(0.5));
    const tooFar = await book(hours(30));
    const cancelled = await book(hours(5), { status: 'CANCELLED' });
    await book(hours(6), { email: null });

    expect(await send(t)).toBe(1);
    expect(sentTo(due.email)).toHaveLength(1);
    expect(sentTo(due.email)[0]).toMatchObject({ subject: 'Reminder: Fitting at Maria Couture' });
    expect(sentTo(due.email)[0]!.text).toContain('Makati');
    for (const skipped of [tooSoon, tooFar, cancelled]) expect(sentTo(skipped.email)).toEqual([]);

    // Idempotent: a second run sends nothing more.
    expect(await send(t)).toBe(0);
    expect(sentTo(due.email)).toHaveLength(1);
  });

  it('stays inside the tenant it runs for', async () => {
    const a = await atelier();
    const b = await atelier();
    const mineA = await a.book(hours(2));
    const mineB = await b.book(hours(2));
    expect(await send(a.t)).toBe(1);
    expect(sentTo(mineA.email)).toHaveLength(1);
    expect(sentTo(mineB.email)).toEqual([]);
  });

  it('respects the setting and skips non-operational tenants', async () => {
    const off = await atelier();
    const muted = await off.book(hours(2));
    await asTenant(prisma, off.t.tenantId, (tx) =>
      tx.tenantSettings.update({
        where: { tenantId: off.t.tenantId },
        data: { appointmentReminders: false },
      }),
    );
    expect(await send(off.t)).toBe(0);
    expect(sentTo(muted.email)).toEqual([]);

    const suspended = await atelier('SUSPENDED');
    const quiet = await suspended.book(hours(2));
    expect(await send(suspended.t)).toBeUndefined();
    expect(sentTo(quiet.email)).toEqual([]);
  });

  it('lists only operational tenants for the sweep', async () => {
    const active = await atelier();
    const suspended = await atelier('SUSPENDED');
    const ids = await runner.operationalTenantIds();
    expect(ids).toContain(active.t.tenantId);
    expect(ids).not.toContain(suspended.t.tenantId);
  });
});
