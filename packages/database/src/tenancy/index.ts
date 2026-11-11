export { MissingTenantContextError, TenantScopeViolationError } from './errors.js';
export { scopeArgs } from './scope-args.js';
export {
  createTenantDatabase,
  withUserScope,
  type ScopedClient,
  type TenancyContext,
  type TenantDatabase,
  type TenantDb,
  type TenantTxOptions,
} from './tenant-database.js';
export { isTenantModel, TENANT_MODELS, type TenantModel } from './tenant-models.js';
