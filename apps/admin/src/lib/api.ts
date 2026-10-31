import type { ApiErrorCode, ApiFailure, ApiSuccess, PaginationMeta } from '@tahi/shared';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
  }
}

interface ApiOptions {
  tenantId?: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return (await request<T>(path, options)).data;
}

/** For list endpoints, which carry pagination details alongside the rows. */
export async function apiFetchPage<T>(
  path: string,
  options: ApiOptions = {},
): Promise<{ data: T[]; meta: PaginationMeta }> {
  const { data, meta } = await request<T[]>(path, options);
  return { data, meta: meta! };
}

async function request<T>(path: string, options: ApiOptions): Promise<ApiSuccess<T>> {
  const { tenantId, method, body: payload, idempotencyKey } = options;
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }
  if (response.status === 204) return { success: true, data: undefined as T, timestamp: '' };
  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!body.success) throw new ApiError(response.status, body.error.code, body.error.message);
  return body;
}
