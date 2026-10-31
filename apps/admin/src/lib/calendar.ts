const MANILA_INPUT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Manila',
  dateStyle: 'short',
  timeStyle: 'short',
});

/** A moment as a `datetime-local` value on the Manila clock, whatever the device's zone. */
export const toManilaInput = (date: Date | string): string =>
  MANILA_INPUT.format(new Date(date)).replace(' ', 'T');

export const fromManilaInput = (value: string): string => `${value}:00+08:00`;

export const manilaDay = (date: Date | string): string => toManilaInput(date).slice(0, 10);

/** `YYYY-MM` moved by some months. Uses UTC only as a plain calendar, so zones can't shift it. */
export function addMonths(month: string, count: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + count, 1)).toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** The month's days as `YYYY-MM-DD`, with how many blank cells come first in a Sunday-first week. */
export function monthGrid(month: string): { leading: number; days: string[] } {
  const [year = 0, index = 1] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return {
    leading: new Date(Date.UTC(year, index - 1, 1)).getUTCDay(),
    days: Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  };
}
