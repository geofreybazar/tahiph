import type { Provider } from '@nestjs/common';
import { createTenantDatabase, type DatabaseClient, type TenancyContext } from '@tahi/database';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import { UNSCOPED_PRISMA } from './tokens.js';

/** Tenant-scoped data access (ADR-018). Services inject this, never UNSCOPED_PRISMA. */
export const TENANT_DB = Symbol('TENANT_DB');

export function clsTenancyContext(cls: ClsService<RequestContext>): TenancyContext {
  return {
    tenantId: () => (cls.isActive() ? cls.get('tenantId') : undefined),
    transaction: () => (cls.isActive() ? cls.get('tenantTx') : undefined),
    runInTransaction: (tx, fn) =>
      cls.run({ ifNested: 'inherit' }, async () => {
        cls.set('tenantTx', tx);
        return await fn();
      }),
  };
}

export const tenantDatabaseProvider: Provider = {
  provide: TENANT_DB,
  inject: [UNSCOPED_PRISMA, ClsService],
  useFactory: (base: DatabaseClient, cls: ClsService<RequestContext>) =>
    createTenantDatabase(base, clsTenancyContext(cls)),
};
