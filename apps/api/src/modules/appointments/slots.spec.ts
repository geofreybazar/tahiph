import { describe, expect, it } from 'vitest';
import { computeSlots, dayOfWeek, localToUtc, type SlotInput } from './slots.js';

const MANILA = 'Asia/Manila';
const date = '2030-01-07'; // a Monday
const at = (hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`);
const times = (r: ReturnType<typeof computeSlots>) =>
  r[0]!.startsAt.map((d) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: MANILA, timeStyle: 'short' }).format(d),
  );

const base: SlotInput = {
  date,
  timezone: MANILA,
  durationMinutes: 60,
  bufferMinutes: 0,
  now: new Date('2029-01-01T00:00:00Z'),
  isHoliday: false,
  opening: [{ opensMinute: 9 * 60, closesMinute: 12 * 60 }],
  staff: [{ membershipId: 'm1', availability: null, busy: [] }],
};

describe('time zone helpers', () => {
  it('converts local wall time to UTC', () => {
    expect(localToUtc(date, 9 * 60, MANILA).toISOString()).toBe('2030-01-07T01:00:00.000Z');
    expect(localToUtc(date, 1440, MANILA).toISOString()).toBe('2030-01-07T16:00:00.000Z');
    expect(dayOfWeek(date)).toBe(1);
  });

  it('handles daylight saving changes', () => {
    // US DST starts 2030-03-10 at 02:00; 09:00 is then UTC-4.
    expect(localToUtc('2030-03-10', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2030-03-10T13:00:00.000Z',
    );
    expect(localToUtc('2030-03-09', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2030-03-09T14:00:00.000Z',
    );
  });
});

describe('computeSlots', () => {
  it('offers every 15 minutes while the appointment fits before closing', () => {
    expect(times(computeSlots(base))).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
  });

  it('skips times overlapping busy ranges, counting the buffer', () => {
    const busy = [{ start: at('10:00'), end: at('11:00') }];
    expect(times(computeSlots({ ...base, staff: [{ ...base.staff[0]!, busy }] }))).toEqual([
      '09:00',
      '11:00',
    ]);
    expect(
      times(computeSlots({ ...base, bufferMinutes: 15, staff: [{ ...base.staff[0]!, busy }] })),
    ).toEqual(['11:00']);
  });

  it('intersects staff availability with opening hours and drops past times', () => {
    const staff = [
      { membershipId: 'm1', availability: [{ opensMinute: 600, closesMinute: 1200 }], busy: [] },
    ];
    expect(times(computeSlots({ ...base, staff }))).toEqual([
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
    expect(times(computeSlots({ ...base, now: at('10:30') }))).toEqual(['10:45', '11:00']);
  });

  it('offers nothing on holidays or when closed', () => {
    expect(times(computeSlots({ ...base, isHoliday: true }))).toEqual([]);
    expect(times(computeSlots({ ...base, opening: [] }))).toEqual([]);
  });
});
