/** Calendar days are `YYYY-MM-DD` in the API, and midnight UTC in Prisma's Date type. */
export const toDbDate = (day: string | null): Date | null =>
  day ? new Date(`${day}T00:00:00.000Z`) : null;
export const fromDbDate = (date: Date | null): string | null =>
  date?.toISOString().slice(0, 10) ?? null;

/** The current year on the Manila calendar, not the server's. */
export const manilaYear = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }).format(now);

const MANILA_MONTH = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
});

/** The `YYYY-MM` a moment falls in on the Manila calendar. */
export const manilaMonth = (date: Date): string => MANILA_MONTH.format(date).slice(0, 7);

/** `YYYY-MM` moved by some months. UTC is only a plain calendar here. */
export function addMonths(month: string, count: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + count, 1)).toISOString().slice(0, 7);
}

/** Every `YYYY-MM` from one to the other, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** The moments a Manila month starts at and runs up to, exclusive. */
export const manilaMonthRange = (from: string, to: string) => ({
  gte: new Date(`${from}-01T00:00:00.000+08:00`),
  lt: new Date(`${addMonths(to, 1)}-01T00:00:00.000+08:00`),
});
