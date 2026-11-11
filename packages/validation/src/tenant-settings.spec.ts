import { describe, expect, it } from 'vitest';
import {
  businessProfileRequestSchema,
  invalidRanges,
  minutesToClock,
  clockToMinutes,
  operatingHoursRequestSchema,
  taxRateSchema,
  timezoneSchema,
  updateTenantSettingsRequestSchema,
} from './tenant-settings.js';
import { updateStaffMemberRequestSchema } from './staff.js';

describe('businessProfileRequestSchema', () => {
  it('clears omitted and blank optional fields', () => {
    const p = businessProfileRequestSchema.parse({ displayName: ' Maria ', city: '  ' });
    expect(p).toMatchObject({ displayName: 'Maria', city: null, tin: null, email: null });
  });

  it.each(['123-456-789', '123456789000', '123-456-789-00000'])('accepts TIN %s', (tin) => {
    expect(businessProfileRequestSchema.safeParse({ displayName: 'M', tin }).success).toBe(true);
  });

  it.each(['12345', 'abc-def-ghi', '123-456-789-1'])('rejects TIN %s', (tin) => {
    expect(businessProfileRequestSchema.safeParse({ displayName: 'M', tin }).success).toBe(false);
  });

  it('rejects unknown fields such as tenantId', () => {
    expect(
      businessProfileRequestSchema.safeParse({
        displayName: 'M',
        tenantId: '0190c0de-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});

describe('settings', () => {
  it('validates IANA time zones', () => {
    expect(timezoneSchema.safeParse('Asia/Manila').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });

  it.each(['0', '12', '12.00', '100', '7.5'])('accepts tax rate %s', (v) => {
    expect(taxRateSchema.safeParse(v).success).toBe(true);
  });

  it.each(['100.01', '-1', '12.345', '1e1', ''])('rejects tax rate %j', (v) => {
    expect(taxRateSchema.safeParse(v).success).toBe(false);
  });

  it('rejects numbers for the tax rate and empty patches', () => {
    expect(updateTenantSettingsRequestSchema.safeParse({ taxRate: 12 }).success).toBe(false);
    expect(updateTenantSettingsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('does not let clients change the currency', () => {
    expect(updateTenantSettingsRequestSchema.safeParse({ currency: 'USD' }).success).toBe(false);
  });
});

describe('operating hours', () => {
  it('converts clock times', () => {
    expect(clockToMinutes('09:30')).toBe(570);
    expect(minutesToClock(570)).toBe('09:30');
    expect(minutesToClock(1440)).toBe('24:00');
  });

  it('allows split and touching ranges, and the same times on different days', () => {
    expect(
      invalidRanges([
        { dayOfWeek: 1, opens: '09:00', closes: '12:00' },
        { dayOfWeek: 1, opens: '12:00', closes: '18:00' },
        { dayOfWeek: 2, opens: '09:00', closes: '18:00' },
      ]),
    ).toEqual([]);
  });

  it('flags overlapping and empty ranges', () => {
    expect(
      invalidRanges([
        { dayOfWeek: 1, opens: '09:00', closes: '12:00' },
        { dayOfWeek: 1, opens: '11:00', closes: '13:00' },
        { dayOfWeek: 3, opens: '10:00', closes: '10:00' },
      ]),
    ).toEqual([1, 2]);
  });

  it('reports the bad range in the request', () => {
    const r = operatingHoursRequestSchema.safeParse({
      ranges: [{ dayOfWeek: 0, opens: '18:00', closes: '09:00' }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['ranges', 0]);
  });

  it.each(['24:30', '9:00', '25:00'])('rejects clock time %s', (t) => {
    expect(
      operatingHoursRequestSchema.safeParse({
        ranges: [{ dayOfWeek: 0, opens: t, closes: '24:00' }],
      }).success,
    ).toBe(false);
  });
});

describe('updateStaffMemberRequestSchema', () => {
  it('requires a change and only allows ACTIVE or DISABLED', () => {
    expect(updateStaffMemberRequestSchema.safeParse({}).success).toBe(false);
    expect(updateStaffMemberRequestSchema.safeParse({ status: 'INVITED' }).success).toBe(false);
    expect(updateStaffMemberRequestSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
  });
});
