import { z } from 'zod';

/** UUID primary keys (UUIDv7 in practice; any RFC 9562 UUID is accepted). */
export const idSchema = z.uuid();

/** ISO 4217 currency code. PHP is the platform default. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 currency code');

/**
 * Monetary amounts travel as decimal strings (never JS numbers) to avoid float rounding.
 * Matches numeric(12,2): up to 10 integer digits and 2 fraction digits.
 */
export const moneyAmountSchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,2})?$/, 'Must be a decimal string with at most 2 decimal places');

export const moneySchema = z.object({
  amount: moneyAmountSchema,
  currency: currencySchema,
});

/** Cursor pagination query (docs/API_STANDARDS.md §6). */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});

export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
