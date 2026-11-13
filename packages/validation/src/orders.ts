import { z } from 'zod';
import { idSchema, moneyAmountSchema, moneySchema, paginationQuerySchema } from './common.js';
import { quotationItemInputSchema, quotationItemSchema } from './quotations.js';

export const ORDER_STATUSES = [
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'RELEASED',
  'CANCELLED',
] as const;
/** Statuses staff move an order to with POST /status (forward only; cancel has its own route). */
export const ORDER_PROGRESS_STATUSES = ['IN_PRODUCTION', 'READY', 'RELEASED'] as const;

const nonNegative = moneyAmountSchema.refine((v) => !v.startsWith('-'), 'Must not be negative');

/** A direct (walk-in) order; lines follow the quotation rules (ADR-034). */
export const createOrderRequestSchema = z
  .object({
    clientId: idSchema,
    promisedDate: z.iso.date().nullable().optional(),
    discount: nonNegative.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    items: z.array(quotationItemInputSchema).min(1).max(50),
  })
  .strict();

/** Converts an ACCEPTED quotation; repeating it returns the same order. */
export const convertQuotationRequestSchema = z
  .object({ quotationId: idSchema, promisedDate: z.iso.date().nullable().optional() })
  .strict();

/**
 * Header changes at any open status; `items` (with `discount`) only while CONFIRMED, replacing
 * all lines. `version` must match (optimistic locking).
 */
export const updateOrderRequestSchema = z
  .object({
    version: z.number().int().min(1),
    promisedDate: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    items: z.array(quotationItemInputSchema).min(1).max(50).optional(),
    discount: nonNegative.optional(),
  })
  .strict()
  .refine((o) => o.discount === undefined || o.items !== undefined, {
    message: 'Send the items with a new discount',
    path: ['discount'],
  });

export const orderStatusRequestSchema = z
  .object({ status: z.enum(ORDER_PROGRESS_STATUSES) })
  .strict();
export const cancelOrderRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const orderListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(ORDER_STATUSES).optional(),
    clientId: idSchema.optional(),
  })
  .strict();

export const orderParamsSchema = z.object({ id: idSchema });

const measurementSnapshotSchema = z.object({
  recordId: idSchema,
  category: z.string(),
  unit: z.enum(['CM', 'IN']),
  takenAt: z.iso.datetime(),
  measuredFor: z.string().nullable(),
  values: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      section: z.string().nullable(),
      value: z.string(),
    }),
  ),
});

export const orderItemSchema = quotationItemSchema.extend({
  measurementSnapshot: measurementSnapshotSchema.nullable(),
});

export const orderSummarySchema = z.object({
  id: idSchema,
  number: z.string(),
  quotationId: idSchema.nullable(),
  client: z.object({ id: idSchema, name: z.string() }),
  status: z.enum(ORDER_STATUSES),
  promisedDate: z.iso.date().nullable(),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  taxRate: z.string(),
  pricesIncludeTax: z.boolean(),
  notes: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const orderSchema = orderSummarySchema.extend({
  items: z.array(orderItemSchema),
  history: z.array(
    z.object({
      fromStatus: z.enum(ORDER_STATUSES).nullable(),
      toStatus: z.enum(ORDER_STATUSES),
      changedBy: z.object({ membershipId: idSchema, name: z.string() }),
      changedAt: z.iso.datetime(),
    }),
  ),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type ConvertQuotationRequest = z.infer<typeof convertQuotationRequestSchema>;
export type UpdateOrderRequest = z.infer<typeof updateOrderRequestSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type OrderProgressStatus = (typeof ORDER_PROGRESS_STATUSES)[number];
