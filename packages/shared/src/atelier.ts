import { z } from 'zod';
import { paginationQuerySchema } from './api.js';
import { GARMENT_STAGES, garmentStageSchema } from './enums.js';

const text = (max: number) => z.string().trim().min(1).max(max);
/** Forms send an empty field as ""; stored and returned as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalEmail = z
  .union([z.literal(''), z.email()])
  .nullish()
  .transform((value) => value?.toLowerCase() || null);
const optionalDate = z
  .union([z.literal(''), z.iso.date()])
  .nullish()
  .transform((value) => value || null);
const search = z.string().trim().max(120).optional();

// ---------- Clients ----------

export const clientInputSchema = z.object({
  fullName: text(160),
  email: optionalEmail,
  phone: optionalText(40),
  notes: optionalText(5000),
});
export const listClientsSchema = paginationQuerySchema.extend({
  q: search,
  sort: z.enum(['fullName', '-fullName', 'createdAt', '-createdAt']).default('fullName'),
});

// ---------- Wedding projects ----------

export const PROJECT_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

const priceCentavos = z.number().int().min(0).max(2_147_483_647);

export const createProjectSchema = z.object({
  clientId: z.uuid(),
  title: text(160),
  weddingDate: optionalDate,
  priceCentavos,
  notes: optionalText(5000),
});
export const updateProjectSchema = z.object({
  title: text(160),
  weddingDate: optionalDate,
  notes: optionalText(5000),
});
export const updateProjectPriceSchema = z.object({ priceCentavos });
export const updateProjectStatusSchema = z.object({ status: projectStatusSchema });
export const listProjectsSchema = paginationQuerySchema.extend({
  q: search,
  status: projectStatusSchema.optional(),
  clientId: z.uuid().optional(),
  sort: z.enum(['createdAt', '-createdAt', 'weddingDate', '-weddingDate']).default('-createdAt'),
});

// ---------- Garments ----------

export const WEARER_ROLES = ['bride', 'groom', 'entourage', 'other'] as const;
export const wearerRoleSchema = z.enum(WEARER_ROLES);

export const garmentInputSchema = z.object({
  name: text(160),
  wearerName: text(160),
  wearerRole: wearerRoleSchema,
  description: optionalText(5000),
  dueDate: optionalDate,
  /** Left out: unchanged. Null: unassigned. */
  measurementRecordId: z.uuid().nullish(),
});
export const moveGarmentStageSchema = z.object({
  stage: garmentStageSchema,
  note: optionalText(1000),
});
export const listGarmentsSchema = paginationQuerySchema.extend({
  stage: garmentStageSchema.optional(),
});

export const GARMENT_MEDIA_PURPOSES = ['sketch', 'design_reference'] as const;
export const attachGarmentMediaSchema = z.object({ mediaFileId: z.uuid() });

export const GARMENT_STAGE_LABELS: Record<(typeof GARMENT_STAGES)[number], string> = {
  design: 'Design',
  fabric_sourcing: 'Fabric Sourcing',
  cutting: 'Cutting',
  sewing: 'Sewing',
  embellishment: 'Embellishment',
  fitting: 'Fitting',
  alterations: 'Alterations',
  ready: 'Ready',
  released: 'Released',
};

// ---------- Measurements ----------

export const MEASUREMENT_LABELS = {
  bust: 'Bust',
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulder_width: 'Shoulder width',
  neck: 'Neck',
  arm_circumference: 'Arm circumference',
  sleeve_length: 'Sleeve length',
  back_length: 'Back length',
  front_length: 'Front length',
  skirt_length: 'Skirt length',
  inseam: 'Inseam',
} as const;

export const MEASUREMENT_UNITS = ['in', 'cm'] as const;

export const measurementProfileInputSchema = z.object({
  personName: text(160),
  notes: optionalText(5000),
});

const measurementValueSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,60}$/),
  label: optionalText(80),
  // A decimal string, stored as numeric(6,2) exactly as typed. The number is only compared to zero.
  value: z
    .string()
    .regex(/^\d{1,4}(\.\d{1,2})?$/)
    .refine((value) => Number(value) > 0, 'Must be greater than zero'),
});

export const createMeasurementRecordSchema = z
  .object({
    takenOn: z.iso.date(),
    unit: z.enum(MEASUREMENT_UNITS),
    notes: optionalText(5000),
    values: z.array(measurementValueSchema).min(1).max(100),
  })
  .superRefine(({ values }, ctx) => {
    if (new Set(values.map((v) => v.key)).size !== values.length) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'Each measurement can appear once' });
    }
    values.forEach((v, index) => {
      if (!(v.key in MEASUREMENT_LABELS) && !v.label) {
        ctx.addIssue({ code: 'custom', path: ['values', index, 'label'], message: 'Name this measurement' });
      }
    });
  });
