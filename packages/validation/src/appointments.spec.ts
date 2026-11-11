import { describe, expect, it } from 'vitest';
import {
  appointmentListQuerySchema,
  createAppointmentRequestSchema,
  createAppointmentTypeRequestSchema,
  createTimeOffRequestSchema,
} from './appointments.js';

const id = '0190c0de-0000-7000-8000-000000000001';

describe('appointment requests', () => {
  it('requires start times on the 5-minute grid', () => {
    const base = { clientId: id, typeId: id, staffMembershipId: id };
    expect(
      createAppointmentRequestSchema.safeParse({ ...base, startsAt: '2030-01-07T10:15:00+08:00' })
        .success,
    ).toBe(true);
    for (const startsAt of ['2030-01-07T10:13:00+08:00', '2030-01-07T10:15:30+08:00']) {
      expect(createAppointmentRequestSchema.safeParse({ ...base, startsAt }).success).toBe(false);
    }
  });

  it('bounds the calendar range', () => {
    expect(
      appointmentListQuerySchema.safeParse({
        from: '2030-01-01T00:00:00Z',
        to: '2030-03-01T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      appointmentListQuerySchema.safeParse({
        from: '2030-01-01T00:00:00Z',
        to: '2030-04-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      appointmentListQuerySchema.safeParse({
        from: '2030-01-02T00:00:00Z',
        to: '2030-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('validates types and time off', () => {
    expect(
      createAppointmentTypeRequestSchema.parse({
        name: 'Fitting',
        kind: 'FITTING',
        durationMinutes: 45,
        color: '#AABBCC',
      }),
    ).toMatchObject({ color: '#aabbcc' });
    expect(
      createAppointmentTypeRequestSchema.safeParse({
        name: 'X1',
        kind: 'FITTING',
        durationMinutes: 7,
      }).success,
    ).toBe(false);
    expect(
      createTimeOffRequestSchema.safeParse({
        startsAt: '2030-01-02T00:00:00Z',
        endsAt: '2030-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
