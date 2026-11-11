// Spike (risk R1): tenant-scoped Prisma client on top of PostgreSQL RLS.
// Not production code. The design that survives goes into packages/database.
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.ts';

export interface TenantStore {
  tenantId: string;
  /** Set while inside withTenantTx: the transaction already carries app.tenant_id. */
  tx?: unknown;
}

export const als = new AsyncLocalStorage<TenantStore>();

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context missing for ${model}.${operation}`);
  }
}

const TENANT_MODELS = new Set(['Client']);

export function createBase(max = 10) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max }) });
}

type Base = ReturnType<typeof createBase>;

// Layer 2: inject tenantId into filters and data. Simplified for the spike.
function scopeArgs(operation: string, args: Record<string, unknown>, tenantId: string) {
  const a = { ...args };
  if ('where' in a || /^(find|count|update|delete|aggregate|groupBy)/.test(operation)) {
    a.where = { ...(a.where as object | undefined), tenantId };
  }
  if (operation === 'create' || operation === 'upsert') {
    const data = (a.data ?? {}) as Record<string, unknown>;
    if (data.tenantId !== undefined && data.tenantId !== tenantId) {
      throw new Error('tenantId mismatch in data');
    }
    a.data = { ...data, tenantId };
  }
  return a;
}

export function createScoped(base: Base) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const store = als.getStore();
          if (!store) throw new MissingTenantContextError(model, operation);
          const scoped = scopeArgs(operation, args as Record<string, unknown>, store.tenantId);
          // Inside withTenantTx the ambient transaction already carries the setting.
          if (store.tx !== undefined) return query(scoped as typeof args);
          // Otherwise: one batch transaction per operation (BEGIN; set_config; query; COMMIT).
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.tenant_id', ${store.tenantId}, true)`,
            query(scoped as typeof args),
          ]);
          return result;
        },
      },
    },
  });
}

export type Scoped = ReturnType<typeof createScoped>;
type Tx = Parameters<Parameters<Scoped['$transaction']>[0]>[0];

/**
 * One interactive transaction for a unit of work, with app.tenant_id set once.
 * The transaction client is published in the async context, so db() returns it.
 */
export async function withTenantTx<T>(scoped: Scoped, fn: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store) throw new MissingTenantContextError('$transaction', 'interactive');
  if (store.tx) return fn(); // already inside: join the outer transaction
  return scoped.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${store.tenantId}, true)`;
    return als.run({ ...store, tx }, async () => await fn());
  });
}

/** What services use: the ambient transaction if one is open, otherwise the scoped client. */
export function db(scoped: Scoped): Scoped | Tx {
  return (als.getStore()?.tx as Tx | undefined) ?? scoped;
}
