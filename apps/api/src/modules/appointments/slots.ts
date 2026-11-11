import { SLOT_STEP_MINUTES } from '@tahi/validation';

export interface Interval {
  start: Date;
  end: Date;
}

export interface MinuteRange {
  opensMinute: number;
  closesMinute: number;
}

/** Offset of `tz` from UTC at `instant`, in ms (local wall time = UTC + offset). */
export function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The instant of local `minutes` after midnight on `date` (YYYY-MM-DD) in `tz`. */
export function localToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y!, m! - 1, d, 0, minutes);
  // Second pass corrects the offset when the first guess lands across a DST change.
  const first = wall - tzOffsetMs(new Date(wall), tz);
  return new Date(wall - tzOffsetMs(new Date(first), tz));
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function intersect(a: MinuteRange[], b: MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const x of a) {
    for (const y of b) {
      const opensMinute = Math.max(x.opensMinute, y.opensMinute);
      const closesMinute = Math.min(x.closesMinute, y.closesMinute);
      if (opensMinute < closesMinute) out.push({ opensMinute, closesMinute });
    }
  }
  return out;
}

export interface SlotInput {
  date: string;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  now: Date;
  isHoliday: boolean;
  /** The atelier's opening ranges for that weekday. */
  opening: MinuteRange[];
  staff: {
    membershipId: string;
    /** That weekday's working ranges, or null when the member follows opening hours. */
    availability: MinuteRange[] | null;
    /** Active appointments [startsAt, blockedUntil) and time off. */
    busy: Interval[];
  }[];
}

/**
 * Free start times per staff member: inside opening hours and the member's availability,
 * in the future, and not overlapping anything busy (including the buffer). For UX only; the
 * exclusion constraint is the source of truth (DATABASE_DESIGN.md §3.1).
 */
export function computeSlots(input: SlotInput): { membershipId: string; startsAt: Date[] }[] {
  const lengthMs = (input.durationMinutes + input.bufferMinutes) * 60_000;
  return input.staff.map((s) => {
    if (input.isHoliday) return { membershipId: s.membershipId, startsAt: [] };
    const windows = intersect(input.opening, s.availability ?? input.opening);
    const startsAt: Date[] = [];
    for (const w of windows) {
      const first = Math.ceil(w.opensMinute / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
      for (let m = first; m + input.durationMinutes <= w.closesMinute; m += SLOT_STEP_MINUTES) {
        const start = localToUtc(input.date, m, input.timezone);
        const slot = { start, end: new Date(start.getTime() + lengthMs) };
        if (start > input.now && !s.busy.some((b) => overlaps(slot, b))) startsAt.push(start);
      }
    }
    return { membershipId: s.membershipId, startsAt };
  });
}
