/** Models whose rows belong to exactly one tenant. Every model must appear in one set below. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'TenantMembership',
  'TenantInvitation',
  'MediaFile',
  'DocumentCounter',
  'Client',
  'WeddingProject',
  'Garment',
  'GarmentStageEvent',
  'MeasurementProfile',
  'MeasurementRecord',
  'MeasurementValue',
]);

/** The scoped client exposes only the current tenant's own row of this model. */
export const SELF_SCOPED_MODEL = 'Tenant';

/** Rows span tenants, so the scoped client refuses them and refuses to traverse through them. */
export const CROSS_TENANT_MODELS: ReadonlySet<string> = new Set([
  'User',
  'PlatformAdmin',
  'AuditLog',
]);
