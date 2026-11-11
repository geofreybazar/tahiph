import type { Reflector } from '@nestjs/core';
import type { Permission } from '@tahi/types';
import type { RouteRealm } from '../context/request-context.js';
import {
  ACCESS_KEY,
  ALLOW_MFA_PENDING_KEY,
  PERMISSIONS_KEY,
  REALM_KEY,
  type AccessMode,
} from './decorators.js';

export interface RouteAccess {
  realm: RouteRealm;
  mode: AccessMode;
  permissions: readonly Permission[];
  allowMfaPending: boolean;
}

// Handler-level metadata overrides class-level metadata.
type Target = Parameters<Reflector['getAllAndOverride']>[1][number];

/** Reads a route's access configuration, or null if it is incomplete (deny by default). */
export function readRouteAccess(
  reflector: Reflector,
  handler: Target,
  controller: Target,
): RouteAccess | null {
  const targets = [handler, controller];
  const realm = reflector.getAllAndOverride<RouteRealm | undefined>(REALM_KEY, targets);
  const mode = reflector.getAllAndOverride<AccessMode | undefined>(ACCESS_KEY, targets);
  if (!realm || !mode) return null;
  const permissions =
    reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
  if (mode === 'permission' && permissions.length === 0) return null;
  if (mode === 'member' && realm !== 'tenant') return null;
  if (realm === 'internal' && mode !== 'public') return null;
  if (realm === 'public' && mode !== 'public') return null;
  return {
    realm,
    mode,
    permissions,
    allowMfaPending:
      reflector.getAllAndOverride<boolean | undefined>(ALLOW_MFA_PENDING_KEY, targets) ?? false,
  };
}
