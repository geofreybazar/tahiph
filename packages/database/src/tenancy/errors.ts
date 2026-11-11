/** A tenant-owned model was used without a tenant in context. Always a programming error. */
export class MissingTenantContextError extends Error {
  constructor(target: string) {
    super(`Tenant context missing for ${target}`);
    this.name = 'MissingTenantContextError';
  }
}

/** Query arguments named a different tenant, or used a form the scoped client cannot police. */
export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeViolationError';
  }
}
