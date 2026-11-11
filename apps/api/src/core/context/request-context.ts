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
  membershipId?: string;
  customerSessionTenantId?: string;
  permissions?: ReadonlySet<Permission>;
  /** Ambient tenant transaction client (withTenantTx). */
  tenantTx?: unknown;
}
