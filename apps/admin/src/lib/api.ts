import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@tahi/shared';
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

export async function apiFetch<T>(path: string, tenantId?: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, { headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }
  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!body.success) throw new ApiError(response.status, body.error.code, body.error.message);
  return body.data;
}
