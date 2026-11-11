import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { Permission } from '@tahi/types';
import type { RouteRealm } from '../context/request-context.js';

export const REALM_KEY = 'tahi:realm';
export const ACCESS_KEY = 'tahi:access';
export const PERMISSIONS_KEY = 'tahi:permissions';
export const ALLOW_MFA_PENDING_KEY = 'tahi:allowMfaPending';

export type AccessMode = 'public' | 'authenticated' | 'permission';

/**
 * Every route needs @Realm() plus exactly one of @Public(), @Authenticated() or
 * @RequirePermission() (docs/AUTHENTICATION_AND_AUTHORIZATION.md §7.3). Routes without
 * them are rejected at boot and denied at runtime.
 */
export const Realm = (realm: RouteRealm) => SetMetadata(REALM_KEY, realm);

/** No session required. Storefront routes still resolve the tenant from the Host. */
export const Public = () => SetMetadata(ACCESS_KEY, 'public' satisfies AccessMode);

/** A valid session of the route's realm is enough (e.g. "who am I", onboarding). */
export const Authenticated = () => SetMetadata(ACCESS_KEY, 'authenticated' satisfies AccessMode);

/** Session plus every listed permission for the active tenant (or platform role). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, 'permission' satisfies AccessMode),
    SetMetadata(PERMISSIONS_KEY, permissions),
  );

/** Platform only: allow a session whose TOTP step is not complete (the MFA endpoints). */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING_KEY, true);
