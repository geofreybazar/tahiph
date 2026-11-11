import { z } from 'zod';
import { idSchema } from './common.js';
import { MEASUREMENT_UNITS } from './tenant-settings.js';

// ----- Categories ---------------------------------------------------------------------

const categoryNameSchema = z.string().trim().min(2).max(60);

export const createGarmentCategoryRequestSchema = z.object({ name: categoryNameSchema }).strict();
export const renameGarmentCategoryRequestSchema = createGarmentCategoryRequestSchema;

export const garmentCategorySchema = z.object({
  id: idSchema,
  name: z.string(),
  currentVersion: z.number().int().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export const categoryParamsSchema = z.object({ id: idSchema });

// ----- Templates ----------------------------------------------------------------------

/** "suit.sleeve_length": lower-case words joined by "_", optionally prefixed by a section. */
export const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'Use lower-case letters, digits, "_" and one "."')
  .max(60);

export const measurementFieldInputSchema = z
  .object({
    key: fieldKeySchema,
    label: z.string().trim().min(1).max(60),
    section: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((s) => s || null),
    required: z.boolean().default(false),
  })
  .strict();

/** Saving a template always creates a new version; the order of `fields` is the form order. */
export const saveTemplateRequestSchema = z
  .object({ fields: z.array(measurementFieldInputSchema).min(1).max(100) })
  .strict()
  .superRefine((o, ctx) => {
    const seen = new Set<string>();
    o.fields.forEach((f, i) => {
      if (seen.has(f.key)) {
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: 'Duplicate key' });
      }
      seen.add(f.key);
    });
  });

export const measurementFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  section: z.string().nullable(),
  required: z.boolean(),
});

export const measurementTemplateSchema = z.object({
  id: idSchema,
  category: z.object({ id: idSchema, name: z.string() }),
  version: z.number().int(),
  fields: z.array(measurementFieldSchema),
  createdAt: z.iso.datetime(),
});

export const templateParamsSchema = z.object({ id: idSchema });

// ----- Records ------------------------------------------------------------------------

/** numeric(7,3), positive: up to 4 integer digits and 3 decimals (1/8" = "0.125"). */
export const measurementValueSchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,3})?$/, 'Use a positive number with at most 3 decimals, e.g. "34.125"')
  .refine((v) => Number(v) > 0, 'Must be greater than 0');

export const createMeasurementRecordRequestSchema = z
  .object({
    categoryId: idSchema,
    values: z.record(fieldKeySchema, measurementValueSchema),
    /** Defaults to the atelier's measurement unit. */
    unit: z.enum(MEASUREMENT_UNITS).optional(),
    measuredFor: z.string().trim().max(200).optional(),
    /** Defaults to now. */
    takenAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().trim().max(2000).optional(),
    /** The record this one corrects (same client, not already corrected). */
    supersedesId: idSchema.optional(),
  })
  .strict();

export const measurementRecordSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  category: z.object({ id: idSchema, name: z.string() }),
  templateId: idSchema,
  templateVersion: z.number().int(),
  unit: z.enum(MEASUREMENT_UNITS),
  measuredFor: z.string().nullable(),
  takenAt: z.iso.datetime(),
  takenBy: z.object({ membershipId: idSchema, name: z.string() }),
  notes: z.string().nullable(),
  supersedesId: idSchema.nullable(),
  supersededById: idSchema.nullable(),
  /** In template order; only fields that were measured. */
  values: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      section: z.string().nullable(),
      value: z.string(),
    }),
  ),
});

export const measurementRecordParamsSchema = z.object({ recordId: idSchema });

export type CreateGarmentCategoryRequest = z.infer<typeof createGarmentCategoryRequestSchema>;
export type SaveTemplateRequest = z.infer<typeof saveTemplateRequestSchema>;
export type CreateMeasurementRecordRequest = z.infer<typeof createMeasurementRecordRequestSchema>;
