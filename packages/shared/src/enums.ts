import { z } from 'zod';

export const TENANT_ROLES = ['owner', 'admin', 'staff'] as const;
export const tenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const TENANT_STATUSES = ['active', 'inactive', 'suspended'] as const;
export const tenantStatusSchema = z.enum(TENANT_STATUSES);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const GARMENT_STAGES = [
  'design',
  'fabric_sourcing',
  'cutting',
  'sewing',
  'embellishment',
  'fitting',
  'alterations',
  'ready',
  'released',
] as const;
export const garmentStageSchema = z.enum(GARMENT_STAGES);
export type GarmentStage = z.infer<typeof garmentStageSchema>;
