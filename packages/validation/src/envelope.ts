import { z } from 'zod';

/** Error envelope returned by every failing API request (docs/API_STANDARDS.md §5). */
export const apiErrorDetailSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
    requestId: z.string(),
  }),
});

/** Success envelope: `{ data }`, optionally with `meta` for paginated lists. */
export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}
