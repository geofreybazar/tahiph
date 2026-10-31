import type { TenantRole } from '@tahi/shared';

export interface NavItem {
  to: string;
  label: string;
  financial?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/reports', label: 'Reports', financial: true },
  { to: '/expenses', label: 'Expenses', financial: true },
];

/** For display only: the API enforces the same rule. */
export const canSeeFinancials = (role: TenantRole) => role !== 'staff';

export function navigationFor(role: TenantRole): NavItem[] {
  return ITEMS.filter((item) => !item.financial || canSeeFinancials(role));
}
