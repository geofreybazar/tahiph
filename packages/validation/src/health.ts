import { z } from 'zod';

export const healthCheckStatusSchema = z.enum(['up', 'down']);

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), healthCheckStatusSchema),
});
