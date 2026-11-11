import type { ClsStore } from 'nestjs-cls';
import type { Permission } from '@tahi/types';

/** Realm a route belongs to. `internal` routes (health) skip host and session checks. */
export type RouteRealm = 'tenant' | 'platform' | 'public' | 'customer' | 'internal';

/**
 * Per-request context (docs/MULTI_TENANCY.md §3). Only the access guard and the worker's
 * tenant job base set these values; nothing derived from client input is stored here.
 */
export interface RequestContext extends ClsStore {
  realm?: RouteRealm;
  host?: string;
  tenantId?: string;
  sessionId?: string;
  userId?: string;
  platformUserId?: string;
  /** Platform sessions: whether the TOTP step is complete. */
  mfaVerified?: boolean;
  membershipId?: string;
  customerAccountId?: string;
  permissions?: ReadonlySet<Permission>;
  /** Ambient tenant transaction client (withTenantTx). */
  tenantTx?: unknown;
}

/**
 * Reads a context value the access guard must have set for this route. A missing value is a
 * programming error (wrong decorator), so it fails loudly rather than defaulting.
 */
export function requireContext<K extends 'tenantId' | 'sessionId' | 'userId' | 'membershipId'>(
  cls: { get(key: K): unknown },
  key: K,
): string {
  const value = cls.get(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Request context is missing ${key}`);
  }
  return value;
}
