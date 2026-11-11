import type { SessionRealm } from '@tahi/database';

/** Session cookie per realm (docs/AUTHENTICATION_AND_AUTHORIZATION.md §1). */
export const SESSION_COOKIES: Record<SessionRealm, string> = {
  TENANT: '__Host-tahi_app',
  PLATFORM: '__Host-tahi_admin',
  CUSTOMER: '__Host-tahi_cust',
};

/** Reads one cookie from a Cookie header. The first occurrence wins. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}
