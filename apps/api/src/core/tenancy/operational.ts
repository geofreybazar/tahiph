/** Tenant statuses with full dashboard access and background work (docs/MULTI_TENANCY.md §9). */
export const OPERATIONAL_TENANT_STATUSES: ReadonlySet<string> = new Set([
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
]);
