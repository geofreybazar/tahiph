import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const ROUTE_ACCESS = 'tahi:route-access';

export type RouteAccess =
  { kind: 'public' } | { kind: 'tenant'; permission?: Permission } | { kind: 'platform' };

/** No token required. Every other route needs a valid one. */
export const Public = () => SetMetadata<string, RouteAccess>(ROUTE_ACCESS, { kind: 'public' });

/** Requires membership of the X-Tenant-Id tenant and, optionally, a permission. */
export const TenantRoute = (permission?: Permission) =>
  SetMetadata<string, RouteAccess>(ROUTE_ACCESS, { kind: 'tenant', permission });

export const PlatformRoute = () =>
  SetMetadata<string, RouteAccess>(ROUTE_ACCESS, { kind: 'platform' });
