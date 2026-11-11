import { z } from 'zod';
import { idSchema, moneyAmountSchema, moneySchema, paginationQuerySchema } from './common.js';

export const CATALOG_ITEM_KINDS = ['PRODUCT', 'SERVICE'] as const;
export const FULFILMENTS = ['READY_TO_WEAR', 'MADE_TO_MEASURE'] as const;
export const PRICING_MODES = ['FIXED', 'QUOTE'] as const;
export const OPTION_SELECTIONS = ['SINGLE', 'MULTIPLE'] as const;

const nameSchema = z.string().trim().min(1).max(100);
const sortOrderSchema = z.number().int().min(0).max(10_000);
/** A price as a decimal string, never negative (numeric(12,2)). */
const priceSchema = moneyAmountSchema.refine((v) => !v.startsWith('-'), 'Must not be negative');

// ----- Categories ---------------------------------------------------------------------

export const createCatalogCategoryRequestSchema = z
  .object({ name: nameSchema, sortOrder: sortOrderSchema.optional() })
  .strict();

export const updateCatalogCategoryRequestSchema = z
  .object({ name: nameSchema, sortOrder: sortOrderSchema })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

export const catalogCategorySchema = z.object({
  id: idSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
});

// ----- Items --------------------------------------------------------------------------

const itemFields = {
  kind: z.enum(CATALOG_ITEM_KINDS),
  name: nameSchema,
  description: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .transform((s) => s || null),
  categoryId: idSchema.nullable(),
  fulfilment: z.enum(FULFILMENTS).nullable(),
  pricingMode: z.enum(PRICING_MODES),
  /** Required for FIXED pricing; optional "starting from" price for QUOTE. */
  basePrice: priceSchema.nullable(),
  publicVisible: z.boolean(),
};

/** Rules that span fields; the API re-checks them on the merged record after a PATCH. */
export function catalogItemProblems(i: {
  kind?: string;
  fulfilment?: string | null;
  pricingMode?: string;
  basePrice?: string | null;
}): { path: string[]; message: string }[] {
  const problems: { path: string[]; message: string }[] = [];
  if (i.pricingMode === 'FIXED' && (i.basePrice === null || i.basePrice === undefined)) {
    problems.push({ path: ['basePrice'], message: 'Required for fixed pricing' });
  }
  if (i.kind === 'SERVICE' && i.fulfilment) {
    problems.push({ path: ['fulfilment'], message: 'Only products have a fulfilment type' });
  }
  return problems;
}

export const createCatalogItemRequestSchema = z
  .object(itemFields)
  .partial({
    description: true,
    categoryId: true,
    fulfilment: true,
    basePrice: true,
    publicVisible: true,
  })
  .strict()
  .superRefine((o, ctx) => {
    for (const p of catalogItemProblems(o)) ctx.addIssue({ code: 'custom', ...p });
  });

export const updateCatalogItemRequestSchema = z
  .object(itemFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

export const catalogItemListQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    categoryId: idSchema.optional(),
    kind: z.enum(CATALOG_ITEM_KINDS).optional(),
    status: z.enum(['active', 'archived', 'all']).default('active'),
  })
  .strict();

export const catalogOptionSchema = z.object({
  id: idSchema,
  name: z.string(),
  priceDelta: moneySchema,
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
});

export const catalogOptionGroupSchema = z.object({
  id: idSchema,
  name: z.string(),
  selection: z.enum(OPTION_SELECTIONS),
  required: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  options: z.array(catalogOptionSchema),
});

export const catalogItemSchema = z.object({
  id: idSchema,
  kind: z.enum(CATALOG_ITEM_KINDS),
  name: z.string(),
  description: z.string().nullable(),
  category: z.object({ id: idSchema, name: z.string() }).nullable(),
  fulfilment: z.enum(FULFILMENTS).nullable(),
  pricingMode: z.enum(PRICING_MODES),
  basePrice: moneySchema.nullable(),
  publicVisible: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const catalogItemDetailSchema = catalogItemSchema.extend({
  optionGroups: z.array(catalogOptionGroupSchema),
});

/** Replaces the item's option groups; the order of `groupIds` is the display order. */
export const setItemOptionGroupsRequestSchema = z
  .object({
    groupIds: z
      .array(idSchema)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate group'),
  })
  .strict();

// ----- Option groups and options ------------------------------------------------------

export const createOptionGroupRequestSchema = z
  .object({
    name: nameSchema,
    selection: z.enum(OPTION_SELECTIONS),
    required: z.boolean().optional(),
  })
  .strict();

export const updateOptionGroupRequestSchema = z
  .object({ name: nameSchema, selection: z.enum(OPTION_SELECTIONS), required: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

/** priceDelta may be negative, e.g. "client provides own fabric" (ADR-030). */
export const createOptionRequestSchema = z
  .object({
    name: nameSchema,
    priceDelta: moneyAmountSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();

export const updateOptionRequestSchema = z
  .object({ name: nameSchema, priceDelta: moneyAmountSchema, sortOrder: sortOrderSchema })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field');

export const catalogIdParamsSchema = z.object({ id: idSchema });
export const optionParamsSchema = z.object({ id: idSchema, optionId: idSchema });

export type CreateCatalogCategoryRequest = z.infer<typeof createCatalogCategoryRequestSchema>;
export type UpdateCatalogCategoryRequest = z.infer<typeof updateCatalogCategoryRequestSchema>;
export type CreateCatalogItemRequest = z.infer<typeof createCatalogItemRequestSchema>;
export type UpdateCatalogItemRequest = z.infer<typeof updateCatalogItemRequestSchema>;
export type CatalogItemListQuery = z.infer<typeof catalogItemListQuerySchema>;
export type SetItemOptionGroupsRequest = z.infer<typeof setItemOptionGroupsRequestSchema>;
export type CreateOptionGroupRequest = z.infer<typeof createOptionGroupRequestSchema>;
export type UpdateOptionGroupRequest = z.infer<typeof updateOptionGroupRequestSchema>;
export type CreateOptionRequest = z.infer<typeof createOptionRequestSchema>;
export type UpdateOptionRequest = z.infer<typeof updateOptionRequestSchema>;
