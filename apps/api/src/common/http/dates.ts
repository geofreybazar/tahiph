/** Calendar days are `YYYY-MM-DD` in the API, and midnight UTC in Prisma's Date type. */
export const toDbDate = (day: string | null): Date | null => (day ? new Date(`${day}T00:00:00.000Z`) : null);
export const fromDbDate = (date: Date | null): string | null => date?.toISOString().slice(0, 10) ?? null;

/** The current year on the Manila calendar, not the server's. */
export const manilaYear = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }).format(now);
