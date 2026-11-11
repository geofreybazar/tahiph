import type { EmailMessage } from '../../core/email/email.types.js';
import { layout, text } from '../../core/email/layout.js';

/** Reminders go out for appointments starting in (1 h, 24 h] from now (ADR-029). */
export const REMINDER_MIN_LEAD_MS = 3600_000;
export const REMINDER_MAX_LEAD_MS = 24 * 3600_000;

export function reminderWindow(now: Date): { after: Date; until: Date } {
  return {
    after: new Date(now.getTime() + REMINDER_MIN_LEAD_MS),
    until: new Date(now.getTime() + REMINDER_MAX_LEAD_MS),
  };
}

export interface ReminderDetails {
  to: string;
  clientName: string;
  atelierName: string;
  typeName: string;
  staffName: string;
  startsAt: Date;
  timezone: string;
  address: string | null;
  phone: string | null;
}

export function appointmentReminder(d: ReminderDetails): EmailMessage {
  const when = new Intl.DateTimeFormat('en-PH', {
    timeZone: d.timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(d.startsAt);
  const p = [
    `Hi ${d.clientName},`,
    `This is a reminder of your ${d.typeName} appointment at ${d.atelierName} on ${when}, with ${d.staffName}.`,
    ...(d.address ? [`Address: ${d.address}`] : []),
    ...(d.phone ? [`Need to change it? Call or message us at ${d.phone}.`] : []),
  ];
  return {
    to: d.to,
    subject: `Reminder: ${d.typeName} at ${d.atelierName}`,
    text: text(p),
    html: layout(`See you soon at ${d.atelierName}`, p),
  };
}
