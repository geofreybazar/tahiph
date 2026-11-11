import type { Env } from '../config/env.js';
import type { RouteRealm } from '../context/request-context.js';

export type HostKind = 'app' | 'admin' | 'api' | 'storefront';

/**
 * Normalizes the Host header: lower case, no port, no trailing dot. Returns undefined for
 * anything that is not a plain hostname (IP literals with brackets, empty, oversized).
 * The raw Host header is used deliberately; X-Forwarded-Host is never trusted.
 */
export function normalizeHost(header: string | undefined): string | undefined {
  if (!header || header.length > 255) return undefined;
  const host = header.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)
    ? host
    : undefined;
}

export function classifyHost(
  host: string,
  env: Pick<Env, 'APP_HOST' | 'ADMIN_HOST' | 'API_HOST'>,
): HostKind {
  if (host === env.APP_HOST) return 'app';
  if (host === env.ADMIN_HOST) return 'admin';
  if (host === env.API_HOST) return 'api';
  return 'storefront';
}

const REALM_HOSTS: Record<Exclude<RouteRealm, 'internal'>, HostKind> = {
  tenant: 'app',
  platform: 'admin',
  public: 'storefront',
  customer: 'storefront',
};

/** Whether a route of this realm is served on this kind of host. */
export function realmServedOn(realm: Exclude<RouteRealm, 'internal'>, kind: HostKind): boolean {
  return REALM_HOSTS[realm] === kind;
}
