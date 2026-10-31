import { describe, expect, it } from 'vitest';
import { addMonths, fromManilaInput, manilaDay, monthGrid, toManilaInput } from './calendar';

describe('calendar', () => {
  it('reads moments on the Manila clock', () => {
    expect(toManilaInput('2027-01-14T16:30:00.000Z')).toBe('2027-01-15T00:30');
    expect(manilaDay('2027-01-14T15:59:00.000Z')).toBe('2027-01-14');
    expect(manilaDay('2027-01-14T16:00:00.000Z')).toBe('2027-01-15');
  });

  it('round-trips a form value to the same moment', () => {
    expect(new Date(fromManilaInput('2027-01-15T00:30')).toISOString()).toBe(
      '2027-01-14T16:30:00.000Z',
    );
  });

  it('moves across year ends', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('lays out months, including leap February', () => {
    const feb = monthGrid('2028-02');
    expect(feb.days).toHaveLength(29);
    expect(feb.leading).toBe(2); // 1 February 2028 is a Tuesday.
    expect(monthGrid('2027-02').days.at(-1)).toBe('2027-02-28');
  });
});
