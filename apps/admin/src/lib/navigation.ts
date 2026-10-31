import type { TenantRole } from '@tahi/shared';

export interface NavItem {
  to: string;
  label: string;
  managersOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/reports', label: 'Reports', managersOnly: true },
  { to: '/expenses', label: 'Expenses', managersOnly: true },
  { to: '/members', label: 'Team', managersOnly: true },
];

/** For display only: the API enforces the same rule. */
export const isManager = (role: TenantRole) => role !== 'staff';

export function navigationFor(role: TenantRole): NavItem[] {
  return ITEMS.filter((item) => !item.managersOnly || isManager(role));
}
