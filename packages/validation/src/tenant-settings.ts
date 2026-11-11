import { z } from 'zod';
import { idSchema } from './common.js';

const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional text: missing, null or blank all mean "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s ? s : null));

// ----- Business profile ---------------------------------------------------------------

/** PUT replaces the whole profile; omitted optional fields are cleared. */
export const businessProfileRequestSchema = z
  .object({
    displayName: text(100),
    legalName: optionalText(200),
    tin: optionalText(20).refine(
      (s) => s === null || /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/.test(s),
      'Use the 9-digit TIN, optionally with a 3–5 digit branch code',
    ),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(100),
    province: optionalText(100),
    postalCode: optionalText(10),
    phone: optionalText(30),
    email: z
      .email()
      .trim()
      .toLowerCase()
      .max(254)
      .nullish()
      .transform((s) => s ?? null),
  })
  .strict();

export const businessProfileSchema = z.object({
  displayName: z.string(),
  legalName: z.string().nullable(),
  tin: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

// ----- Settings -----------------------------------------------------------------------

export const MEASUREMENT_UNITS = ['CM', 'IN'] as const;

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Must be an IANA time zone, e.g. Asia/Manila');

/** A percentage as a decimal string (numeric(5,2)), 0–100. */
export const taxRateSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use a percentage with at most 2 decimal places, e.g. "12.00"')
  .refine((s) => Number(s) <= 100, 'Must be at most 100');

export const updateTenantSettingsRequestSchema = z
  .object({
    timezone: timezoneSchema,
    measurementUnit: z.enum(MEASUREMENT_UNITS),
    vatRegistered: z.boolean(),
    taxRate: taxRateSchema,
    pricesIncludeTax: z.boolean(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one setting');

export const tenantSettingsSchema = z.object({
  timezone: z.string(),
  currency: z.string(),
  measurementUnit: z.enum(MEASUREMENT_UNITS),
  vatRegistered: z.boolean(),
  /** Always two decimals, e.g. "12.00". */
  taxRate: z.string(),
  pricesIncludeTax: z.boolean(),
  updatedAt: z.iso.datetime(),
});

// ----- Operating hours ----------------------------------------------------------------

/** "HH:MM", 00:00–24:00 (24:00 only as a closing time). */
export const clockTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24-hour)');

export const operatingRangeSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    opens: clockTimeSchema,
    closes: clockTimeSchema,
  })
  .strict();

export function clockToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
}

export function minutesToClock(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Indexes of ranges that are empty or overlap an earlier range on the same day (touching is fine). */
export function invalidRanges(ranges: z.infer<typeof operatingRangeSchema>[]): number[] {
  const bad = new Set<number>();
  ranges.forEach((r, i) => {
    if (clockToMinutes(r.opens) >= clockToMinutes(r.closes)) bad.add(i);
    ranges.forEach((o, j) => {
      if (j <= i || o.dayOfWeek !== r.dayOfWeek) return;
      if (
        clockToMinutes(r.opens) < clockToMinutes(o.closes) &&
        clockToMinutes(o.opens) < clockToMinutes(r.closes)
      ) {
        bad.add(j);
      }
    });
  });
  return [...bad].sort((a, b) => a - b);
}

/** PUT replaces the whole week. Days without ranges are closed. */
export const operatingHoursRequestSchema = z
  .object({ ranges: z.array(operatingRangeSchema).max(50) })
  .strict()
  .superRefine((o, ctx) => {
    for (const i of invalidRanges(o.ranges)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranges', i],
        message: 'Opening must be before closing, and ranges on a day must not overlap',
      });
    }
  });

export const operatingHoursSchema = z.object({
  ranges: z.array(z.object({ dayOfWeek: z.number(), opens: z.string(), closes: z.string() })),
});

// ----- Holidays -----------------------------------------------------------------------

export const isoDateSchema = z.iso.date();

export const createHolidayRequestSchema = z
  .object({ date: isoDateSchema, name: text(100) })
  .strict();

export const holidaySchema = z.object({ id: idSchema, date: z.string(), name: z.string() });

export const holidayParamsSchema = z.object({ id: idSchema });

export type BusinessProfileRequest = z.infer<typeof businessProfileRequestSchema>;
export type UpdateTenantSettingsRequest = z.infer<typeof updateTenantSettingsRequestSchema>;
export type OperatingHoursRequest = z.infer<typeof operatingHoursRequestSchema>;
export type CreateHolidayRequest = z.infer<typeof createHolidayRequestSchema>;
