import type { z } from 'zod';
import type {
  apiErrorSchema,
  healthReportSchema,
  moneySchema,
  paginationMetaSchema,
} from '@tahi/validation';

/** Authentication realms (docs/AUTHENTICATION_AND_AUTHORIZATION.md §1). */
export const REALMS = ['platform', 'tenant', 'public', 'customer'] as const;
export type Realm = (typeof REALMS)[number];

export type Money = z.infer<typeof moneySchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;

export interface ApiSuccess<T, M = undefined> {
  data: T;
  meta?: M;
}
