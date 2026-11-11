import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  MissingTenantContextError,
  TENANT_MODELS,
  TenantScopeViolationError,
  createPrismaClient,
  createTenantDatabase,
  withUserScope,
  type DatabaseClient,
  type TenancyContext,
} from '@tahi/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

/**
 * Layers 2–4 of tenant isolation against the real schema (docs/MULTI_TENANCY.md §7.4,
 * ADR-018). The connection role must be subject to RLS, or these tests prove nothing.
 */

/** Tables that carry tenant_id but are global by design (no RLS). Extend only with review. */
const GLOBAL_TABLES_WITH_TENANT_ID = ['audit_log', 'auth_token', 'session', 'tenant_domain'];

interface Store {
  tenantId?: string;
  tx?: unknown;
}
const als = new AsyncLocalStorage<Store>();
const ctx: TenancyContext = {
  tenantId: () => als.getStore()?.tenantId,
  transaction: () => als.getStore()?.tx,
  runInTransaction: (tx, fn) => als.run({ ...als.getStore(), tx }, fn),
};
const as = <T>(tenantId: string, fn: () => Promise<T>) => als.run({ tenantId }, fn);

describe('Tenant isolation in PostgreSQL (integration)', () => {
  let prisma: DatabaseClient;
  let tdb: ReturnType<typeof createTenantDatabase>;
  let A: TenantFixture;
  let B: TenantFixture;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, max: 10 });
    tdb = createTenantDatabase(prisma, ctx);
    A = await createTenant(prisma, { owner: ['roles.manage'], tailor: [] });
    B = await createTenant(prisma, { owner: ['roles.manage'] });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('database role', () => {
    it('is neither superuser nor BYPASSRLS', async () => {
      const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });

  describe('RLS coverage', () => {
    it('every tenant model table has RLS enabled and forced with a tenant_isolation policy', async () => {
      const rows = await prisma.$queryRaw<{ table: string }[]>`
        SELECT c.relname AS table
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relrowsecurity AND c.relforcerowsecurity
          AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation')`;
      expect(rows.map((r) => r.table).sort()).toEqual(Object.values(TENANT_MODELS).sort());
    });

    it('every table with a tenant_id column is RLS-protected or explicitly global', async () => {
      const rows = await prisma.$queryRaw<{ table: string }[]>`
        SELECT table_name AS table FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`;
      const expected = [...Object.values(TENANT_MODELS), ...GLOBAL_TABLES_WITH_TENANT_ID].sort();
      expect(rows.map((r) => r.table).sort()).toEqual(expected);
    });
  });

  describe('raw access without context (layer 3)', () => {
    it('sees no tenant rows, even on connections that previously had a tenant set', async () => {
      await as(A.tenantId, async () => await tdb.db().role.count());
      for (let i = 0; i < 20; i++) {
        const [r] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM role`;
        expect(r?.n).toBe(0n);
      }
      expect(await prisma.tenantMembership.count()).toBe(0);
    });

    it('rejects writing a row for another tenant (WITH CHECK)', async () => {
      await expect(
        asTenant(prisma, A.tenantId, (tx) =>
          tx.role.create({ data: { tenantId: B.tenantId, key: 'x', name: 'x' } }),
        ),
      ).rejects.toThrow();
    });

    it('rejects a membership pointing to another tenant’s role (composite FK, layer 4)', async () => {
      const user = await createUser(prisma);
      await expect(
        asTenant(prisma, A.tenantId, (tx) =>
          tx.tenantMembership.create({
            data: { tenantId: A.tenantId, userId: user.id, roleId: B.roles.owner! },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('scoped client (layer 2)', () => {
    it('throws without a tenant context instead of returning nothing', async () => {
      await expect(tdb.db().role.findMany()).rejects.toThrow(MissingTenantContextError);
    });

    it('returns only the context tenant’s rows; foreign ids are not found', async () => {
      const roles = await as(A.tenantId, async () => await tdb.db().role.findMany());
      expect(roles.map((r) => r.tenantId)).toEqual(roles.map(() => A.tenantId));
      expect(roles).toHaveLength(2);
      const foreign = await as(A.tenantId, async () =>
        tdb.db().role.findUnique({ where: { id: B.roles.owner! } }),
      );
      expect(foreign).toBeNull();
    });

    it('stamps tenantId on create and rejects another tenant’s id', async () => {
      const role = await as(A.tenantId, async () =>
        tdb.db().role.create({ data: { key: `k-${randomUUID()}`, name: 'n' } as never }),
      );
      expect(role.tenantId).toBe(A.tenantId);
      await expect(
        as(A.tenantId, async () =>
          tdb.db().role.create({ data: { tenantId: B.tenantId, key: 'k', name: 'n' } }),
        ),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('cannot update or delete another tenant’s rows', async () => {
      const updated = await as(A.tenantId, async () =>
        tdb.db().role.updateMany({ where: { id: B.roles.owner! }, data: { name: 'pwned' } }),
      );
      expect(updated.count).toBe(0);
      await expect(
        as(A.tenantId, async () => tdb.db().role.delete({ where: { id: B.roles.owner! } })),
      ).rejects.toMatchObject({ code: 'P2025' });
    });

    it('nested relation reads stay inside the tenant (RLS in the same transaction)', async () => {
      const role = await as(A.tenantId, async () =>
        tdb.db().role.findUnique({ where: { id: A.roles.owner! }, include: { permissions: true } }),
      );
      expect(role?.permissions.map((p) => p.permission)).toEqual(['roles.manage']);
    });

    it('does not leak across 2,000 concurrent operations on a shared pool', async () => {
      const tenants = [A, B];
      const results = await Promise.all(
        Array.from({ length: 2000 }, (_, i) => {
          const t = tenants[i % 2]!;
          return as(t.tenantId, async () => {
            const rows = await tdb.db().role.findMany({ take: 5 });
            return rows.length > 0 && rows.every((r) => r.tenantId === t.tenantId);
          });
        }),
      );
      expect(results.every(Boolean)).toBe(true);
    });
  });

  describe('withTenantTx', () => {
    it('is atomic and rolls back on error', async () => {
      const key = `tx-${randomUUID()}`;
      await expect(
        as(A.tenantId, () =>
          tdb.withTenantTx(async () => {
            await tdb.db().role.create({ data: { key, name: 'tx' } as never });
            const seen = await tdb.db().role.findFirst({ where: { key } });
            expect(seen?.tenantId).toBe(A.tenantId);
            throw new Error('rollback');
          }),
        ),
      ).rejects.toThrow('rollback');
      expect(
        await as(A.tenantId, async () => tdb.db().role.findFirst({ where: { key } })),
      ).toBeNull();
    });

    it('nested calls join the outer transaction; raw SQL via db() is scoped', async () => {
      const count = await as(A.tenantId, () =>
        tdb.withTenantTx(async () => {
          const inner = await tdb.withTenantTx(async () => {
            const [r] = await tdb.db().$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM role`;
            return r?.n;
          });
          return inner;
        }),
      );
      expect(count).toBeGreaterThanOrEqual(2n);
    });

    it('rejects a client captured outside the transaction', async () => {
      const outer = tdb.db();
      await expect(
        as(A.tenantId, () => tdb.withTenantTx(async () => await outer.role.count())),
      ).rejects.toThrow(TenantScopeViolationError);
    });
  });

  describe('user scope (before a tenant is chosen)', () => {
    it('reads the user’s own memberships across tenants and their roles, nothing else', async () => {
      const user = await createUser(prisma);
      await addMember(prisma, A, user.id, 'tailor');
      await addMember(prisma, B, user.id, 'owner');
      const other = await createUser(prisma);
      await addMember(prisma, A, other.id, 'owner');

      const rows = await withUserScope(prisma, user.id, (tx) =>
        tx.tenantMembership.findMany({ include: { role: { select: { key: true } } } }),
      );
      expect(rows.map((m) => [m.tenantId, m.role.key]).sort()).toEqual(
        [
          [A.tenantId, 'tailor'],
          [B.tenantId, 'owner'],
        ].sort(),
      );
    });

    it('cannot modify memberships', async () => {
      const user = await createUser(prisma);
      const m = await addMember(prisma, A, user.id, 'tailor');
      const r = await withUserScope(prisma, user.id, (tx) =>
        tx.tenantMembership.updateMany({ where: { id: m.id }, data: { roleId: A.roles.owner! } }),
      );
      expect(r.count).toBe(0);
    });
  });

  describe('append-only audit tables', () => {
    it('blocks UPDATE and DELETE on tenant_audit_log', async () => {
      const log = await asTenant(prisma, A.tenantId, (tx) =>
        tx.tenantAuditLog.create({
          data: { tenantId: A.tenantId, actorType: 'SYSTEM', action: 'test' },
        }),
      );
      await expect(
        asTenant(prisma, A.tenantId, (tx) =>
          tx.tenantAuditLog.update({ where: { id: log.id }, data: { action: 'changed' } }),
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        asTenant(prisma, A.tenantId, (tx) => tx.tenantAuditLog.delete({ where: { id: log.id } })),
      ).rejects.toThrow(/append-only/);
    });

    it('blocks UPDATE on audit_log', async () => {
      const log = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'test' } });
      await expect(
        prisma.auditLog.update({ where: { id: log.id }, data: { action: 'changed' } }),
      ).rejects.toThrow(/append-only/);
    });
  });
});
