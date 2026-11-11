/**
 * Code-defined permission catalogue (docs/AUTHENTICATION_AND_AUTHORIZATION.md §7).
 * Permissions are stored on roles as these exact strings. Adding one is safe; renaming or
 * removing one needs a data migration for existing RolePermission rows.
 */
export const TENANT_PERMISSIONS = [
  'clients.read',
  'clients.write',
  'clients.archive',
  'measurements.read',
  'measurements.write',
  'appointments.read',
  'appointments.write',
  'appointments.manage_settings',
  'catalog.read',
  'catalog.write',
  'quotations.read',
  'quotations.write',
  'quotations.approve',
  'orders.read',
  'orders.write',
  'orders.cancel',
  'production.read',
  'production.write',
  'production.manage_workflow',
  'production.read_assigned',
  'payments.read',
  'payments.record',
  'payments.refund',
  'storefront.manage',
  'staff.read',
  'staff.manage',
  'roles.manage',
  'reports.read',
  'reports.financial',
  'tenant.settings',
  'tenant.billing',
  'tenant.merchant_account',
  'tenant.transfer_ownership',
  'audit.read',
] as const;
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.tenants.read',
  'platform.tenants.manage',
  'platform.tenants.access_data',
  'platform.billing.read',
  'platform.billing.manage',
  'platform.settings',
  'platform.admins.manage',
  'platform.support.read',
  'platform.support.manage',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type Permission = TenantPermission | PlatformPermission;

const ALL_TENANT: readonly TenantPermission[] = TENANT_PERMISSIONS;
const OWNER_ONLY: readonly TenantPermission[] = [
  'tenant.billing',
  'tenant.merchant_account',
  'tenant.transfer_ownership',
];

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'designer', 'tailor', 'staff'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  permissions: readonly TenantPermission[];
}

/** Default tenant roles, seeded at onboarding (§7.2). Owner gets everything. */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  { key: 'owner', name: 'Owner', permissions: ALL_TENANT },
  {
    key: 'admin',
    name: 'Admin',
    permissions: ALL_TENANT.filter((p) => !OWNER_ONLY.includes(p)),
  },
  {
    key: 'designer',
    name: 'Designer',
    permissions: [
      'clients.read',
      'clients.write',
      'clients.archive',
      'measurements.read',
      'measurements.write',
      'appointments.read',
      'appointments.write',
      'appointments.manage_settings',
      'catalog.read',
      'catalog.write',
      'quotations.read',
      'quotations.write',
      'orders.read',
      'orders.write',
      'orders.cancel',
      'production.read',
      'production.write',
      'production.manage_workflow',
      'payments.read',
      'payments.record',
      'storefront.manage',
      'reports.read',
    ],
  },
  {
    key: 'tailor',
    name: 'Tailor',
    permissions: [
      'clients.read',
      'measurements.read',
      'appointments.read',
      'catalog.read',
      'orders.read',
      'production.read_assigned',
      'production.write',
    ],
  },
  {
    key: 'staff',
    name: 'Staff',
    permissions: [
      'clients.read',
      'clients.write',
      'clients.archive',
      'measurements.read',
      'measurements.write',
      'appointments.read',
      'appointments.write',
      'appointments.manage_settings',
      'catalog.read',
      'quotations.read',
      'orders.read',
      'orders.write',
      'production.read',
      'payments.read',
      'payments.record',
    ],
  },
];

/** Platform roles map to code-defined permissions; only Super Admins manage admins. */
export const PLATFORM_ROLE_PERMISSIONS: Record<
  'SUPER_ADMIN' | 'PLATFORM_ADMIN',
  readonly PlatformPermission[]
> = {
  SUPER_ADMIN: PLATFORM_PERMISSIONS,
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS.filter((p) => p !== 'platform.admins.manage'),
};

export function isTenantPermission(value: string): value is TenantPermission {
  return (TENANT_PERMISSIONS as readonly string[]).includes(value);
}
