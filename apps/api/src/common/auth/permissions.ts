import { TenantRole } from '@tahi/shared';

/** The role matrix from docs/security.md section 3. Seed for the future permission system. */
const PERMISSIONS = {
  'members:manage': ['owner', 'admin'],
  'tenant:update': ['owner', 'admin'],
  'ownership:transfer': ['owner'],
  'finance:read': ['owner', 'admin'],
  'expenses:manage': ['owner', 'admin'],
  'payments:void': ['owner', 'admin'],
  'projects:change-price': ['owner', 'admin'],
} as const satisfies Record<string, readonly TenantRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: TenantRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly TenantRole[]).includes(role);
}
