/**
 * Tenant-owned models and their tables. The scoped client stamps and filters tenantId on
 * these models; each table has an enabled + forced RLS policy. An integration test fails if
 * this map and the database's RLS-protected tables differ.
 */
export const TENANT_MODELS = {
  Role: 'role',
  RolePermission: 'role_permission',
  TenantMembership: 'tenant_membership',
  TenantAuditLog: 'tenant_audit_log',
  CustomerAccount: 'customer_account',
  BusinessProfile: 'business_profile',
  TenantSettings: 'tenant_settings',
  OperatingHours: 'operating_hours',
  Holiday: 'holiday',
  Client: 'client',
  ClientNote: 'client_note',
  Communication: 'communication',
  GarmentCategory: 'garment_category',
  MeasurementTemplate: 'measurement_template',
  MeasurementField: 'measurement_field',
  MeasurementRecord: 'measurement_record',
  MeasurementValue: 'measurement_value',
  AppointmentType: 'appointment_type',
  StaffAvailability: 'staff_availability',
  StaffTimeOff: 'staff_time_off',
  Appointment: 'appointment',
  CatalogCategory: 'catalog_category',
  CatalogItem: 'catalog_item',
  CatalogOptionGroup: 'catalog_option_group',
  CatalogOption: 'catalog_option',
  CatalogItemOptionGroup: 'catalog_item_option_group',
  MediaAsset: 'media_asset',
  TenantCounter: 'tenant_counter',
  Quotation: 'quotation',
  QuotationItem: 'quotation_item',
} as const;

export type TenantModel = keyof typeof TENANT_MODELS;

export function isTenantModel(model: string | undefined): model is TenantModel {
  return model !== undefined && Object.hasOwn(TENANT_MODELS, model);
}
