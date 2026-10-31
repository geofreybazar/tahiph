import { isValidTenantSlug } from '@tahi/shared';

export type HostRoute =
  | { kind: 'tenant'; site: string; rewriteTo: string }
  | { kind: 'root' }
  | { kind: 'not-found' };

const stripPort = (host: string) => host.split(':')[0] ?? '';

/**
 * Decides what a request means from its host alone. `site` only ever comes from the host, so
 * no path can reach another tenant's pages.
 */
export function routeHost(host: string | null, pathname: string, rootDomain: string): HostRoute {
  const hostname = stripPort((host ?? '').toLowerCase());
  const root = stripPort(rootDomain.toLowerCase());
  if (!hostname || !root) return { kind: 'not-found' };

  // The root host has only its landing page; /demo here must not render the demo tenant.
  if (hostname === root || hostname === `www.${root}`) {
    return pathname === '/' ? { kind: 'root' } : { kind: 'not-found' };
  }

  if (!hostname.endsWith(`.${root}`)) return { kind: 'not-found' };
  const site = hostname.slice(0, -root.length - 1);
  if (!isValidTenantSlug(site)) return { kind: 'not-found' };

  return { kind: 'tenant', site, rewriteTo: `/${site}${pathname === '/' ? '' : pathname}` };
}
