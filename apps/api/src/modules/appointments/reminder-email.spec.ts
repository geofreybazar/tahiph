import { describe, expect, it } from 'vitest';
import { appointmentReminder, reminderWindow } from './reminder-email.js';

describe('reminderWindow', () => {
  it('covers appointments more than 1 hour and at most 24 hours away', () => {
    const now = new Date('2031-06-01T00:00:00Z');
    expect(reminderWindow(now)).toEqual({
      after: new Date('2031-06-01T01:00:00Z'),
      until: new Date('2031-06-02T00:00:00Z'),
    });
  });
});

describe('appointmentReminder', () => {
  it('shows the time in the atelier timezone and escapes HTML', () => {
    const email = appointmentReminder({
      to: 'ana@example.test',
      clientName: 'Ana <b>',
      atelierName: 'Maria Couture',
      typeName: 'Fitting',
      staffName: 'Lea',
      startsAt: new Date('2031-06-02T02:00:00Z'),
      timezone: 'Asia/Manila',
      address: 'Makati',
      phone: null,
    });
    expect(email.subject).toBe('Reminder: Fitting at Maria Couture');
    expect(email.text).toContain('10:00');
    expect(email.text).toContain('Address: Makati');
    expect(email.html).toContain('Ana &#60;b&#62;');
    expect(email.html).not.toContain('<b>');
  });
});
