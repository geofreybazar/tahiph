import { z } from 'zod';
import { idSchema, moneyAmountSchema, moneySchema, paginationQuerySchema } from './common.js';

export const QUOTATION_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'CONVERTED',
] as const;

const nonNegative = moneyAmountSchema.refine((v) => !v.startsWith('-'), 'Must not be negative');
const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * A catalogue line (catalogItemId; name and price default from the catalogue) or a custom line
 * (name and unitPrice required). Options must belong to the item's option groups.
 */
export const quotationItemInputSchema = z
  .object({
    catalogItemId: idSchema.optional(),
    name: text(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    unitPrice: nonNegative.optional(),
    quantity: z.number().int().min(1).max(999),
    optionIds: z.array(idSchema).max(20).default([]),
    measurementRecordId: idSchema.nullable().optional(),
  })
  .strict()
  .refine((i) => i.catalogItemId || (i.name && i.unitPrice), {
    message: 'A custom line needs a name and a unit price',
    path: ['name'],
  })
  .refine((i) => i.catalogItemId || i.optionIds.length === 0, {
    message: 'Options need a catalogue item',
    path: ['optionIds'],
  })
  .refine((i) => new Set(i.optionIds).size === i.optionIds.length, {
    message: 'Options must not repeat',
    path: ['optionIds'],
  });

const editable = {
  validUntil: z.iso.date().nullable().optional(),
  /** One amount off the subtotal (ADR-033); at most the subtotal. */
  discount: nonNegative.optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  items: z.array(quotationItemInputSchema).max(50),
};

export const createQuotationRequestSchema = z.object({ clientId: idSchema, ...editable }).strict();

/** Replaces the draft as a whole. `version` must match (optimistic locking). */
export const updateQuotationRequestSchema = z
  .object({ version: z.number().int().min(1), ...editable })
  .strict();

export const quotationListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(QUOTATION_STATUSES).optional(),
    clientId: idSchema.optional(),
  })
  .strict();

export const quotationParamsSchema = z.object({ id: idSchema });

const optionSnapshotSchema = z.object({
  groupId: idSchema,
  groupName: z.string(),
  optionId: idSchema,
  optionName: z.string(),
  priceDelta: moneySchema,
});

export const quotationItemSchema = z.object({
  id: idSchema,
  catalogItemId: idSchema.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  unitPrice: moneySchema,
  quantity: z.number().int(),
  options: z.array(optionSnapshotSchema),
  lineTotal: moneySchema,
  measurementRecordId: idSchema.nullable(),
});

export const quotationSummarySchema = z.object({
  id: idSchema,
  number: z.string(),
  revision: z.number().int(),
  supersedesId: idSchema.nullable(),
  client: z.object({ id: idSchema, name: z.string() }),
  status: z.enum(QUOTATION_STATUSES),
  validUntil: z.iso.date().nullable(),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  /** Percentage, e.g. "12.00", as applied to this quotation. */
  taxRate: z.string(),
  pricesIncludeTax: z.boolean(),
  notes: z.string().nullable(),
  version: z.number().int(),
  sentAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const quotationSchema = quotationSummarySchema.extend({
  items: z.array(quotationItemSchema),
});

export type QuotationItemInput = z.infer<typeof quotationItemInputSchema>;
export type CreateQuotationRequest = z.infer<typeof createQuotationRequestSchema>;
export type UpdateQuotationRequest = z.infer<typeof updateQuotationRequestSchema>;
export type QuotationListQuery = z.infer<typeof quotationListQuerySchema>;
