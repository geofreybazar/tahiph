import { Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { MAILER, type Mailer } from '../../core/email/email.types.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { appointmentReminder, reminderWindow } from './reminder-email.js';

/** Sends due appointment reminders for the current tenant (ADR-029). Runs in the worker. */
@Injectable()
export class RemindersService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly settings: TenantSettingsService,
  ) {}

  /** Returns how many reminders were queued. Safe to run concurrently and repeatedly. */
  async sendDue(now = new Date()): Promise<number> {
    const settings = await this.settings.settings();
    if (!settings.appointmentReminders) return 0;
    const profile = await this.settings.profile();
    const { after, until } = reminderWindow(now);
    const db = this.tenantDb.db();
    const due = await db.appointment.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        reminderSentAt: null,
        startsAt: { gt: after, lte: until },
        client: { email: { not: null } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
      select: {
        id: true,
        startsAt: true,
        client: { select: { firstName: true, email: true } },
        type: { select: { name: true } },
        staff: { select: { user: { select: { name: true } } } },
      },
    });
    const address = [profile.addressLine1, profile.addressLine2, profile.city, profile.province]
      .filter(Boolean)
      .join(', ');

    let sent = 0;
    for (const a of due) {
      // Claim first: a concurrent sweep that loses the claim skips this appointment.
      const { count } = await db.appointment.updateMany({
        where: { id: a.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (count === 0) continue;
      try {
        await this.mailer.send(
          appointmentReminder({
            to: a.client.email!,
            clientName: a.client.firstName,
            atelierName: profile.displayName,
            typeName: a.type.name,
            staffName: a.staff.user.name,
            startsAt: a.startsAt,
            timezone: settings.timezone,
            address: address || null,
            phone: profile.phone,
          }),
        );
        sent++;
      } catch (err) {
        // Release the claim so the next sweep retries this appointment.
        await db.appointment.updateMany({ where: { id: a.id }, data: { reminderSentAt: null } });
        throw err;
      }
    }
    return sent;
  }
}
