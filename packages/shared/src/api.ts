import { z } from 'zod';

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'TENANT_REQUIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'TENANT_ACCESS_DENIED',
  'TENANT_SUSPENDED',
  'MFA_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE_VIOLATION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  timestamp: string;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  statusCode: number;
  error: { code: ApiErrorCode; message: string; details: ApiFieldError[] };
  timestamp: string;
  path: string;
}
