import type { TenantRole, TenantStatus } from '@tahi/shared';

export interface Membership {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  role: TenantRole;
}

export interface Me {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
  memberships: Membership[];
}

const STORAGE_KEY = 'tahi.selectedTenant';

/** A remembered tenant is only a preference: it counts only if still in the memberships. */
export function chooseTenant(memberships: Membership[], remembered: string | null) {
  return memberships.find((m) => m.id === remembered) ?? memberships[0] ?? null;
}

export function readRememberedTenant(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberTenant(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing can block storage; the selection just won't be remembered.
  }
}
