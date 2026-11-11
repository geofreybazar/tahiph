import type { DatabaseClient } from '../client.js';
import { MissingTenantContextError, TenantScopeViolationError } from './errors.js';
import { scopeArgs } from './scope-args.js';
import { isTenantModel } from './tenant-models.js';

/**
 * Where the tenant id and the ambient transaction live (the API backs this with nestjs-cls).
 * Kept framework-free so packages/database does not depend on NestJS.
 */
export interface TenancyContext {
  tenantId(): string | undefined;
  /** The open tenant transaction client, if inside withTenantTx. */
  transaction(): unknown;
  /** Runs fn with tx published as the ambient transaction. */
  runInTransaction<T>(tx: unknown, fn: () => Promise<T>): Promise<T>;
}

export interface TenantTxOptions {
  /** Max time to wait for a pooled connection (ms). Default 2000. */
  maxWait?: number;
  /** Max time the transaction may stay open (ms). Default 5000. */
  timeout?: number;
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

// Undocumented but stable in Prisma 7.10.x: interactive-transaction calls carry this.
// Used only to fail closed; tests break loudly if a Prisma upgrade removes it.
interface InternalParams {
  transaction?: { kind?: string };
}

interface OperationParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
  __internalParams?: InternalParams;
}

function buildScopedClient(base: DatabaseClient, ctx: TenancyContext) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      async $allOperations(params: OperationParams): Promise<unknown> {
        const { model, operation, args, query, __internalParams: internal } = params;
        const tenantId = ctx.tenantId();
        const tenantModel = isTenantModel(model);

        if (!tenantId) {
          if (tenantModel) throw new MissingTenantContextError(`${model}.${operation}`);
          // Global models and raw SQL without a tenant: RLS hides every tenant row.
          return query(args);
        }

        const scoped = tenantModel ? scopeArgs(operation, args, tenantId) : args;
        // Only withTenantTx opens interactive transactions on this client (TenantDb has no
        // $transaction), and it sets app.tenant_id first.
        const inTenantTx = internal?.transaction?.kind === 'itx';

        if (inTenantTx) return query(scoped);
        if (ctx.transaction() !== undefined) {
          // A client captured outside the transaction would run on another pooled
          // connection without app.tenant_id and silently see nothing.
          throw new TenantScopeViolationError(
            `${model ?? operation}: use db() inside withTenantTx, not a client captured outside it`,
          );
        }

        // Default (ADR-018): one batch transaction per operation.
        const results: unknown[] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          query(scoped) as ReturnType<DatabaseClient['$executeRaw']>,
        ]);
        return results[1];
      },
    },
  });
}

export type ScopedClient = ReturnType<typeof buildScopedClient>;
/** The client services use. Inside withTenantTx it is the transaction. */
export type TenantDb = Parameters<Parameters<ScopedClient['$transaction']>[0]>[0];

export interface TenantDatabase {
  /** The ambient tenant transaction if one is open, otherwise the scoped client. */
  db(): TenantDb;
  /**
   * Runs fn in one interactive transaction with app.tenant_id set once. Nested calls join
   * the outer transaction. No external I/O (HTTP, email, queues) inside fn.
   */
  withTenantTx<T>(fn: () => Promise<T>, options?: TenantTxOptions): Promise<T>;
}

export function createTenantDatabase(base: DatabaseClient, ctx: TenancyContext): TenantDatabase {
  const scoped = buildScopedClient(base, ctx);
  return {
    db: () => (ctx.transaction() as TenantDb | undefined) ?? scoped,
    async withTenantTx(fn, options = {}) {
      const tenantId = ctx.tenantId();
      if (!tenantId) throw new MissingTenantContextError('withTenantTx');
      if (ctx.transaction() !== undefined) return fn();
      return scoped.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          return ctx.runInTransaction(tx, fn);
        },
        { maxWait: 2000, timeout: 5000, ...options },
      );
    },
  };
}

type BaseTx = Parameters<Parameters<DatabaseClient['$transaction']>[0]>[0];

/**
 * Read-only user scope for flows that run before a tenant is chosen (login, atelier
 * switcher): the user may read their own memberships across tenants and the roles they
 * reference (RLS policies user_own_memberships / user_membership_roles). Uses the unscoped
 * client, so it belongs to allow-listed modules only.
 */
export async function withUserScope<T>(
  base: DatabaseClient,
  userId: string,
  fn: (tx: BaseTx) => Promise<T>,
): Promise<T> {
  return base.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    },
    { maxWait: 2000, timeout: 5000 },
  );
}
