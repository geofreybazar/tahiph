import { z } from 'zod';
import { idSchema } from './common.js';
import { isoDateSchema } from './tenant-settings.js';

export const APPOINTMENT_KINDS = [
  'CONSULTATION',
  'MEASUREMENT',
  'DESIGN',
  'FITTING',
  'FINAL_FITTING',
  'PICKUP',
  'OTHER',
] as const;
export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export const APPOINTMENT_SOURCES = ['DASHBOARD', 'STOREFRONT'] as const;

/** Appointments start on a 5-minute grid; slots are offered every 15 minutes. */
export const SLOT_STEP_MINUTES = 15;

const instantSchema = z.iso.datetime({ offset: true });

// ----- Types --------------------------------------------------------------------------

const typeFields = {
  name: z.string().trim().min(2).max(60),
  kind: z.enum(APPOINTMENT_KINDS),
  durationMinutes: z.number().int().min(5).max(720).multipleOf(5),
  bufferMinutes: z.number().int().min(0).max(240).multipleOf(5),
  publicBookable: z.boolean(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB')
    .transform((c) => c.toLowerCase())
    .nullable(),
};

export const createAppointmentTypeRequestSchema = z
  .object(typeFields)
  .partial({ bufferMinutes: true, publicBookable: true, color: true })
  .strict();

export const updateAppointmentTypeRequestSchema = z
  .object(typeFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

export const appointmentTypeSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: z.enum(APPOINTMENT_KINDS),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  publicBookable: z.boolean(),
  color: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export const appointmentTypeParamsSchema = z.object({ id: idSchema });

// ----- Staff availability and time off ------------------------------------------------

export const staffAvailabilityParamsSchema = z.object({ membershipId: idSchema });

export const createTimeOffRequestSchema = z
  .object({
    startsAt: instantSchema,
    endsAt: instantSchema,
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((o) => new Date(o.startsAt) < new Date(o.endsAt), {
    path: ['endsAt'],
    message: 'Must be after startsAt',
  });

export const timeOffSchema = z.object({
  id: idSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().nullable(),
});

export const timeOffParamsSchema = z.object({ membershipId: idSchema, timeOffId: idSchema });

// ----- Appointments -------------------------------------------------------------------

/** Start times must sit on the 5-minute grid (seconds and milliseconds zero). */
const gridInstantSchema = instantSchema.refine((s) => {
  const d = new Date(s);
  return d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && d.getUTCMinutes() % 5 === 0;
}, 'Use a time on a 5-minute boundary');

export const createAppointmentRequestSchema = z
  .object({
    clientId: idSchema,
    typeId: idSchema,
    staffMembershipId: idSchema,
    startsAt: gridInstantSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const rescheduleAppointmentRequestSchema = z
  .object({ startsAt: gridInstantSchema, staffMembershipId: idSchema.optional() })
  .strict();

export const cancelAppointmentRequestSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const appointmentParamsSchema = z.object({ id: idSchema });

export const MAX_CALENDAR_DAYS = 62;

export const appointmentListQuerySchema = z
  .object({
    from: instantSchema,
    to: instantSchema,
    staffMembershipId: idSchema.optional(),
    clientId: idSchema.optional(),
  })
  .strict()
  .refine(
    (q) => {
      const span = new Date(q.to).getTime() - new Date(q.from).getTime();
      return span > 0 && span <= MAX_CALENDAR_DAYS * 86_400_000;
    },
    { path: ['to'], message: `Must be after from, at most ${MAX_CALENDAR_DAYS} days later` },
  );

export const slotQuerySchema = z
  .object({ typeId: idSchema, date: isoDateSchema, staffMembershipId: idSchema.optional() })
  .strict();

export const appointmentSchema = z.object({
  id: idSchema,
  client: z.object({ id: idSchema, name: z.string() }),
  type: z.object({
    id: idSchema,
    name: z.string(),
    kind: z.enum(APPOINTMENT_KINDS),
    color: z.string().nullable(),
  }),
  staff: z.object({ membershipId: idSchema, name: z.string() }),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  blockedUntil: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  source: z.enum(APPOINTMENT_SOURCES),
  notes: z.string().nullable(),
  cancelReason: z.string().nullable(),
});

export const slotsSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  staff: z.array(
    z.object({ membershipId: idSchema, name: z.string(), startsAt: z.array(z.iso.datetime()) }),
  ),
});

export type CreateAppointmentTypeRequest = z.infer<typeof createAppointmentTypeRequestSchema>;
export type UpdateAppointmentTypeRequest = z.infer<typeof updateAppointmentTypeRequestSchema>;
export type CreateTimeOffRequest = z.infer<typeof createTimeOffRequestSchema>;
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentRequestSchema>;
export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentRequestSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type SlotQuery = z.infer<typeof slotQuerySchema>;
